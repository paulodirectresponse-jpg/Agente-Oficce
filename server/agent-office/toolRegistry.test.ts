import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from './database.js';
import { AgentRepositoryV2, ProviderRepositoryV2 } from './v2DataModel.js';
import { AgentToolPolicyRepository, ToolRegistry } from './toolRegistry.js';

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-tools-'));
  const projectRoot = path.join(dataDir, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'README.md'), 'hello tools', 'utf8');

  const database = openAgentOfficeDatabase({
    dataDir,
    databasePath: path.join(dataDir, 'office.sqlite'),
    logLevel: 'silent',
  });
  const now = new Date().toISOString();
  database.connection.prepare(`
    INSERT INTO projects (id, name, root_path, git_enabled, git_branch, created_at, updated_at)
    VALUES ('project-1', 'Project', ?, 0, NULL, ?, ?)
  `).run(projectRoot, now, now);
  database.connection.prepare(`
    INSERT INTO conversations (id, project_id, title, created_at, updated_at)
    VALUES ('conversation-1', 'project-1', 'Conversation', ?, ?)
  `).run(now, now);

  const providers = new ProviderRepositoryV2(database.connection);
  providers.create({
    id: 'provider',
    name: 'Provider',
    protocol_driver: 'openai_chat',
    base_url: 'https://provider.example',
    auth_driver: 'none',
  });
  const model = providers.createModel('provider', { model_id: 'model', enabled: true, is_default: true });
  const agent = new AgentRepositoryV2(database.connection).create({
    id: 'agent',
    name: 'Agent',
    slug: 'agent',
    provider_id: 'provider',
    model_id: model.id,
  });
  database.connection.prepare(`
    INSERT INTO chat_runs (
      id, conversation_id, project_id, agent_id, provider_id, model_id,
      status, mode, parent_run_id, started_at, metadata_json
    ) VALUES ('run-1', 'conversation-1', 'project-1', ?, 'provider', ?, 'running', 'single', NULL, ?, '{}')
  `).run(agent.id, model.id, now);

  return {
    dataDir,
    projectRoot,
    database,
    agent,
    cleanup() {
      database.connection.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

describe('Phase H tool registry', () => {
  it('keeps tools disabled by default and persists an explicit per-agent policy', () => {
    const f = fixture();
    const policies = new AgentToolPolicyRepository(f.database.connection);
    expect(policies.get(f.agent.id).enabled).toBe(false);

    const saved = policies.save({
      agent_id: f.agent.id,
      enabled: true,
      allowed_tools: ['read_file', 'write_file', 'run_tests'],
      approval_mode: 'safe',
      max_tool_steps: 7,
    });
    expect(saved).toMatchObject({
      enabled: true,
      allowed_tools: ['read_file', 'write_file', 'run_tests'],
      approval_mode: 'safe',
      max_tool_steps: 7,
    });
    f.cleanup();
  });

  it('executes permitted project-root tools and stores bounded audit metadata', async () => {
    const f = fixture();
    const policies = new AgentToolPolicyRepository(f.database.connection);
    const policy = policies.save({
      agent_id: f.agent.id,
      enabled: true,
      allowed_tools: ['read_file', 'write_file'],
      approval_mode: 'safe',
      max_tool_steps: 5,
    });
    const registry = new ToolRegistry();

    const read = await registry.execute('read_file', { path: 'README.md' }, policy, {
      database: f.database.connection,
      project_id: 'project-1',
      project_root: f.projectRoot,
      run_id: 'run-1',
      agent_id: f.agent.id,
    });
    expect(read.ok).toBe(true);
    expect(read.data?.content).toBe('hello tools');

    const write = await registry.execute('write_file', { path: 'src.txt', content: 'secret-ish content' }, policy, {
      database: f.database.connection,
      project_id: 'project-1',
      project_root: f.projectRoot,
      run_id: 'run-1',
      agent_id: f.agent.id,
    });
    expect(write.ok).toBe(true);
    expect(fs.readFileSync(path.join(f.projectRoot, 'src.txt'), 'utf8')).toBe('secret-ish content');

    const rows = f.database.connection.prepare('SELECT tool_name, input_json, result_json FROM tool_audit_events ORDER BY started_at').all() as Array<any>;
    expect(rows).toHaveLength(2);
    expect(rows[0].result_json).not.toContain('hello tools');
    expect(rows[1].input_json).not.toContain('secret-ish content');
    expect(JSON.parse(rows[1].input_json)).toMatchObject({ path: 'src.txt', content_bytes: 18 });
    f.cleanup();
  });

  it('creates an approval gate for run_command in safe mode', async () => {
    const f = fixture();
    const policy = new AgentToolPolicyRepository(f.database.connection).save({
      agent_id: f.agent.id,
      enabled: true,
      allowed_tools: ['run_command'],
      approval_mode: 'safe',
      max_tool_steps: 5,
    });

    const result = await new ToolRegistry().execute('run_command', { command: ['git', 'status', '--short'] }, policy, {
      database: f.database.connection,
      project_id: 'project-1',
      project_root: f.projectRoot,
      run_id: 'run-1',
      agent_id: f.agent.id,
    });
    expect(result).toMatchObject({ ok: false, approval_required: true, error: 'TOOL_APPROVAL_REQUIRED' });
    const approval = f.database.connection.prepare('SELECT status, tool_name FROM tool_approvals').get() as any;
    expect(approval).toMatchObject({ status: 'pending', tool_name: 'run_command' });
    f.cleanup();
  });
});
