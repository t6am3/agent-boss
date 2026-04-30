import { Mission, MissionEventType, SupervisorDecision } from '../domain/types';
import { MissionStore } from './MissionStore';
import { Supervisor } from './Supervisor';

export type MissionRunnerKind = 'mock';
export type MockRunScenario = 'happy' | 'confirmation' | 'permission' | 'blocked';
export type MissionRunStatus = 'completed' | 'waiting_owner' | 'blocked';

export interface MissionRunOptions {
  assetId?: string;
  scenario?: MockRunScenario;
  question?: string;
}

export interface MissionRunResult {
  missionId: string;
  runner: MissionRunnerKind;
  assetId: string;
  status: MissionRunStatus;
  escalatedToOwner: boolean;
  summary: string;
}

export interface MissionRunner {
  run(mission: Mission, options?: MissionRunOptions): Promise<MissionRunResult>;
}

export class MockMissionRunner implements MissionRunner {
  constructor(
    private readonly missions: MissionStore,
    private readonly supervisor: Supervisor,
  ) {}

  async run(mission: Mission, options: MissionRunOptions = {}): Promise<MissionRunResult> {
    const scenario = options.scenario ?? 'confirmation';
    const assetId = options.assetId ?? mission.currentAssignee ?? mission.assetIds[0] ?? 'mock-worker';

    await this.record(mission.id, 'assigned', 'boss', `Assigned mission to ${assetId}.`, {
      runner: 'mock',
      scenario,
      assetId,
    });

    await this.missions.updateMission(mission.id, {
      stage: 'executing',
      status: 'active',
      progress: Math.max(mission.progress, 15),
      risk: mission.risk,
      ownerNeeded: false,
      currentAssignee: assetId,
      nextAction: `${assetId} is executing the first pass.`,
    });

    await this.record(
      mission.id,
      'progress',
      assetId,
      `Started execution for: ${mission.goal}`,
      { progress: 15 },
    );

    const question = options.question ?? defaultScenarioQuestion(scenario);
    if (question) {
      const decision = await this.handleWorkerQuestion(mission.id, assetId, question);
      if (decision.escalatedToOwner) {
        return {
          missionId: mission.id,
          runner: 'mock',
          assetId,
          status: 'waiting_owner',
          escalatedToOwner: true,
          summary: decision.decision,
        };
      }
    }

    if (scenario === 'blocked') {
      const summary = `${assetId} hit a blocker that Boss must re-plan.`;
      await this.record(mission.id, 'blocked', assetId, summary, { runner: 'mock' });
      await this.missions.updateMission(mission.id, {
        stage: 'executing',
        status: 'blocked',
        progress: 45,
        risk: 'high',
        currentAssignee: assetId,
        summary,
        nextAction: 'Boss should inspect the blocker, ask for attempted fixes, and reassign or narrow scope.',
      });
      return {
        missionId: mission.id,
        runner: 'mock',
        assetId,
        status: 'blocked',
        escalatedToOwner: false,
        summary,
      };
    }

    await this.record(mission.id, 'progress', assetId, 'Worker produced a first-pass result.', {
      progress: 60,
    });
    await this.missions.updateMission(mission.id, {
      stage: 'reviewing',
      status: 'active',
      progress: 75,
      risk: 'medium',
      ownerNeeded: false,
      currentAssignee: assetId,
      summary: 'Worker produced a first-pass result.',
      nextAction: 'Boss reviews the result and decides whether to accept or request changes.',
    });

    await this.record(mission.id, 'progress', 'boss', 'Boss reviewed the result and accepted the mock output.', {
      progress: 90,
    });

    const summary = `Mock runner completed mission with ${assetId}.`;
    await this.missions.updateMission(mission.id, {
      stage: 'completed',
      status: 'completed',
      progress: 100,
      risk: 'low',
      ownerNeeded: false,
      currentAssignee: assetId,
      summary,
      nextAction: 'Generate report and judge the mission.',
      completedAt: new Date(),
    });
    await this.record(mission.id, 'completed', 'boss', summary, { runner: 'mock', assetId });

    return {
      missionId: mission.id,
      runner: 'mock',
      assetId,
      status: 'completed',
      escalatedToOwner: false,
      summary,
    };
  }

  private async handleWorkerQuestion(
    missionId: string,
    assetId: string,
    question: string,
  ): Promise<SupervisorDecision> {
    await this.record(missionId, 'confirmation_requested', assetId, question);
    const mission = await this.requireMission(missionId);
    const decision = await this.supervisor.decide(mission, question);
    const eventType: MissionEventType = decision.escalatedToOwner ? 'resource_escalation' : 'decision';

    await this.record(missionId, eventType, 'boss', `${decision.decision} Reason: ${decision.reason}`, {
      question,
      category: decision.category,
    });

    await this.missions.updateMission(missionId, {
      status: decision.escalatedToOwner ? 'waiting_owner' : 'active',
      ownerNeeded: decision.escalatedToOwner,
      risk: decision.escalatedToOwner ? 'high' : mission.risk,
      nextAction: decision.decision,
      currentAssignee: assetId,
      summary: decision.escalatedToOwner ? question : mission.summary,
    });

    return decision;
  }

  private async requireMission(missionId: string): Promise<Mission> {
    const mission = await this.missions.getMission(missionId);
    if (!mission) {
      throw new Error(`Mission not found: ${missionId}`);
    }
    return mission;
  }

  private async record(
    missionId: string,
    type: MissionEventType,
    actor: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.missions.addEvent({ missionId, type, actor, content, metadata });
  }
}

function defaultScenarioQuestion(scenario: MockRunScenario): string | undefined {
  if (scenario === 'happy') {
    return undefined;
  }
  if (scenario === 'permission') {
    return 'Need login permission for the private repository before continuing.';
  }
  if (scenario === 'blocked') {
    return 'Should I add tests before continuing?';
  }
  return 'Should I add tests before continuing?';
}
