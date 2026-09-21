import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { createCodexAdapter } from './codexAdapter.js';
import type { AgentEvent } from './adapterFramework.js';

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  lines: string[] = [];
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('close', null, null));
    return true;
  }
  emitLines(lines: string[]): void {
    for (const line of lines) this.stdout.write(`${line}\n`);
  }
  finish(): void {
    queueMicrotask(() => this.emit('close', 0, null));
  }
  failSpawn(): void {
    queueMicrotask(() => this.emit('error', new Error('ENOENT')));
  }
}

function fakeSpawn(child: FakeChild) {
  return ((_command: string, _args: string[], _options: Record<string, unknown>) => child) as unknown as (command: string, args: string[], options: Record<string, unknown>) => ChildProcess;
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

describe('CodexAdapter', () => {
  it('reports healthy when the CLI responds to --version', async () => {
    const child = new FakeChild();
    const adapter = createCodexAdapter({ spawnFn: fakeSpawn(child) });
    const healthPromise = adapter.healthCheck();
    child.finish();
    expect((await healthPromise).status).toBe('healthy');
  });

  it('reports unavailable when the probe fails', async () => {
    const child = new FakeChild();
    const adapter = createCodexAdapter({ spawnFn: fakeSpawn(child) });
    const healthPromise = adapter.healthCheck();
    child.failSpawn();
    const health = await healthPromise;
    expect(health.status).toBe('unavailable');
    expect(health.details).toBeDefined();
  });

  it('maps a full codex exec JSONL cycle to AgentEvents', async () => {
    const child = new FakeChild();
    const adapter = createCodexAdapter({ spawnFn: fakeSpawn(child), model: 'gpt-5-codex' });
    const runPromise = collect(adapter.startRun({ taskId: 'c1', contextPack: 'refactor auth', projectRoot: 'C:\\proj' }));
    child.emitLines([
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-42' }),
      JSON.stringify({ type: 'agent_message_delta', delta: 'Analyzing' }),
      JSON.stringify({ type: 'agent_message_delta', delta: ' the code' }),
      JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: ['npm', 'test'] } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: ['npm', 'test'], aggregated_output: 'ok', exit_code: 0 } }),
      JSON.stringify({ type: 'turn.completed', usage: { total_tokens: 1234 } }),
    ]);
    child.finish();
    const events = await runPromise;
    expect(events.map(event => event.type)).toEqual(['delta', 'delta', 'tool_start', 'tool_end', 'complete']);
    expect(events[0].payload.text).toBe('Analyzing');
    expect(events[3].payload.ok).toBe(true);
    expect(events[4].payload.usage).toEqual({ total_tokens: 1234 });
  });

  it('cancelling a running process yields a cancelled event', async () => {
    const child = new FakeChild();
    const adapter = createCodexAdapter({ spawnFn: fakeSpawn(child) });
    const iterator = adapter.startRun({ taskId: 'c2', contextPack: 'long task', projectRoot: 'C:\\proj' })[Symbol.asyncIterator]();
    const first = iterator.next();
    await adapter.cancel('c2');
    const result = await first;
    expect(result.done).toBe(false);
    expect(result.value.type).toBe('cancelled');
    expect(child.killed).toBe(true);
  });

  it('errors when the process exits without a terminal event', async () => {
    const child = new FakeChild();
    const adapter = createCodexAdapter({ spawnFn: fakeSpawn(child) });
    const runPromise = collect(adapter.startRun({ taskId: 'c3', contextPack: 'task', projectRoot: 'C:\\proj' }));
    child.emitLines([JSON.stringify({ type: 'agent_message_delta', delta: 'halfway' })]);
    child.finish();
    const events = await runPromise;
    expect(events.map(event => event.type)).toEqual(['delta', 'error']);
    expect(events[1].payload.message).toBe('CODEX_ENDED_WITHOUT_RESULT');
  });

  it('rejects oversized prompts before spawning', async () => {
    const child = new FakeChild();
    const adapter = createCodexAdapter({ spawnFn: fakeSpawn(child) });
    const events = await collect(adapter.startRun({ taskId: 'c4', contextPack: 'x'.repeat(25000), projectRoot: 'C:\\proj' }));
    expect(events.map(event => event.type)).toEqual(['error']);
    expect(events[0].payload.message).toBe('PROMPT_TOO_LONG');
  });

  it('surfaces spawn failures as error events', async () => {
    const child = new FakeChild();
    const adapter = createCodexAdapter({ spawnFn: fakeSpawn(child) });
    const runPromise = collect(adapter.startRun({ taskId: 'c5', contextPack: 'task', projectRoot: 'C:\\proj' }));
    child.failSpawn();
    const events = await runPromise;
    expect(events[0].type).toBe('error');
    expect(String(events[0].payload.message)).toContain('CODEX_SPAWN_FAILED');
  });
});
