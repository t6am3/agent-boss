import { mkdirSync } from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

export class Database {
  private constructor(private readonly db: sqlite3.Database) {}

  static async openDefault(cwd = process.cwd()): Promise<Database> {
    const dataDir = path.join(cwd, '.agent-boss');
    mkdirSync(dataDir, { recursive: true });
    const db = new Database(new sqlite3.Database(path.join(dataDir, 'agent-boss.sqlite')));
    await db.initialize();
    return db;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.db.close((err) => (err ? reject(err) : resolve()));
    });
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      this.db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T | undefined)));
    });
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[])));
    });
  }

  private async initialize(): Promise<void> {
    await this.run(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        provider TEXT,
        plan TEXT,
        scenes TEXT NOT NULL,
        cost_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL,
        risk TEXT NOT NULL,
        owner_needed INTEGER NOT NULL,
        current_assignee TEXT,
        next_action TEXT,
        summary TEXT,
        asset_ids TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS mission_events (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL REFERENCES missions(id),
        type TEXT NOT NULL,
        actor TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS supervisor_decisions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL REFERENCES missions(id),
        question TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        category TEXT NOT NULL,
        escalated_to_owner INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS evaluations (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL REFERENCES missions(id),
        score TEXT NOT NULL,
        comment TEXT NOT NULL,
        asset_ids TEXT NOT NULL,
        quality_notes TEXT,
        cost_notes TEXT,
        lessons TEXT,
        created_at INTEGER NOT NULL
      )
    `);
  }
}
