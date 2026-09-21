import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentAdapter, AgentRunInput, AgentEvent, UsageSnapshot, AgentHealth, AgentCapabilities } from './adapterFramework.js';

export interface CodexAdapterConfig {
  codexPath?: string;
  spawnFn?: (command: string, args: string[], options: Record<string, unknown>) => ChildProcess;
  timeoutMs?: number;
  model?: string;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  extraArgs?: string[];
}

const DEFAULT_TIMEOUT = 600000;
const MAX_PROMPT_CHARS = 24000;

type CodexEventHandler = (event: AgentEvent) => void;

interface CodexJsonEvent {
  type?: string;
  thread_id?: string;
  delta?: string;
  message?: string;
  usage?: Record<string, unknown>;
  item?: {
    type?: string;
    command?: string[];
    aggregated_output?: string;
    exit_code?: number;
  };
}

export function detectCodexPath(): string {
  return 'codex';
}

export function createCodexAdapter(config: CodexAdapterConfig): AgentAdapter {
  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT;
  const sandboxMode = config.sandboxMode || 'workspace-write';
  const spawnFn = config.spawnFn ?? ((command: string, args: string[], options: Record<string, unknown>) => spawn(command, args, options as never));
  const activeProcesses = new Map<string, { child: ChildProcess; markCancel: () => void }>();

  function baseArgs(): string[] {
    const args = ['exec', '--json', '--sandbox', sandboxMode];
    if (config.model) args.push('--model', config.model);
    if (config.extraArgs) args.push(...config.extraArgs);
    return args;
  }

  function mapCodexEvent(raw: CodexJsonEvent, emit: CodexEventHandler, state: { threadId: string | null }): void {
    const timestamp = new Date().toISOString();
    switch (raw.type) {
      case 'thread.started':
        state.threadId = raw.thread_id ?? null;
        return;
      case 'agent_message_delta':
        if (raw.delta) emit({ type: 'delta', timestamp, payload: { text: raw.delta } });
        return;
      case 'item.started': {
        if (raw.item?.type === 'command_execution') {
          emit({ type: 'tool_start', timestamp, payload: { name: 'codex_exec', command: raw.item.command ?? [] } });
        }
        return;
      }
      case 'item.completed': {
        if (raw.item?.type === 'command_execution') {
          emit({
            type: 'tool_end',
            timestamp,
            payload: {
              name: 'codex_exec',
              ok: (raw.item.exit_code ?? 0) === 0,
              output: (raw.item.aggregated_output ?? '').slice(0, 4000),
              exit_code: raw.item.exit_code ?? 0,
            },
          });
        }
        return;
      }
      default:
        return;
    }
  }

  return {
    id: 'codex',
    async healthCheck(): Promise<AgentHealth> {
      try {
        const probe = spawnFn(config.codexPath ?? detectCodexPath(), ['--version'], { timeout: 5000, windowsHide: true });
        const exitCode = await new Promise<number | null>(resolve => {
          const timer = setTimeout(() => {
            probe.kill();
            resolve(null);
          }, 6000);
          probe.on('close', code => {
            clearTimeout(timer);
            resolve(code);
          });
          probe.on('error', () => {
            clearTimeout(timer);
            resolve(null);
          });
        });
        if (exitCode === 0) return { status: 'healthy', capabilities: { streaming: true, resume: true, tools: ['codex_builtin'] } };
        return { status: 'unavailable', details: exitCode === null ? 'CODEX_PROBE_TIMEOUT' : `CODEX_EXIT_${exitCode}` };
      } catch (error) {
        return { status: 'unavailable', details: error instanceof Error ? error.message : 'CODEX_NOT_INSTALLED' };
      }
    },
    getCapabilities(): AgentCapabilities {
      return { streaming: true, resume: true, tools: ['codex_builtin'] };
    },
    async getUsage(): Promise<UsageSnapshot | null> {
      return null;
    },
    async *startRun({ taskId, contextPack, projectRoot }: AgentRunInput): AsyncIterable<AgentEvent> {
      const queue: AgentEvent[] = [];
      const waiters: Array<() => void> = [];
      const state = { threadId: null as string | null, cancelRequested: false, timedOut: false, terminalEmitted: false };
      const emit: CodexEventHandler = event => {
        queue.push(event);
        while (waiters.length) waiters.shift()!();
      };
      const nextEvent = (): Promise<AgentEvent | null> => {
        if (queue.length) return Promise.resolve(queue.shift()!);
        return new Promise(resolve => {
          const check = (): void => {
            if (queue.length) {
              resolve(queue.shift()!);
            } else {
              waiters.push(check);
            }
          };
          check();
        });
      };
      const emitOnce = (event: AgentEvent): void => {
        if (state.terminalEmitted) return;
        state.terminalEmitted = true;
        emit(event);
      };

      if (contextPack.length > MAX_PROMPT_CHARS) {
        yield { type: 'error', timestamp: new Date().toISOString(), payload: { message: 'PROMPT_TOO_LONG' } };
        return;
      }
      const child = spawnFn(config.codexPath ?? detectCodexPath(), [...baseArgs(), '-C', projectRoot, contextPack], { cwd: projectRoot, windowsHide: true });
      activeProcesses.set(taskId, { child, markCancel: () => { state.cancelRequested = true; } });
      const timer = setTimeout(() => {
        state.timedOut = true;
        child.kill();
      }, timeoutMs);
      child.on('error', error => {
        emitOnce({ type: 'error', timestamp: new Date().toISOString(), payload: { message: `CODEX_SPAWN_FAILED: ${error.message}` } });
      });
      child.on('close', () => {
        clearTimeout(timer);
        if (!state.terminalEmitted) {
          if (state.cancelRequested) {
            emitOnce({ type: 'cancelled', timestamp: new Date().toISOString(), payload: { reason: 'aborted' } });
          } else if (state.timedOut) {
            emitOnce({ type: 'error', timestamp: new Date().toISOString(), payload: { message: 'RUN_TIMEOUT', timeoutMs } });
          } else {
            emitOnce({ type: 'error', timestamp: new Date().toISOString(), payload: { message: 'CODEX_ENDED_WITHOUT_RESULT' } });
          }
        }
        activeProcesses.delete(taskId);
        while (waiters.length) waiters.shift()!();
      });      if (child.stdout) {
        const lines = createInterface({ input: child.stdout });
        lines.on('line', line => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let parsed: CodexJsonEvent;
          try {
            parsed = JSON.parse(trimmed) as CodexJsonEvent;
          } catch {
            return;
          }
          if (parsed.type === 'turn.completed') {
            emitOnce({ type: 'complete', timestamp: new Date().toISOString(), payload: { success: true, usage: parsed.usage ?? {}, thread_id: state.threadId } });
          } else if (parsed.type === 'turn.failed' || parsed.type === 'error') {
            emitOnce({ type: 'error', timestamp: new Date().toISOString(), payload: { message: parsed.message ?? `CODEX_${parsed.type.toUpperCase()}` } });
          } else {
            mapCodexEvent(parsed, emit, state);
          }
          while (waiters.length) waiters.shift()!();
        });
      }
      try {
        while (true) {
          const event = await nextEvent();
          if (!event) break;
          yield event;
          if (event.type === 'complete' || event.type === 'error' || event.type === 'cancelled') break;
        }
      } finally {
        clearTimeout(timer);
        activeProcesses.delete(taskId);
      }
    },
    async cancel(runId: string): Promise<void> {
      const entry = activeProcesses.get(runId);
      if (entry) {
        entry.markCancel();
        entry.child.kill();
        activeProcesses.delete(runId);
      }
    },
  };
}
