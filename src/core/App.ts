import { AssetLedger } from './AssetLedger';
import { EvaluationEngine } from './EvaluationEngine';
import { MissionStore } from './MissionStore';
import { ClaudeRunner, CodexRunner, HermesRunner, MockMissionRunner, OpenClawRunner } from './MissionRunner';
import { BossWorkspaceRunner } from './BossWorkspaceRunner';
import { Reporter } from './Reporter';
import { SettingsStore } from './SettingsStore';
import { Supervisor } from './Supervisor';
import { Database } from '../storage/Database';

export interface AppContext {
  db: Database;
  assets: AssetLedger;
  settings: SettingsStore;
  missions: MissionStore;
  supervisor: Supervisor;
  runner: MockMissionRunner;
  workspaceRunner: BossWorkspaceRunner;
  openClawRunner: OpenClawRunner;
  codexRunner: CodexRunner;
  claudeRunner: ClaudeRunner;
  hermesRunner: HermesRunner;
  reporter: Reporter;
  evaluations: EvaluationEngine;
}

export interface CreateAppOptions {
  cwd?: string;
  dbPath?: string;
}

export async function createApp(options: CreateAppOptions = {}): Promise<AppContext> {
  const db = await Database.openDefault(options.cwd, options.dbPath);
  const assets = new AssetLedger(db);
  const settings = new SettingsStore(db);
  const missions = new MissionStore(db);
  const supervisor = new Supervisor(db);
  return {
    db,
    assets,
    settings,
    missions,
    supervisor,
    runner: new MockMissionRunner(missions, supervisor),
    workspaceRunner: new BossWorkspaceRunner(missions, options.cwd ?? process.cwd()),
    openClawRunner: new OpenClawRunner(missions, supervisor),
    codexRunner: new CodexRunner(missions, supervisor),
    claudeRunner: new ClaudeRunner(missions, supervisor),
    hermesRunner: new HermesRunner(missions, supervisor),
    reporter: new Reporter(),
    evaluations: new EvaluationEngine(db, missions),
  };
}
