import {
  AddAssetInput,
  Asset,
  AssetStatus,
  AssetType,
  CostMode,
} from '../domain/types';
import { Database } from '../storage/Database';

interface AssetRow {
  id: string;
  type: AssetType;
  name: string;
  provider?: string | null;
  plan?: string | null;
  scenes: string;
  cost_mode: CostMode;
  status: AssetStatus;
  notes?: string | null;
  created_at: number;
  updated_at: number;
}

export class AssetLedger {
  constructor(private readonly db: Database) {}

  async addAsset(input: AddAssetInput): Promise<Asset> {
    const now = Date.now();
    const asset: Asset = {
      id: input.id,
      type: input.type,
      name: input.name,
      provider: input.provider,
      plan: input.plan,
      scenes: input.scenes ?? [],
      costMode: input.costMode ?? 'unknown',
      status: input.status ?? 'ready',
      notes: input.notes,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };

    await this.db.run(
      `
      INSERT INTO assets (
        id, type, name, provider, plan, scenes, cost_mode, status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        asset.id,
        asset.type,
        asset.name,
        asset.provider ?? null,
        asset.plan ?? null,
        JSON.stringify(asset.scenes),
        asset.costMode,
        asset.status,
        asset.notes ?? null,
        now,
        now,
      ],
    );

    return asset;
  }

  async listAssets(): Promise<Asset[]> {
    const rows = await this.db.all<AssetRow>('SELECT * FROM assets ORDER BY type, id');
    return rows.map(toAsset);
  }

  async getAsset(id: string): Promise<Asset | undefined> {
    const row = await this.db.get<AssetRow>('SELECT * FROM assets WHERE id = ?', [id]);
    return row ? toAsset(row) : undefined;
  }

  async findCandidates(goal: string): Promise<Asset[]> {
    const assets = await this.listAssets();
    const normalizedGoal = goal.toLowerCase();
    const readyAgents = assets.filter((asset) => asset.type === 'agent' && asset.status === 'ready');
    const sceneMatches = readyAgents.filter((asset) =>
      asset.scenes.some((scene) => normalizedGoal.includes(scene.toLowerCase())),
    );
    return sceneMatches.length > 0 ? sceneMatches : readyAgents.slice(0, 3);
  }
}

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    provider: row.provider ?? undefined,
    plan: row.plan ?? undefined,
    scenes: JSON.parse(row.scenes) as string[],
    costMode: row.cost_mode,
    status: row.status,
    notes: row.notes ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
