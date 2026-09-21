import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase, closeAgentOfficeDatabase, type AgentOfficeDatabase } from './database.js';
import { MemoryRepository, ContextPackBuilder, estimateTokens, DEFAULT_CONTEXT_BUDGET } from './memory.js';
import { recordTaskCheckpoint } from './orchestrator.js';
import type { Task } from './taskRunManager.js';

describe('context pack and shared memory', () => {
  let dataDir: string;
  let database: AgentOfficeDatabase;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-memory-'));
    database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    database.connection.prepare(`INSERT INTO projects (id, name, root_path, git_enabled, created_at, updated_at) VALUES ('p1', 'P', ?, 0, 't', 't')`).run(dataDir);
    database.connection.prepare(`INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES ('c1', 'p1', 'C', 't', 't')`).run();
    database.connection.prepare(`INSERT INTO tasks (id, project_id, conversation_id, title, description, category, risk, status, created_at, updated_at) VALUES ('t1', 'p1', 'c1', 'Fix login redirect', 'The login redirect drops the session token', 'backend', 'medium', 'queued', 't', 't')`).run();
  });

  afterEach(async () => {
    closeAgentOfficeDatabase(database);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('builds a pack with all sections inside token budgets', () => {
    const memory = new MemoryRepository(database.connection);
    memory.upsertProjectMemory('p1', { summary: 'Local-first agent orchestrator', rules: 'Never delete data' });
    const builder = new ContextPackBuilder(database.connection);
    const pack = builder.build({ projectId: 'p1', taskId: 't1', conversationId: 'c1' });
    for (const section of ['SYSTEM RULES', 'PROJECT SUMMARY', 'CURRENT TASK', 'CURRENT STATE', 'RELEVANT DECISIONS', 'RELEVANT HISTORY', 'LAST HANDOFF', 'ACCEPTANCE CRITERIA']) {
      expect(pack.text).toContain(`# ${section}`);
    }
    expect(pack.text).toContain('Local-first agent orchestrator');
    expect(pack.sections['RELEVANT HISTORY']).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET.history + 10);
    const budgetTotal = DEFAULT_CONTEXT_BUDGET.system + DEFAULT_CONTEXT_BUDGET.project + DEFAULT_CONTEXT_BUDGET.task * 3 + DEFAULT_CONTEXT_BUDGET.history + DEFAULT_CONTEXT_BUDGET.handoff * 2;
    expect(pack.tokens).toBeLessThanOrEqual(budgetTotal + 200);
  });

  it('retrieves task-relevant chunks via FTS', () => {
    const memory = new MemoryRepository(database.connection);
    memory.addChunk({ projectId: 'p1', taskId: 't1', kind: 'task_summary', text: 'Investigated login redirect dropping session token in auth module' });
    memory.addChunk({ projectId: 'p1', kind: 'note', text: 'Unrelated styling tweaks for the dashboard' });
    const results = memory.search('p1', 'Fix login redirect session token', 't1');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain('session token');
  });

  it('injects the last handoff into the next agent context pack', () => {
    const memory = new MemoryRepository(database.connection);
    memory.createHandoff({ taskId: 't1', fromAgent: 'kimi', toAgent: 'claude', summary: 'Found the bug in redirect handler', files: ['src/auth.ts'], decisions: ['Use server-side session'], openIssues: ['Needs regression test'] });
    const builder = new ContextPackBuilder(database.connection);
    const pack = builder.build({ projectId: 'p1', taskId: 't1' });
    expect(pack.text).toContain('# LAST HANDOFF');
    expect(pack.text).toContain('Found the bug in redirect handler');
    expect(pack.text).toContain('src/auth.ts');
  });

  it('records a checkpoint summary without deleting raw history', async () => {
    const messageRepo = database.connection.prepare(`INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, 'c1', 'user', ?, 't')`);
    messageRepo.run('m1', 'please fix the login redirect');
    const task = database.connection.prepare('SELECT * FROM tasks WHERE id = ?').get('t1') as unknown as Task;
    recordTaskCheckpoint(database.connection, task, 'completed', 'Redirect fixed by preserving the token');
    const chunks = database.connection.prepare(`SELECT * FROM memory_chunks WHERE task_id = 't1' AND kind = 'task_summary'`).all() as Array<{ text: string }>;
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toContain('completed');
    const raw = database.connection.prepare(`SELECT content FROM messages WHERE id = 'm1'`).get() as { content: string };
    expect(raw.content).toBe('please fix the login redirect');
  });

  it('truncates oversized history to fit the budget', () => {
    const memory = new MemoryRepository(database.connection);
    memory.addChunk({ projectId: 'p1', taskId: 't1', kind: 'dump', text: `login redirect ${'x'.repeat(200 * 1024)}` });
    const builder = new ContextPackBuilder(database.connection);
    const pack = builder.build({ projectId: 'p1', taskId: 't1' });
    expect(pack.sections['RELEVANT HISTORY']).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET.history + 10);
    expect(pack.text).toContain('[section truncated to fit context budget]');
    expect(estimateTokens(pack.text)).toBeLessThan(30000);
  });
});
