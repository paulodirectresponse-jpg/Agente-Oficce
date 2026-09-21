import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase, closeAgentOfficeDatabase, type AgentOfficeDatabase } from './database.js';
import { TaskRunManager, type Task } from './taskRunManager.js';
import { TaskOrchestrator } from './orchestrator.js';
import type { AgentAdapter, AgentEvent } from './adapterFramework.js';

function scriptedAdapter(eventScripts: AgentEvent[][]): AgentAdapter & { runs: number } {
  const state = { runs: 0 };
  return {
    id: 'kimi',
    get runs() { return state.runs; },
    async healthCheck() { return { status: 'healthy' as const }; },
    getCapabilities() { return { streaming: true, resume: false, tools: [] }; },
    async *startRun() {
      const script = eventScripts[Math.min(state.runs, eventScripts.length - 1)];
      state.runs += 1;
      for (const event of script) {
        yield { ...event, timestamp: new Date().toISOString() };
      }
    },
    async cancel() {},
  };
}

const delta = (text: string): AgentEvent => ({ type: 'delta', timestamp: '', payload: { text } });
const complete: AgentEvent = { type: 'complete', timestamp: '', payload: { success: true, usage: { input_tokens: 5, output_tokens: 3 } } };
const failure = (message: string): AgentEvent => ({ type: 'error', timestamp: '', payload: { message } });

describe('task orchestrator (autonomous loop)', () => {
  let dataDir: string;
  let database: AgentOfficeDatabase;
  let task: Task;

  function setup(adapter: AgentAdapter) {
    const manager = new TaskRunManager({ database: database.connection, adapterRegistry: new Map([[adapter.id, adapter]]), maxAutoAttempts: 3, maxAgentSwitches: 3 });
    const orchestrator = new TaskOrchestrator({ database: database.connection, manager, projectRoot: dataDir });
    return { manager, orchestrator };
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-orch-'));
    database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    database.connection.prepare(`INSERT INTO projects (id, name, root_path, git_enabled, created_at, updated_at) VALUES ('p1', 'P', ?, 0, 't', 't')`).run(dataDir);
    database.connection.prepare(`INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES ('c1', 'p1', 'C', 't', 't')`).run();
    database.connection.prepare(`INSERT INTO tasks (id, project_id, conversation_id, title, description, category, risk, status, created_at, updated_at) VALUES ('t1', 'p1', 'c1', 'Task', 'Desc', 'unknown', 'medium', 'queued', 't', 't')`).run();
    task = database.connection.prepare('SELECT * FROM tasks WHERE id = ?').get('t1') as unknown as Task;
  });

  afterEach(async () => {
    closeAgentOfficeDatabase(database);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('completes a successful run and persists events', async () => {
    const { manager, orchestrator } = setup(scriptedAdapter([[delta('working'), delta(' done'), complete]]));
    const outcome = await orchestrator.executeTask(task.id, 'kimi');
    expect(outcome).toBe('completed');
    expect(manager.getTask(task.id)?.status).toBe('completed');
    const run = database.connection.prepare('SELECT * FROM runs').get() as { status: string; output_summary: string; usage_json: string };
    expect(run.status).toBe('completed');
    expect(run.output_summary).toContain('working done');
    expect(JSON.parse(run.usage_json)).toEqual({ input_tokens: 5, output_tokens: 3 });
    const events = database.connection.prepare('SELECT event_type FROM agent_office_events ORDER BY event_key').all() as Array<{ event_type: string }>;
    expect(events.map(event => event.event_type)).toEqual(['complete']);
  });

  it('retries after failure and succeeds within the attempt budget', async () => {
    const adapter = scriptedAdapter([[failure('FLAKE_1')], [failure('FLAKE_2')], [delta('ok'), complete]]);
    const { manager, orchestrator } = setup(adapter);
    const outcome = await orchestrator.executeTask(task.id, 'kimi');
    expect(outcome).toBe('completed');
    expect(adapter.runs).toBe(3);
    expect(manager.getTask(task.id)?.attempt_count).toBe(3);
    const runs = database.connection.prepare('SELECT status FROM runs ORDER BY started_at').all() as Array<{ status: string }>;
    expect(runs.map(run => run.status)).toEqual(['failed', 'failed', 'completed']);
  });

  it('blocks the task after 3 failed attempts', async () => {
    const adapter = scriptedAdapter([[failure('BROKEN')]]);
    const { manager, orchestrator } = setup(adapter);
    const outcome = await orchestrator.executeTask(task.id, 'kimi');
    expect(outcome).toBe('blocked');
    expect(adapter.runs).toBe(3);
    const updated = manager.getTask(task.id);
    expect(updated?.status).toBe('blocked');
    expect(updated?.writer_lock).toBeNull();
  });

  it('cancels a run through the manager', async () => {
    const adapter: AgentAdapter = {
      id: 'kimi',
      async healthCheck() { return { status: 'healthy' }; },
      getCapabilities() { return { streaming: true, resume: false, tools: [] }; },
      async *startRun() {
        yield { type: 'delta', timestamp: new Date().toISOString(), payload: { text: 'start' } };
        yield { type: 'cancelled', timestamp: new Date().toISOString(), payload: { reason: 'aborted' } };
      },
      async cancel() {},
    };
    const { manager, orchestrator } = setup(adapter);
    const outcome = await orchestrator.executeTask(task.id, 'kimi');
    expect(outcome).toBe('cancelled');
    expect(manager.getTask(task.id)?.status).toBe('cancelled');
    const run = database.connection.prepare('SELECT status FROM runs').get() as { status: string };
    expect(run.status).toBe('cancelled');
  });

  it('blocks the task when the model hits max_tool_steps', async () => {
    const { manager, orchestrator } = setup(scriptedAdapter([[{ type: 'max_tool_steps', timestamp: '', payload: { reason: 'max_tool_steps', limit: 20 } }]]));
    const outcome = await orchestrator.executeTask(task.id, 'kimi');
    expect(outcome).toBe('blocked');
    expect(manager.getTask(task.id)?.status).toBe('blocked');
    const run = database.connection.prepare('SELECT status, error_json FROM runs').get() as { status: string; error_json: string };
    expect(run.status).toBe('failed');
    expect(JSON.parse(run.error_json)).toEqual({ reason: 'max_tool_steps' });
  });

  it('moves the task to waiting_approval on approval-required warnings', async () => {
    const { manager, orchestrator } = setup(scriptedAdapter([[
      delta('trying dangerous op'),
      { type: 'warning', timestamp: '', payload: { approval_required: true, tool: 'run_command', reason: 'DESTRUCTIVE_COMMAND_DENIED' } },
    ]]));
    const outcome = await orchestrator.executeTask(task.id, 'kimi');
    expect(outcome).toBe('waiting_approval');
    const updated = manager.getTask(task.id);
    expect(updated?.status).toBe('waiting_approval');
    expect(updated?.writer_lock).toBeNull();
    const run = database.connection.prepare('SELECT status, error_json FROM runs').get() as { status: string; error_json: string };
    expect(run.status).toBe('cancelled');
    expect(JSON.parse(run.error_json).reason).toBe('approval_required');
  });

  it('fails cleanly when the stream ends without a terminal event', async () => {
    const { manager, orchestrator } = setup(scriptedAdapter([[delta('cut off')], [complete]]));
    const outcome = await orchestrator.executeTask(task.id, 'kimi');
    expect(outcome).toBe('completed');
    expect(adapterRunCount(database)).toBe(2);
    expect(manager.getTask(task.id)?.status).toBe('completed');
  });
});

function adapterRunCount(database: AgentOfficeDatabase): number {
  return (database.connection.prepare('SELECT COUNT(*) AS count FROM runs').get() as { count: number }).count;
}
