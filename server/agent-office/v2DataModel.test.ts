import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { agentOfficeMigrations, openAgentOfficeDatabase } from './database.js';
import {
  ActivityRepository,
  AgentRepositoryV2,
  AgentStateRepository,
  ChatRunRepository,
  ProviderRepositoryV2,
} from './v2DataModel.js';

function tempConfig(prefix = 'agent-office-v2-') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dataDir,
    databasePath: path.join(dataDir, 'office.sqlite'),
    logLevel: 'silent' as const,
  };
}

describe('V2 data model', () => {
  it('migrates a V1/V3 database non-destructively and backfills legacy providers/models/agents', () => {
    const config = tempConfig('agent-office-v2-migration-');
    const legacy = new Database(config.databasePath);
    legacy.exec('PRAGMA foreign_keys = ON;');
    legacy.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');

    for (const migration of agentOfficeMigrations.slice(0, 3)) {
      legacy.exec('BEGIN');
      legacy.exec(migration.sql);
      legacy.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
      legacy.exec('COMMIT');
    }

    const timestamp = new Date().toISOString();
    legacy.prepare(`
      INSERT INTO projects (id, name, root_path, git_enabled, git_branch, created_at, updated_at)
      VALUES ('legacy-project', 'Legacy Project', ?, 0, NULL, ?, ?)
    `).run(path.join(config.dataDir, 'legacy-project'), timestamp, timestamp);
    legacy.prepare(`
      INSERT INTO provider_configs (
        provider_id, base_url, model, auth_scheme, auth_header, custom_headers_json,
        timeout_ms, health_endpoint, health_method, secret_ref, max_tool_steps, updated_at
      ) VALUES ('claude', 'https://gateway.example', 'claude-model', 'x-api-key', NULL, '{}', 60000, '/health', 'GET', 'claude-secret', 20, ?)
    `).run(timestamp);
    legacy.close();

    const migrated = openAgentOfficeDatabase(config);
    expect(migrated.connection.prepare('SELECT version FROM schema_migrations ORDER BY version').all())
      .toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }]);

    expect(migrated.connection.prepare('SELECT name FROM projects WHERE id = ?').get('legacy-project'))
      .toEqual({ name: 'Legacy Project' });

    expect(migrated.connection.prepare('SELECT id, protocol_driver, secret_ref FROM providers WHERE id = ?').get('claude'))
      .toEqual({ id: 'claude', protocol_driver: 'anthropic_messages', secret_ref: 'claude-secret' });

    expect(migrated.connection.prepare('SELECT provider_id, model_id, is_default FROM provider_models WHERE id = ?').get('claude:legacy-default'))
      .toEqual({ provider_id: 'claude', model_id: 'claude-model', is_default: 1 });

    expect(migrated.connection.prepare('SELECT id, provider_id, model_id FROM agents WHERE id = ?').get('claude'))
      .toEqual({ id: 'claude', provider_id: 'claude', model_id: 'claude:legacy-default' });

    expect(migrated.connection.prepare('SELECT id FROM agents ORDER BY sort_order').all())
      .toEqual([{ id: 'kimi' }, { id: 'claude' }, { id: 'codex' }]);

    migrated.connection.close();
    fs.rmSync(config.dataDir, { recursive: true, force: true });
  });

  it('supports multiple models per provider and only one selected default', () => {
    const config = tempConfig();
    const database = openAgentOfficeDatabase(config);
    const providers = new ProviderRepositoryV2(database.connection);

    const provider = providers.create({
      id: 'custom-provider',
      name: 'Custom Provider',
      protocol_driver: 'openai_chat',
      base_url: 'https://api.example',
      auth_driver: 'bearer',
      headers: { 'x-client': 'agent-office' },
    });

    const first = providers.createModel(provider.id, {
      model_id: 'small',
      display_name: 'Small',
      is_default: true,
      capabilities: { text: true, streaming: true },
    });
    const second = providers.createModel(provider.id, {
      model_id: 'large',
      display_name: 'Large',
      is_default: true,
      context_window: 128000,
    });

    const models = providers.listModels(provider.id);
    expect(models).toHaveLength(2);
    expect(models.find((model) => model.id === first.id)?.is_default).toBe(false);
    expect(models.find((model) => model.id === second.id)?.is_default).toBe(true);
    expect(models.find((model) => model.id === second.id)?.context_window).toBe(128000);

    const updated = providers.update(provider.id, { health_status: 'healthy', enabled: false });
    expect(updated.health_status).toBe('healthy');
    expect(updated.enabled).toBe(false);

    database.connection.close();
    fs.rmSync(config.dataDir, { recursive: true, force: true });
  });

  it('supports dynamic agents and validates provider/model bindings', () => {
    const config = tempConfig();
    const database = openAgentOfficeDatabase(config);
    const providers = new ProviderRepositoryV2(database.connection);
    const agents = new AgentRepositoryV2(database.connection);

    const providerA = providers.create({ id: 'a', name: 'A', protocol_driver: 'openai_chat' });
    const providerB = providers.create({ id: 'b', name: 'B', protocol_driver: 'anthropic_messages' });
    const modelA = providers.createModel(providerA.id, { model_id: 'model-a', is_default: true });
    const modelB = providers.createModel(providerB.id, { model_id: 'model-b', is_default: true });

    const agent = agents.create({
      name: 'Frontend Agent',
      slug: 'frontend-agent',
      role: 'Frontend',
      provider_id: providerA.id,
      model_id: modelA.id,
      system_prompt: 'Focus on frontend.',
      metadata: { color: 'blue' },
    });

    expect(agent.id).not.toBe('kimi');
    expect(agents.getBySlug('frontend-agent')?.provider_id).toBe('a');
    expect(() => agents.update(agent.id, { model_id: modelB.id })).toThrow('AGENT_MODEL_PROVIDER_MISMATCH');

    const rebound = agents.update(agent.id, { provider_id: providerB.id, model_id: modelB.id });
    expect(rebound.provider_id).toBe(providerB.id);
    expect(rebound.model_id).toBe(modelB.id);

    providers.delete(providerB.id);
    const detached = agents.get(agent.id)!;
    expect(detached.provider_id).toBeNull();
    expect(detached.model_id).toBeNull();

    database.connection.close();
    fs.rmSync(config.dataDir, { recursive: true, force: true });
  });

  it('persists chat runs, activity timeline and current agent state', () => {
    const config = tempConfig();
    fs.mkdirSync(path.join(config.dataDir, 'project'), { recursive: true });
    const database = openAgentOfficeDatabase(config);

    const timestamp = new Date().toISOString();
    database.connection.prepare(`
      INSERT INTO projects (id, name, root_path, git_enabled, git_branch, created_at, updated_at)
      VALUES ('project-1', 'Project', ?, 0, NULL, ?, ?)
    `).run(path.join(config.dataDir, 'project'), timestamp, timestamp);
    database.connection.prepare(`
      INSERT INTO conversations (id, project_id, title, created_at, updated_at)
      VALUES ('conversation-1', 'project-1', 'Main', ?, ?)
    `).run(timestamp, timestamp);

    const providers = new ProviderRepositoryV2(database.connection);
    const agents = new AgentRepositoryV2(database.connection);
    const runs = new ChatRunRepository(database.connection);
    const activity = new ActivityRepository(database.connection);
    const states = new AgentStateRepository(database.connection);

    const provider = providers.create({ id: 'provider', name: 'Provider', protocol_driver: 'openai_chat' });
    const model = providers.createModel(provider.id, { model_id: 'model', is_default: true });
    const agent = agents.create({
      id: 'dynamic-agent',
      name: 'Dynamic Agent',
      slug: 'dynamic-agent',
      provider_id: provider.id,
      model_id: model.id,
    });

    const run = runs.create({
      conversation_id: 'conversation-1',
      project_id: 'project-1',
      agent_id: agent.id,
      provider_id: provider.id,
      model_id: model.id,
      mode: 'team',
      metadata: { source: 'test' },
    });

    activity.append({
      project_id: 'project-1',
      conversation_id: 'conversation-1',
      run_id: run.id,
      agent_id: agent.id,
      type: 'agent.state',
      title: 'Dynamic Agent está pensando',
      payload: { state: 'thinking' },
    });

    const state = states.upsert({
      agent_id: agent.id,
      project_id: 'project-1',
      run_id: run.id,
      state: 'thinking',
      activity: 'Planejando resposta',
      progress: 0.25,
    });

    expect(state.progress).toBe(0.25);
    expect(activity.listForRun(run.id)).toHaveLength(1);

    const completed = runs.update(run.id, {
      status: 'completed',
      ended_at: new Date().toISOString(),
      input_tokens: 120,
      output_tokens: 42,
      metadata: { source: 'test', final: true },
    });
    expect(completed.output_tokens).toBe(42);

    states.clearRun(run.id);
    const after = states.listForProject('project-1')[0];
    expect(after.state).toBe('idle');
    expect(after.run_id).toBeNull();

    expect(runs.delete(run.id)).toBe(true);
    expect(activity.listForRun(run.id)).toHaveLength(0);

    database.connection.close();
    fs.rmSync(config.dataDir, { recursive: true, force: true });
  });
});
