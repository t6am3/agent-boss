import { AssetLedger } from './AssetLedger';
import { EvaluationEngine } from './EvaluationEngine';
import { MissionStore } from './MissionStore';
import { CodexRunner, MockMissionRunner, OpenClawRunner } from './MissionRunner';
import { Reporter } from './Reporter';
import { Supervisor } from './Supervisor';
import { Database } from '../storage/Database';

export interface AppContext {
  db: Database;
  assets: AssetLedger;
  missions: MissionStore;
  supervisor: Supervisor;
  runner: MockMissionRunner;
  openClawRunner: OpenClawRunner;
  codexRunner: CodexRunner;
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
  const missions = new MissionStore(db);
  const supervisor = new Supervisor(db);
  return {
    db,
    assets,
    missions,
    supervisor,
    runner: new MockMissionRunner(missions, supervisor),
    openClawRunner: new OpenClawRunner(missions, supervisor),
    codexRunner: new CodexRunner(missions, supervisor),
    reporter: new Reporter(),
    evaluations: new EvaluationEngine(db, missions),
  };
}
