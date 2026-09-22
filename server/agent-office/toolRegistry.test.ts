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

describe('Block 1 Full Access registry', () => {
  it('gives every agent Full Access by default', () => {
    const f = fixture();
    const policy = new AgentToolPolicyRepository(f.database.connection).get(f.agent.id);
    expect(policy.enabled).toBe(true);
    expect(policy.approval_mode).toBe('auto');
    expect(policy.max_tool_steps).toBeGreaterThanOrEqual(200);
    expect(policy.allowed_tools).toContain('shell_command');
    expect(policy.allowed_tools).toContain('git_command');
    expect(policy.allowed_tools).toContain('github_command');
    expect(policy.allowed_tools).toContain('browser_open');
    expect(policy.allowed_tools).toContain('computer_screenshot');
    expect(policy.allowed_tools).toContain('deploy_command');
    f.cleanup();
  });

  it('cannot be downgraded to a disabled tool policy', () => {
    const f = fixture();
    const policies = new AgentToolPolicyRepository(f.database.connection);
    const saved = policies.save({
      agent_id: f.agent.id,
      enabled: false,
      allowed_tools: [],
      approval_mode: 'manual',
      max_tool_steps: 1,
    });
    expect(saved.enabled).toBe(true);
    expect(saved.approval_mode).toBe('auto');
    expect(saved.max_tool_steps).toBeGreaterThanOrEqual(200);
    expect(saved.allowed_tools.length).toBeGreaterThan(10);
    f.cleanup();
  });

  it('executes project tools and Full Access shell tools with audit records', async () => {
    const f = fixture();
    const policy = new AgentToolPolicyRepository(f.database.connection).get(f.agent.id);
    const registry = new ToolRegistry();
    const context = {
      database: f.database.connection,
      project_id: 'project-1',
      project_root: f.projectRoot,
      run_id: 'run-1',
      agent_id: f.agent.id,
    };

    const read = await registry.execute('read_file', { path: 'README.md' }, policy, context);
    expect(read.ok).toBe(true);

    const shell = await registry.execute('shell_command', { command: 'node --version' }, policy, context);
    expect(shell.ok).toBe(true);
    expect(String(shell.data?.stdout ?? '')).toMatch(/^v\d+/);

    const rows = f.database.connection.prepare('SELECT tool_name, status FROM tool_audit_events ORDER BY started_at').all() as Array<any>;
    expect(rows.map(row => row.tool_name)).toEqual(expect.arrayContaining(['read_file', 'shell_command']));
    expect(rows.every(row => row.status === 'completed')).toBe(true);
    f.cleanup();
  });
});
