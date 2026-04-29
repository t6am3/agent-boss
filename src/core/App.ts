import { AssetLedger } from './AssetLedger';
import { EvaluationEngine } from './EvaluationEngine';
import { MissionStore } from './MissionStore';
import { Reporter } from './Reporter';
import { Supervisor } from './Supervisor';
import { Database } from '../storage/Database';

export interface AppContext {
  db: Database;
  assets: AssetLedger;
  missions: MissionStore;
  supervisor: Supervisor;
  reporter: Reporter;
  evaluations: EvaluationEngine;
}

export async function createApp(): Promise<AppContext> {
  const db = await Database.openDefault();
  const assets = new AssetLedger(db);
  const missions = new MissionStore(db);
  return {
    db,
    assets,
    missions,
    supervisor: new Supervisor(db),
    reporter: new Reporter(),
    evaluations: new EvaluationEngine(db, missions),
  };
}
