import {
  Mission,
  MissionEvent,
  MissionEventType,
  MissionStage,
  MissionStatus,
  RiskLevel,
} from '../domain/types';
import { Database } from '../storage/Database';
import { missionIdFromNumber, randomId } from './ids';

interface MissionRow {
  id: string;
  goal: string;
  stage: MissionStage;
  status: MissionStatus;
  progress: number;
  risk: RiskLevel;
  owner_needed: number;
  current_assignee?: string | null;
  next_action?: string | null;
  summary?: string | null;
  asset_ids: string;
  created_at: number;
  updated_at: number;
  completed_at?: number | null;
}

interface MissionEventRow {
  id: string;
  mission_id: string;
  type: MissionEventType;
  actor: string;
  content: string;
  metadata?: string | null;
  created_at: number;
}

type MissionPatch = Partial<
  Pick<
    Mission,
    | 'stage'
    | 'status'
    | 'progress'
    | 'risk'
    | 'ownerNeeded'
    | 'currentAssignee'
    | 'nextAction'
    | 'summary'
    | 'assetIds'
    | 'completedAt'
  >
>;

export class MissionStore {
  constructor(private readonly db: Database) {}

  async createMission(goal: string, assetIds: string[] = []): Promise<Mission> {
    const now = Date.now();
    const mission: Mission = {
      id: await this.nextMissionId(),
      goal,
      stage: 'planning',
      status: 'active',
      progress: 0,
      risk: 'medium',
      ownerNeeded: false,
      currentAssignee: assetIds[0],
      nextAction: assetIds.length > 0
        ? `Assign first pass to ${assetIds[0]} and record progress.`
        : 'Register or choose worker assets, then assign first pass.',
      assetIds,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };

    await this.db.run(
      `
      INSERT INTO missions (
        id, goal, stage, status, progress, risk, owner_needed, current_assignee,
        next_action, summary, asset_ids, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        mission.id,
        mission.goal,
        mission.stage,
        mission.status,
        mission.progress,
        mission.risk,
        mission.ownerNeeded ? 1 : 0,
        mission.currentAssignee ?? null,
        mission.nextAction ?? null,
        mission.summary ?? null,
        JSON.stringify(mission.assetIds),
        now,
        now,
        null,
      ],
    );

    await this.addEvent({
      missionId: mission.id,
      type: 'created',
      actor: 'owner',
      content: goal,
    });
    await this.addEvent({
      missionId: mission.id,
      type: 'planned',
      actor: 'boss',
      content: mission.nextAction ?? 'Mission created.',
      metadata: { assetIds },
    });

    return mission;
  }

  async listMissions(): Promise<Mission[]> {
    const rows = await this.db.all<MissionRow>('SELECT * FROM missions ORDER BY created_at DESC');
    return rows.map(toMission);
  }

  async getMission(id: string): Promise<Mission | undefined> {
    const row = await this.db.get<MissionRow>('SELECT * FROM missions WHERE id = ?', [id]);
    return row ? toMission(row) : undefined;
  }

  async updateMission(id: string, patch: MissionPatch): Promise<Mission> {
    const current = await this.getMission(id);
    if (!current) {
      throw new Error(`Mission not found: ${id}`);
    }

    const next: Mission = {
      ...current,
      ...patch,
      updatedAt: new Date(),
    };

    await this.db.run(
      `
      UPDATE missions SET
        stage = ?,
        status = ?,
        progress = ?,
        risk = ?,
        owner_needed = ?,
        current_assignee = ?,
        next_action = ?,
        summary = ?,
        asset_ids = ?,
        updated_at = ?,
        completed_at = ?
      WHERE id = ?
      `,
      [
        next.stage,
        next.status,
        next.progress,
        next.risk,
        next.ownerNeeded ? 1 : 0,
        next.currentAssignee ?? null,
        next.nextAction ?? null,
        next.summary ?? null,
        JSON.stringify(next.assetIds),
        next.updatedAt.getTime(),
        next.completedAt?.getTime() ?? null,
        next.id,
      ],
    );

    return next;
  }

  async addEvent(input: {
    missionId: string;
    type: MissionEventType;
    actor: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<MissionEvent> {
    const now = Date.now();
    const event: MissionEvent = {
      id: randomId('ev'),
      missionId: input.missionId,
      type: input.type,
      actor: input.actor,
      content: input.content,
      metadata: input.metadata,
      createdAt: new Date(now),
    };

    await this.db.run(
      `
      INSERT INTO mission_events (
        id, mission_id, type, actor, content, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        event.id,
        event.missionId,
        event.type,
        event.actor,
        event.content,
        event.metadata ? JSON.stringify(event.metadata) : null,
        now,
      ],
    );

    return event;
  }

  async listEvents(missionId: string): Promise<MissionEvent[]> {
    const rows = await this.db.all<MissionEventRow>(
      'SELECT * FROM mission_events WHERE mission_id = ? ORDER BY created_at ASC, rowid ASC',
      [missionId],
    );
    return rows.map(toMissionEvent);
  }

  async listRecentEvents(missionId: string, limit: number): Promise<MissionEvent[]> {
    const rows = await this.db.all<MissionEventRow>(
      'SELECT * FROM mission_events WHERE mission_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
      [missionId, limit],
    );
    return rows.map(toMissionEvent).reverse();
  }

  private async nextMissionId(): Promise<string> {
    const rows = await this.db.all<{ id: string }>("SELECT id FROM missions WHERE id LIKE 'm-%'");
    const max = rows.reduce((highest, row) => {
      const match = /^m-(\d+)$/.exec(row.id);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    return missionIdFromNumber(max + 1);
  }
}

function toMission(row: MissionRow): Mission {
  return {
    id: row.id,
    goal: row.goal,
    stage: row.stage,
    status: row.status,
    progress: row.progress,
    risk: row.risk,
    ownerNeeded: row.owner_needed === 1,
    currentAssignee: row.current_assignee ?? undefined,
    nextAction: row.next_action ?? undefined,
    summary: row.summary ?? undefined,
    assetIds: JSON.parse(row.asset_ids) as string[],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}

function toMissionEvent(row: MissionEventRow): MissionEvent {
  return {
    id: row.id,
    missionId: row.mission_id,
    type: row.type,
    actor: row.actor,
    content: row.content,
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
    createdAt: new Date(row.created_at),
  };
}
