import fs from 'node:fs';
import path from 'node:path';
import { ensureAgentOfficeDataDir, getAgentOfficeConfig } from './config.js';
import Database from 'better-sqlite3';

export interface AgentOfficeDatabase {
  connection: Database.Database;
  path: string;
}

export const agentOfficeMigrations: Array<{ version: number; sql: string }> = [
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
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        protocol_driver TEXT NOT NULL,
        base_url TEXT NOT NULL DEFAULT '',
        auth_driver TEXT NOT NULL DEFAULT 'bearer',
        secret_ref TEXT,
        headers_json TEXT NOT NULL DEFAULT '{}',
        query_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        health_status TEXT NOT NULL DEFAULT 'unknown',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_models (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        context_window INTEGER,
        max_output_tokens INTEGER,
        pricing_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(provider_id, model_id)
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        avatar_key TEXT NOT NULL DEFAULT 'default',
        provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
        model_id TEXT REFERENCES provider_models(id) ON DELETE SET NULL,
        system_prompt TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        sort_order INTEGER NOT NULL DEFAULT 0,
        idle_after_seconds INTEGER NOT NULL DEFAULT 300,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
        model_id TEXT REFERENCES provider_models(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'single' CHECK(mode IN ('single', 'team', 'review')),
        parent_run_id TEXT REFERENCES chat_runs(id) ON DELETE SET NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        error_json TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES chat_runs(id) ON DELETE CASCADE,
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('debug', 'info', 'warning', 'error')),
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_states (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES chat_runs(id) ON DELETE SET NULL,
        state TEXT NOT NULL DEFAULT 'offline',
        activity TEXT NOT NULL DEFAULT '',
        progress REAL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id, enabled, is_default);
      CREATE INDEX IF NOT EXISTS idx_agents_enabled_order ON agents(enabled, sort_order, name);
      CREATE INDEX IF NOT EXISTS idx_agents_provider_model ON agents(provider_id, model_id);
      CREATE INDEX IF NOT EXISTS idx_chat_runs_project_started ON chat_runs(project_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_runs_conversation_started ON chat_runs(conversation_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_events_project_created ON activity_events(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_events_run_created ON activity_events(run_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_states_project ON agent_states(project_id, updated_at DESC);

      INSERT OR IGNORE INTO providers (
        id, name, protocol_driver, base_url, auth_driver, secret_ref,
        headers_json, query_json, enabled, health_status, created_at, updated_at
      )
      SELECT
        provider_id,
        provider_id,
        CASE
          WHEN provider_id = 'claude' THEN 'anthropic_messages'
          WHEN provider_id = 'kimi' THEN 'openai_chat'
          ELSE 'legacy'
        END,
        base_url,
        auth_scheme,
        secret_ref,
        custom_headers_json,
        '{}',
        1,
        'unknown',
        updated_at,
        updated_at
      FROM provider_configs;

      INSERT OR IGNORE INTO provider_models (
        id, provider_id, model_id, display_name, capabilities_json,
        context_window, max_output_tokens, pricing_json, metadata_json,
        enabled, is_default, created_at, updated_at
      )
      SELECT
        provider_id || ':legacy-default',
        provider_id,
        model,
        model,
        '{}',
        NULL,
        NULL,
        '{}',
        '{"source":"legacy_provider_config"}',
        1,
        1,
        updated_at,
        updated_at
      FROM provider_configs
      WHERE TRIM(model) <> '';

      INSERT OR IGNORE INTO agents (
        id, name, slug, role, description, avatar_key, provider_id, model_id,
        system_prompt, enabled, sort_order, idle_after_seconds, metadata_json,
        created_at, updated_at
      ) VALUES
        (
          'kimi', 'Kimi', 'kimi', 'Executor',
          'Agente legado preservado durante a migração V2.', 'kimi',
          CASE WHEN EXISTS(SELECT 1 FROM providers WHERE id = 'kimi') THEN 'kimi' ELSE NULL END,
          CASE WHEN EXISTS(SELECT 1 FROM provider_models WHERE id = 'kimi:legacy-default') THEN 'kimi:legacy-default' ELSE NULL END,
          '', 1, 10, 300, '{"source":"legacy_seed"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ),
        (
          'claude', 'Claude', 'claude', 'Reviewer',
          'Agente legado preservado durante a migração V2.', 'claude',
          CASE WHEN EXISTS(SELECT 1 FROM providers WHERE id = 'claude') THEN 'claude' ELSE NULL END,
          CASE WHEN EXISTS(SELECT 1 FROM provider_models WHERE id = 'claude:legacy-default') THEN 'claude:legacy-default' ELSE NULL END,
          '', 1, 20, 300, '{"source":"legacy_seed"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ),
        (
          'codex', 'Codex', 'codex', 'Architect',
          'Agente legado preservado durante a migração V2.', 'codex',
          NULL, NULL, '', 1, 30, 300, '{"source":"legacy_seed"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        );
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE providers ADD COLUMN auth_config_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE providers ADD COLUMN protocol_config_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE providers ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 60000;
      ALTER TABLE providers ADD COLUMN last_health_at TEXT;
      ALTER TABLE providers ADD COLUMN last_health_error TEXT;
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE IF NOT EXISTS agent_tool_policies (
        agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
        allowed_tools_json TEXT NOT NULL DEFAULT '[]',
        approval_mode TEXT NOT NULL DEFAULT 'safe' CHECK(approval_mode IN ('safe', 'manual', 'auto')),
        max_tool_steps INTEGER NOT NULL DEFAULT 12,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_audit_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES chat_runs(id) ON DELETE SET NULL,
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        tool_name TEXT NOT NULL,
        risk TEXT NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tool_approvals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES chat_runs(id) ON DELETE CASCADE,
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied')),
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_relations (
        parent_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        child_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL DEFAULT 'supervises',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        priority INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(parent_agent_id, child_agent_id, relation_type),
        CHECK(parent_agent_id <> child_agent_id)
      );

      CREATE INDEX IF NOT EXISTS idx_tool_audit_run ON tool_audit_events(run_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_tool_approvals_run_status ON tool_approvals(run_id, status);
      CREATE INDEX IF NOT EXISTS idx_agent_relations_parent ON agent_relations(parent_agent_id, enabled, priority);
      CREATE INDEX IF NOT EXISTS idx_agent_relations_child ON agent_relations(child_agent_id, enabled);
    `,
  },
  {
    version: 7,
    sql: `
      ALTER TABLE tool_audit_events ADD COLUMN idempotency_key TEXT;
      ALTER TABLE tool_approvals ADD COLUMN input_fingerprint TEXT;
      ALTER TABLE tool_approvals ADD COLUMN audit_id TEXT REFERENCES tool_audit_events(id) ON DELETE SET NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_audit_idempotency
        ON tool_audit_events(run_id, agent_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_tool_approvals_fingerprint
        ON tool_approvals(run_id, agent_id, tool_name, input_fingerprint, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_approvals_audit
        ON tool_approvals(audit_id)
        WHERE audit_id IS NOT NULL;
    `,
  },
];

export function openAgentOfficeDatabase(config = getAgentOfficeConfig()): AgentOfficeDatabase {
  ensureAgentOfficeDataDir(config);
  const database = new Database(config.databasePath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
  const applied = new Set<number>(database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row: any) => Number(row.version)));
  for (const migration of agentOfficeMigrations) {
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
