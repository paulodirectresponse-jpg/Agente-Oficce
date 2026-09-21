import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { AgentAdapter, AgentEvent, AgentRunInput } from './adapterFramework.js';

export type TaskStatus = 'queued' | 'planning' | 'running' | 'testing' | 'reviewing' | 'blocked' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
export type RunStatus = 'started' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  project_id: string;
  conversation_id: string;
  title: string;
  description: string;
  category: string;
  risk: 'low' | 'medium' | 'high';
  status: TaskStatus;
  assigned_agent: string | null;
  attempt_count: number;
  agent_switches: number;
  writer_lock: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Run {
  id: string;
  task_id: string;
  agent_id: string;
  provider_session_id: string | null;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  input_summary: string;
  output_summary: string;
  usage_json: string | null;
  error_json: string | null;
}

export interface TaskRunManagerOptions {
  database: Database;
  adapterRegistry: Map<string, AgentAdapter>;
  maxAutoAttempts: number;
  maxAgentSwitches: number;
}

function now(): string { return new Date().toISOString(); }
function id(): string { return crypto.randomUUID(); }

function normalizeTask(row: any): Task {
  return { ...row, writer_lock: row.writer_lock ?? null };
}

function normalizeRun(row: any): Run {
  return { ...row, provider_session_id: row.provider_session_id ?? null, usage_json: row.usage_json ?? null, error_json: row.error_json ?? null };
}

export class TaskRunManager {
  private activeRun: { runId: string; taskId: string; controller: AbortController } | null = null;
  private attemptCount = new Map<string, number>();
  private agentSwitches = new Map<string, number>();

  constructor(private readonly options: TaskRunManagerOptions) {}

  createTask(input: {
    projectId: string;
    conversationId: string;
    title: string;
    description?: string;
    category?: string;
    risk?: 'low' | 'medium' | 'high';
  }): Task {
    const timestamp = now();
    const task: Task = {
      id: id(),
      project_id: input.projectId,
      conversation_id: input.conversationId,
      title: input.title,
      description: input.description ?? '',
      category: input.category ?? 'unknown',
      risk: input.risk ?? 'medium',
      status: 'queued',
      assigned_agent: null,
      attempt_count: 0,
      agent_switches: 0,
      writer_lock: null,
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: null,
    };
    this.options.database.prepare(`INSERT INTO tasks (id, project_id, conversation_id, title, description, category, risk, status, assigned_agent, attempt_count, agent_switches, writer_lock, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      task.id, task.project_id, task.conversation_id, task.title, task.description, task.category, task.risk, task.status, task.assigned_agent, task.attempt_count, task.agent_switches, task.writer_lock, task.created_at, task.updated_at, task.completed_at,
    );
    return task;
  }

  getTask(taskId: string): Task | null {
    const row = this.options.database.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return row ? normalizeTask(row) : null;
  }

  listTasks(projectId: string): Task[] {
    return this.options.database.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC').all(projectId).map(normalizeTask);
  }

  async startRun(taskId: string, agentId: string, contextPack: string, projectRoot: string): Promise<{ runId: string; events: AsyncIterable<AgentEvent> }> {
    const task = this.getTask(taskId);
    if (!task) throw new Error('TASK_NOT_FOUND');

    // Check writer lock per project
    const lock = this.options.database.prepare('SELECT writer_lock FROM tasks WHERE id = ?').get(taskId) as { writer_lock: string | null } | undefined;
    if (lock?.writer_lock && lock.writer_lock !== 'released') {
      // Check if the lock is from a running run
      const existingRun = this.options.database.prepare('SELECT * FROM runs WHERE id = ? AND status IN ("started", "running")').get(lock.writer_lock);
      if (existingRun) throw new Error('WRITER_LOCK_ACTIVE');
      // Lock is stale (run completed/failed), release it
      this.options.database.prepare('UPDATE tasks SET writer_lock = NULL WHERE id = ?').run(taskId);
    }

    const adapter = this.options.adapterRegistry.get(agentId);
    if (!adapter) throw new Error('ADAPTER_NOT_FOUND');

    const health = await adapter.healthCheck();
    if (health.status === 'unavailable') throw new Error('ADAPTER_UNAVAILABLE');

    const runId = id();
    const timestamp = now();
    const run: Run = {
      id: runId,
      task_id: taskId,
      agent_id: agentId,
      provider_session_id: null,
      status: 'started',
      started_at: timestamp,
      ended_at: null,
      input_summary: contextPack.slice(0, 500),
      output_summary: '',
      usage_json: null,
      error_json: null,
    };
    this.options.database.prepare(`INSERT INTO runs (id, task_id, agent_id, provider_session_id, status, started_at, ended_at, input_summary, output_summary, usage_json, error_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      run.id, run.task_id, run.agent_id, run.provider_session_id, run.status, run.started_at, run.ended_at, run.input_summary, run.output_summary, run.usage_json, run.error_json,
    );

    this.options.database.prepare('UPDATE tasks SET status = ?, assigned_agent = ?, attempt_count = attempt_count + 1, writer_lock = ?, updated_at = ? WHERE id = ?').run(
      'running', agentId, runId, timestamp, taskId,
    );

    this.activeRun = { runId, taskId, controller: new AbortController() };

    const events = adapter.startRun({ taskId, contextPack, projectRoot });
    return { runId, events };
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.options.database.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as unknown as Run | undefined;
    if (!run) throw new Error('RUN_NOT_FOUND');
    const adapter = this.options.adapterRegistry.get(run.agent_id);
    if (adapter) await adapter.cancel(runId);
    const timestamp = now();
    this.options.database.prepare('UPDATE runs SET status = ?, ended_at = ? WHERE id = ?').run('cancelled', timestamp, runId);
    this.options.database.prepare('UPDATE tasks SET status = ?, writer_lock = NULL, updated_at = ? WHERE id = ?').run('cancelled', timestamp, run.task_id);
    if (this.activeRun?.runId === runId) this.activeRun = null;
  }

  async completeRun(runId: string, success: boolean, outputSummary: string, usage?: Record<string, unknown>, error?: Record<string, unknown>): Promise<void> {
    const timestamp = now();
    this.options.database.prepare('UPDATE runs SET status = ?, ended_at = ?, output_summary = ?, usage_json = ?, error_json = ? WHERE id = ?').run(
      success ? 'completed' : 'failed', timestamp, outputSummary.slice(0, 1000), usage ? JSON.stringify(usage) : null, error ? JSON.stringify(error) : null, runId,
    );
    const run = this.options.database.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as unknown as Run | undefined;
    if (run) {
      this.options.database.prepare('UPDATE tasks SET status = ?, writer_lock = NULL, updated_at = ?, completed_at = ? WHERE id = ?').run(
        success ? 'completed' : 'failed', timestamp, success ? timestamp : null, run.task_id,
      );
    }
    if (this.activeRun?.runId === runId) this.activeRun = null;
  }

  getActiveRun(): { runId: string; taskId: string } | null {
    return this.activeRun ? { runId: this.activeRun.runId, taskId: this.activeRun.taskId } : null;
  }

  canAutoRetry(taskId: string): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;
    const attempts = task.attempt_count;
    const switches = task.agent_switches;
    if (attempts >= this.options.maxAutoAttempts) return false;
    if (switches >= this.options.maxAgentSwitches) return false;
    return task.status !== 'blocked' && task.status !== 'completed';
  }

  recordAgentSwitch(taskId: string): void {
    this.options.database.prepare('UPDATE tasks SET agent_switches = agent_switches + 1 WHERE id = ?').run(taskId);
  }

  async resumeAfterCrash(): Promise<{ recoveredTasks: Task[] }> {
    const orphanRuns = this.options.database.prepare("SELECT * FROM runs WHERE status IN ('started', 'running')").all().map(normalizeRun);
    const recoveredTasks: Task[] = [];
    for (const run of orphanRuns) {
      const task = this.getTask(run.task_id);
      if (task) {
        this.options.database.prepare('UPDATE runs SET status = ?, ended_at = ?, error_json = ? WHERE id = ?').run('failed', now(), JSON.stringify({ recovered_from_crash: true }), run.id);
        this.options.database.prepare('UPDATE tasks SET status = ?, writer_lock = NULL, updated_at = ? WHERE id = ?').run('blocked', now(), task.id);
        const updatedTask = this.getTask(task.id);
        if (updatedTask) recoveredTasks.push(updatedTask);
      }
    }
    return { recoveredTasks };
  }
}