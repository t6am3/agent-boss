import { Database } from '../storage/Database';

export type BossBrainProvider = 'rule' | 'codex' | 'claude' | 'hermes';

export interface BossBrainConfig {
  provider: BossBrainProvider;
  model?: string;
  command?: string;
}

interface SettingRow {
  key: string;
  value: string;
  updated_at: number;
}

export class SettingsStore {
  constructor(private readonly db: Database) {}

  async get(key: string): Promise<string | undefined> {
    const row = await this.db.get<SettingRow>('SELECT * FROM settings WHERE key = ?', [key]);
    return row?.value;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.run(
      `
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
      [key, value, Date.now()],
    );
  }

  async unset(key: string): Promise<void> {
    await this.db.run('DELETE FROM settings WHERE key = ?', [key]);
  }

  async getBossBrainConfig(): Promise<BossBrainConfig> {
    const provider = parseBossBrainProvider(
      process.env.AGENT_BOSS_BRAIN_PROVIDER ?? await this.get('boss.brain.provider') ?? 'rule',
    );
    const model = process.env.AGENT_BOSS_BRAIN_MODEL ?? await this.get('boss.brain.model');
    const command = process.env.AGENT_BOSS_BRAIN_COMMAND ?? await this.get('boss.brain.command');
    return { provider, model, command };
  }

  async setBossBrainConfig(config: BossBrainConfig): Promise<void> {
    await this.set('boss.brain.provider', config.provider);
    if (config.model) {
      await this.set('boss.brain.model', config.model);
    } else {
      await this.unset('boss.brain.model');
    }
    if (config.command) {
      await this.set('boss.brain.command', config.command);
    } else {
      await this.unset('boss.brain.command');
    }
  }

  async clearBossBrainConfig(): Promise<void> {
    await this.set('boss.brain.provider', 'rule');
    await this.unset('boss.brain.model');
    await this.unset('boss.brain.command');
  }
}

export function parseBossBrainProvider(value: string): BossBrainProvider {
  if (value === 'rule' || value === 'codex' || value === 'claude' || value === 'hermes') {
    return value;
  }
  throw new Error(`Invalid Boss brain provider: ${value}. Allowed: rule, codex, claude, hermes`);
}
