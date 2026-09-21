import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { AgentEvent } from './adapterFramework.js';
import { TaskRunManager, type Task } from './taskRunManager.js';
import { ContextPackBuilder, MemoryRepository } from './memory.js';
import { UsageTracker } from './usageTracker.js';

export type RunOutcome = 'completed' | 'failed' | 'cancelled' | 'blocked' | 'waiting_approval';

export interface TerminalState {
  type: 'complete' | 'error' | 'cancelled' | 'max_tool_steps' | 'waiting_approval';
  summary: string;
  usage?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

export interface TaskOrchestratorOptions {
  database: Database;
  manager: TaskRunManager;
  projectRoot: string;
  buildContextPack?: (task: Task, attempt: number, lastError?: string) => string;
}

const OUTPUT_SUMMARY_LIMIT = 1000;

function defaultContextPack(database: Database, task: Task, _attempt: number, lastError?: string): string {
  const builder = new ContextPackBuilder(database);
  const pack = builder.build({
    projectId: task.project_id,
    taskId: task.id,
    conversationId: task.conversation_id,
    extraInstructions: lastError ? `Previous attempt failed: ${lastError}. Diagnose the failure and try a different approach.` : undefined,
  });
  return pack.text;
}

export function recordTaskCheckpoint(database: Database, task: Task, outcome: RunOutcome, summary: string): void {
  if (!summary) return;
  const memory = new MemoryRepository(database);
  memory.addChunk({
    projectId: task.project_id,
    conversationId: task.conversation_id,
    taskId: task.id,
    kind: 'task_summary',
    text: `[${outcome}] ${task.title}: ${summary}`,
  });
}

function persistEvent(database: Database, taskId: string, runId: string, sequence: number, event: AgentEvent): void {
  if (event.type === 'delta') return;
  database.prepare(`INSERT OR IGNORE INTO agent_office_events (id, run_id, task_id, event_type, payload_json, created_at, event_key) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(), runId, taskId, event.type, JSON.stringify(event.payload), event.timestamp, `${runId}:${sequence}`,
  );
}

export class TaskOrchestrator {
  constructor(private readonly options: TaskOrchestratorOptions) {}

  async executeTask(taskId: string, agentId: string): Promise<RunOutcome> {
    let lastError: string | undefined;
    while (true) {
      const task = this.options.manager.getTask(taskId);
      if (!task) throw new Error('TASK_NOT_FOUND');
      if (task.status === 'completed' || task.status === 'cancelled') return task.status;
      const buildContext = this.options.buildContextPack ?? ((t, attempt, error) => defaultContextPack(this.options.database, t, attempt, error));
      const contextPack = buildContext(task, task.attempt_count, lastError);
      const { runId, events } = await this.options.manager.startRun(taskId, agentId, contextPack, this.options.projectRoot);
      const terminal = await this.drive(taskId, runId, events);
      switch (terminal.type) {
        case 'complete':
          await this.options.manager.completeRun(runId, true, terminal.summary, terminal.usage);
          if (terminal.usage) {
            new UsageTracker(this.options.database).recordRunUsage(agentId, agentId, {
              input_tokens: (terminal.usage as { input_tokens?: number }).input_tokens,
              output_tokens: (terminal.usage as { output_tokens?: number }).output_tokens,
            });
          }
          recordTaskCheckpoint(this.options.database, task, 'completed', terminal.summary);
          return 'completed';
        case 'max_tool_steps':
          await this.options.manager.completeRun(runId, false, terminal.summary, terminal.usage, { reason: 'max_tool_steps' });
          this.options.manager.blockTask(taskId, 'max_tool_steps');
          recordTaskCheckpoint(this.options.database, task, 'blocked', terminal.summary || 'Stopped at max tool steps.');
          return 'blocked';
        case 'waiting_approval':
          await this.options.manager.setWaitingApproval(taskId, runId, String(terminal.error?.reason ?? 'approval_required'));
          return 'waiting_approval';
        case 'cancelled':
          await this.options.manager.cancelRun(runId);
          return 'cancelled';
        case 'error': {
          await this.options.manager.completeRun(runId, false, terminal.summary, terminal.usage, terminal.error);
          if (this.options.manager.canAutoRetry(taskId)) {
            lastError = String(terminal.error?.message ?? 'RUN_FAILED');
            continue;
          }
          this.options.manager.blockTask(taskId, 'max_auto_attempts');
          recordTaskCheckpoint(this.options.database, task, 'blocked', terminal.summary || String(terminal.error?.message ?? 'failed'));
          return 'blocked';
        }
      }
    }
  }

  private async drive(taskId: string, runId: string, events: AsyncIterable<AgentEvent>): Promise<TerminalState> {
    let sequence = 0;
    let output = '';
    for await (const event of events) {
      sequence += 1;
      persistEvent(this.options.database, taskId, runId, sequence, event);
      if (event.type === 'delta' && typeof event.payload.text === 'string') {
        output = (output + event.payload.text).slice(-OUTPUT_SUMMARY_LIMIT);
      }
      if (event.type === 'warning' && event.payload.approval_required) {
        return { type: 'waiting_approval', summary: output, error: { reason: String(event.payload.reason ?? 'approval_required') } };
      }
      if (event.type === 'complete') {
        return { type: 'complete', summary: output || String(event.payload.stopReason ?? 'completed'), usage: event.payload.usage as Record<string, unknown> | undefined };
      }
      if (event.type === 'max_tool_steps') {
        return { type: 'max_tool_steps', summary: output, error: { reason: 'max_tool_steps', limit: event.payload.limit } };
      }
      if (event.type === 'cancelled') {
        return { type: 'cancelled', summary: output, error: { reason: String(event.payload.reason ?? 'cancelled') } };
      }
      if (event.type === 'error') {
        return { type: 'error', summary: output, error: { message: String(event.payload.message ?? 'UNKNOWN_ERROR') } };
      }
    }
    return { type: 'error', summary: output, error: { message: 'RUN_ENDED_WITHOUT_TERMINAL_EVENT' } };
  }
}
