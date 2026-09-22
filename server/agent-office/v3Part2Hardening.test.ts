import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from './database.js';
import { AgentRepositoryV2, ChatRunRepository, ProviderRepositoryV2 } from './v2DataModel.js';
import { ConversationRepository } from './conversationRepository.js';
import { AgentRelationRepository, AgentToolPolicyRepository, ToolRegistry } from './toolRegistry.js';
import { recoverInterruptedChatRuns } from './runtimeRecovery.js';
import { redactSecrets } from './securitySanitizer.js';

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-v3-part2-'));
  const projectRoot = path.join(dataDir, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
  const now = new Date().toISOString();
  database.connection.prepare(
    'INSERT INTO projects (id, name, root_path, git_enabled, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
  ).run('p1', 'Project', projectRoot, now, now);
  const conversationId = new ConversationRepository(database.connection).ensureForProject('p1');
  const providers = new ProviderRepositoryV2(database.connection);
  providers.create({ id: 'provider', name: 'Provider', protocol_driver: 'openai_chat', auth_driver: 'none' });
  const model = providers.createModel('provider', { model_id: 'model', is_default: true });
  const agents = new AgentRepositoryV2(database.connection);
  for (const id of ['a', 'b', 'c', 'd']) {
    agents.create({ id, name: id.toUpperCase(), slug: id, provider_id: 'provider', model_id: model.id });
  }
  const run = new ChatRunRepository(database.connection).create({
    conversation_id: conversationId, project_id: 'p1', agent_id: 'a', provider_id: 'provider', model_id: model.id, status: 'running',
  });
  return {
    dataDir, projectRoot, database, run,
    cleanup() { database.connection.close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

describe('V3 part 2 hierarchy integrity', () => {
  it('rejects self cycles, duplicate children, missing agents and transitive cycles atomically', () => {
    const f = fixture();
    try {
      const relations = new AgentRelationRepository(f.database.connection);
      expect(() => relations.replaceChildren('a', ['a'])).toThrow('AGENT_RELATION_SELF_CYCLE');
      expect(() => relations.replaceChildren('a', ['b', 'b'])).toThrow('AGENT_RELATION_DUPLICATE');
      expect(() => relations.replaceChildren('a', ['missing'])).toThrow('AGENT_RELATION_CHILD_NOT_FOUND');

      relations.replaceChildren('a', ['b']);
      relations.replaceChildren('b', ['c']);
      expect(() => relations.replaceChildren('c', ['a'])).toThrow('AGENT_RELATION_CYCLE');
      expect(relations.listChildren('a').map(row => row.child_agent_id)).toEqual(['b']);
      expect(relations.listChildren('b').map(row => row.child_agent_id)).toEqual(['c']);
      expect(relations.listChildren('c')).toEqual([]);
    } finally { f.cleanup(); }
  });

  it('enforces the hierarchy depth budget', () => {
    const f = fixture();
    try {
      const agents = new AgentRepositoryV2(f.database.connection);
      const model = new ProviderRepositoryV2(f.database.connection).listModels('provider', true)[0];
      for (let i = 0; i < 14; i += 1) {
        const id = `deep-${i}`;
        agents.create({ id, name: id, slug: id, provider_id: 'provider', model_id: model.id });
      }
      const relations = new AgentRelationRepository(f.database.connection);
      for (let i = 0; i < 12; i += 1) relations.replaceChildren(`deep-${i}`, [`deep-${i + 1}`]);
      expect(() => relations.replaceChildren('deep-12', ['deep-13'])).toThrow('AGENT_RELATION_MAX_DEPTH');
    } finally { f.cleanup(); }
  });
});

describe('V3 part 2 tool replay integrity', () => {
  it('deduplicates a completed tool call by run/agent/idempotency key', async () => {
    const f = fixture();
    try {
      const policy = new AgentToolPolicyRepository(f.database.connection).save({
        agent_id: 'a', enabled: true, allowed_tools: ['write_file'], approval_mode: 'safe', max_tool_steps: 5,
      });
      const registry = new ToolRegistry();
      const context = {
        database: f.database.connection, project_id: 'p1', project_root: f.projectRoot,
        run_id: f.run.id, agent_id: 'a', idempotency_key: 'call-1',
      };
      const first = await registry.execute('write_file', { path: 'x.txt', content: 'first' }, policy, context);
      expect(first.ok).toBe(true);
      const second = await registry.execute('write_file', { path: 'x.txt', content: 'changed' }, policy, context);
      expect(second).toMatchObject({ ok: true, audit_id: first.audit_id, data: { idempotent_replay: true } });
      expect(fs.readFileSync(path.join(f.projectRoot, 'x.txt'), 'utf8')).toBe('first');
      const count = f.database.connection.prepare('SELECT COUNT(*) AS c FROM tool_audit_events').get() as { c: number };
      expect(count.c).toBe(1);
    } finally { f.cleanup(); }
  });

  it('binds an approval to exact input and exact audit attempt', async () => {
    const f = fixture();
    try {
      const policy = new AgentToolPolicyRepository(f.database.connection).save({
        agent_id: 'a', enabled: true, allowed_tools: ['write_file'], approval_mode: 'manual', max_tool_steps: 5,
      });
      const registry = new ToolRegistry();
      const context = {
        database: f.database.connection, project_id: 'p1', project_root: f.projectRoot,
        run_id: f.run.id, agent_id: 'a', idempotency_key: 'call-approved',
      };
      const input = { path: 'approved.txt', content: 'original' };
      const gated = await registry.execute('write_file', input, policy, context);
      f.database.connection.prepare("UPDATE tool_approvals SET status='approved', resolved_at=? WHERE id=?")
        .run(new Date().toISOString(), gated.approval_id);

      const changed = await registry.executeApproved('write_file', { ...input, content: 'tampered' }, policy, context, gated.approval_id!, gated.audit_id);
      expect(changed.error).toBe('TOOL_APPROVAL_INVALID');

      const wrongAudit = await registry.executeApproved('write_file', input, policy, context, gated.approval_id!, 'not-the-audit');
      expect(wrongAudit.error).toBe('TOOL_APPROVAL_INVALID');

      const executed = await registry.executeApproved('write_file', input, policy, context, gated.approval_id!, gated.audit_id);
      expect(executed.ok).toBe(true);
      const replay = await registry.executeApproved('write_file', input, policy, context, gated.approval_id!, gated.audit_id);
      expect(replay).toMatchObject({ ok: true, data: { idempotent_replay: true } });
    } finally { f.cleanup(); }
  });

  it('does not execute an approved tool after its run is no longer active', async () => {
    const f = fixture();
    try {
      const policy = new AgentToolPolicyRepository(f.database.connection).save({
        agent_id: 'a', enabled: true, allowed_tools: ['write_file'], approval_mode: 'manual', max_tool_steps: 5,
      });
      const registry = new ToolRegistry();
      const context = { database: f.database.connection, project_id: 'p1', project_root: f.projectRoot, run_id: f.run.id, agent_id: 'a' };
      const input = { path: 'late.txt', content: 'late' };
      const gated = await registry.execute('write_file', input, policy, context);
      f.database.connection.prepare("UPDATE tool_approvals SET status='approved' WHERE id=?").run(gated.approval_id);
      f.database.connection.prepare("UPDATE chat_runs SET status='failed' WHERE id=?").run(f.run.id);
      const result = await registry.executeApproved('write_file', input, policy, context, gated.approval_id!, gated.audit_id);
      expect(result.error).toBe('TOOL_RUN_NOT_ACTIVE');
      expect(fs.existsSync(path.join(f.projectRoot, 'late.txt'))).toBe(false);
    } finally { f.cleanup(); }
  });
});

describe('V3 part 2 redaction and restart recovery', () => {
  it('redacts nested secret keys and common credential-shaped values', () => {
    const value = redactSecrets({
      authorization: 'Bearer abcdefghijklmnop',
      nested: { api_key: 'sk-abcdefghijklmnop', safe: 'hello' },
      args: ['--header', 'Bearer qwertyuiopasdfgh'],
    }) as any;
    expect(JSON.stringify(value)).not.toContain('abcdefghijklmnop');
    expect(JSON.stringify(value)).not.toContain('qwertyuiopasdfgh');
    expect(value.nested.safe).toBe('hello');
  });

  it('invalidates pending/approved tool permissions when recovering an interrupted run', async () => {
    const f = fixture();
    try {
      const policy = new AgentToolPolicyRepository(f.database.connection).save({
        agent_id: 'a', enabled: true, allowed_tools: ['write_file'], approval_mode: 'manual', max_tool_steps: 5,
      });
      const registry = new ToolRegistry();
      const context = { database: f.database.connection, project_id: 'p1', project_root: f.projectRoot, run_id: f.run.id, agent_id: 'a' };
      const gated = await registry.execute('write_file', { path: 'never.txt', content: 'secret' }, policy, context);
      expect(gated.approval_required).toBe(true);

      recoverInterruptedChatRuns(f.database.connection);
      const approval = f.database.connection.prepare('SELECT status, resolved_at FROM tool_approvals WHERE id=?').get(gated.approval_id) as any;
      const audit = f.database.connection.prepare('SELECT status, result_json FROM tool_audit_events WHERE id=?').get(gated.audit_id) as any;
      expect(approval.status).toBe('denied');
      expect(approval.resolved_at).toBeTruthy();
      expect(audit.status).toBe('failed');
      expect(audit.result_json).toContain('RUN_INTERRUPTED_BY_RESTART');
    } finally { f.cleanup(); }
  });
});
