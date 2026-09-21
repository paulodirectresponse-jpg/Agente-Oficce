import fs from 'node:fs';
import path from 'node:path';
import { ensureAgentOfficeDataDir, getAgentOfficeConfig } from './config.js';
import Database from 'better-sqlite3';

export interface AgentOfficeDatabase {
  connection: Database.Database;
  path: string;
}

const migrations: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        git_enabled INTEGER NOT NULL DEFAULT 0,
        git_branch TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'event')),
        agent_id TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'unknown',
        risk TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'queued',
        assigned_agent TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        agent_switches INTEGER NOT NULL DEFAULT 0,
        writer_lock TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        provider_session_id TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        input_summary TEXT NOT NULL DEFAULT '',
        output_summary TEXT NOT NULL DEFAULT '',
        usage_json TEXT,
        error_json TEXT
      );
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        from_agent TEXT NOT NULL,
        to_agent TEXT,
        summary TEXT NOT NULL,
        files_json TEXT NOT NULL DEFAULT '[]',
        tests_json TEXT NOT NULL DEFAULT '[]',
        decisions_json TEXT NOT NULL DEFAULT '[]',
        open_issues_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_memory (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        summary TEXT NOT NULL DEFAULT '',
        architecture TEXT NOT NULL DEFAULT '',
        rules TEXT NOT NULL DEFAULT '',
        known_issues TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        searchable_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
        text, content='memory_chunks', content_rowid='rowid'
      );
      CREATE TRIGGER IF NOT EXISTS memory_chunks_fts_ai AFTER INSERT ON memory_chunks BEGIN
        INSERT INTO memory_chunks_fts(rowid, text) VALUES (new.rowid, new.searchable_text);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_chunks_fts_ad AFTER DELETE ON memory_chunks BEGIN
        INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.searchable_text);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_chunks_fts_au AFTER UPDATE ON memory_chunks BEGIN
        INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.searchable_text);
        INSERT INTO memory_chunks_fts(rowid, text) VALUES (new.rowid, new.searchable_text);
      END;
      CREATE TABLE IF NOT EXISTS usage_snapshots (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        source TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        normalized_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_office_events (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        task_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_key TEXT UNIQUE
      );
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS provider_configs (
        provider_id TEXT PRIMARY KEY,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        auth_scheme TEXT NOT NULL,
        auth_header TEXT,
        custom_headers_json TEXT NOT NULL DEFAULT '{}',
        timeout_ms INTEGER NOT NULL DEFAULT 60000,
        health_endpoint TEXT NOT NULL DEFAULT '/v1/models',
        health_method TEXT NOT NULL DEFAULT 'GET',
        secret_ref TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runs_task_status ON runs(task_id, status);
      CREATE INDEX IF NOT EXISTS idx_tasks_project_lock ON tasks(project_id, writer_lock);
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE provider_configs ADD COLUMN max_tool_steps INTEGER NOT NULL DEFAULT 20;
    `,
  },
];

export function openAgentOfficeDatabase(config = getAgentOfficeConfig()): AgentOfficeDatabase {
  ensureAgentOfficeDataDir(config);
  const database = new Database(config.databasePath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
  const applied = new Set<number>(database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row: any) => Number(row.version)));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    database.exec('BEGIN');
    try {
      database.exec(migration.sql);
      database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      database.close();
      throw error;
    }
  }
  return { connection: database, path: path.resolve(config.databasePath) };
}

export function closeAgentOfficeDatabase(database: AgentOfficeDatabase): void {
  database.connection.close();
}

export function databaseExists(config = getAgentOfficeConfig()): boolean {
  return fs.existsSync(config.databasePath);
}
