import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from './adapterFramework.js';
import { createProviderProtocol, type ModelTurn, type ToolResult } from './providerProtocol.js';
import { runToolLoop, type StreamModelFn, type ExecuteToolFn } from './toolLoop.js';
import { executeLocalTool, type LocalToolName } from './localTools.js';
import { LOCAL_TOOL_SCHEMAS } from './claudeAdapter.js';

interface ScriptedTurn {
  text?: string;
  tools?: Array<{ name: string; input: Record<string, unknown> }>;
}

function createScriptedModel(script: ScriptedTurn[]): { streamModel: StreamModelFn; calls: ModelTurn[][] } {
  const calls: ModelTurn[][] = [];
  let index = 0;
  const streamModel: StreamModelFn = async (conversation, _signal, onText) => {
    calls.push(JSON.parse(JSON.stringify(conversation)) as ModelTurn[]);
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    if (step.text) onText(step.text);
    return {
      text: step.text ?? '',
      toolRequests: (step.tools ?? []).map((tool, toolIndex) => ({ id: `toolu_${index}_${toolIndex}`, name: tool.name, input: tool.input })),
      stopReason: step.tools?.length ? 'tool_use' : 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  };
  return { streamModel, calls };
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function types(events: AgentEvent[]): string[] {
  return events.map(event => event.type);
}

describe('tool loop', () => {
  let root: string;
  const protocol = createProviderProtocol({ strategy: 'anthropic_messages' });

  const executeTool: ExecuteToolFn = async request => {
    const result = await executeLocalTool(request.name as LocalToolName, request.input, { projectRoot: root });
    if (!result.ok) return { tool_use_id: request.id, content: result.error ?? 'LOCAL_TOOL_FAILED', is_error: true };
    return { tool_use_id: request.id, content: JSON.stringify(result.data ?? {}) };
  };

  function startLoop(script: ScriptedTurn[], options?: { maxToolSteps?: number; signal?: AbortSignal; executeToolOverride?: ExecuteToolFn }) {
    const { streamModel, calls } = createScriptedModel(script);
    const conversation: ModelTurn[] = [{ role: 'user', content: [{ type: 'text', text: 'do the task' }] }];
    const events = runToolLoop({
      protocol,
      conversation,
      tools: LOCAL_TOOL_SCHEMAS,
      streamModel,
      executeTool: options?.executeToolOverride ?? executeTool,
      maxToolSteps: options?.maxToolSteps ?? 20,
      signal: options?.signal ?? new AbortController().signal,
    });
    return { events, calls };
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-loop-'));
    await fs.writeFile(path.join(root, 'note.txt'), 'hello world');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('executes list_files requested by the model', async () => {
    const { events } = startLoop([{ tools: [{ name: 'list_files', input: { path: '.' } }] }, { text: 'done' }]);
    const collected = await collect(events);
    expect(types(collected)).toEqual(['tool_start', 'tool_end', 'delta', 'complete']);
    expect(collected[1].payload.ok).toBe(true);
  });

  it('executes read_file requested by the model', async () => {
    const { events } = startLoop([{ tools: [{ name: 'read_file', input: { path: 'note.txt' } }] }, { text: 'read it' }]);
    const collected = await collect(events);
    expect(types(collected)).toContain('tool_end');
    expect(collected.find(event => event.type === 'tool_end')?.payload.ok).toBe(true);
  });

  it('sends the tool result back to the model', async () => {
    const { events, calls } = startLoop([{ tools: [{ name: 'read_file', input: { path: 'note.txt' } }] }, { text: 'finished' }]);
    await collect(events);
    expect(calls.length).toBe(2);
    const secondCall = calls[1];
    const toolResultTurn = secondCall[secondCall.length - 1];
    expect(toolResultTurn.role).toBe('user');
    const block = toolResultTurn.content[0] as { type: string; content: string };
    expect(block.type).toBe('tool_result');
    expect(block.content).toContain('hello world');
    const assistantTurn = secondCall[secondCall.length - 2];
    expect(assistantTurn.role).toBe('assistant');
    expect(assistantTurn.content.some(blockItem => blockItem.type === 'tool_use')).toBe(true);
  });

  it('executes write_file and apply_patch', async () => {
    const { events } = startLoop([
      { tools: [{ name: 'write_file', input: { path: 'out.txt', content: 'v1' } }] },
      { tools: [{ name: 'apply_patch', input: { path: 'out.txt', old_text: 'v1', new_text: 'v2' } }] },
      { text: 'changed' },
    ]);
    const collected = await collect(events);
    expect(collected.filter(event => event.type === 'tool_end').every(event => event.payload.ok === true)).toBe(true);
    expect(await fs.readFile(path.join(root, 'out.txt'), 'utf8')).toBe('v2');
  });

  it('executes run_tests and returns the outcome to the model', async () => {
    const { events, calls } = startLoop([{ tools: [{ name: 'run_tests', input: {} }] }, { text: 'tested' }]);
    const collected = await collect(events);
    expect(types(collected)).toContain('tool_end');
    const secondCall = calls[1];
    const lastTurn = secondCall[secondCall.length - 1];
    expect(lastTurn.content[0].type).toBe('tool_result');
  }, 30000);

  it('completes when the model stops requesting tools', async () => {
    const { events, calls } = startLoop([{ text: 'all done' }]);
    const collected = await collect(events);
    expect(types(collected)).toEqual(['delta', 'complete']);
    expect(collected[1].payload.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    expect(calls.length).toBe(1);
  });

  it('reports unknown tools to the model without executing', async () => {
    const { events, calls } = startLoop([{ tools: [{ name: 'delete_everything', input: {} }] }, { text: 'recovered' }]);
    const collected = await collect(events);
    const toolEnd = collected.find(event => event.type === 'tool_end');
    expect(toolEnd?.payload.ok).toBe(false);
    expect(String(toolEnd?.payload.error)).toContain('UNKNOWN_TOOL');
    const resultBlock = calls[1][calls[1].length - 1].content[0] as { is_error?: boolean; content: string };
    expect(resultBlock.is_error).toBe(true);
    expect(resultBlock.content).toContain('UNKNOWN_TOOL');
  });

  it('rejects invalid tool arguments', async () => {
    const { events } = startLoop([{ tools: [{ name: 'read_file', input: {} }] }, { text: 'ok' }]);
    const collected = await collect(events);
    const toolEnd = collected.find(event => event.type === 'tool_end');
    expect(String(toolEnd?.payload.error)).toContain('INVALID_ARGUMENTS');
  });

  it('blocks path traversal', async () => {
    const { events } = startLoop([{ tools: [{ name: 'read_file', input: { path: '../outside.txt' } }] }, { text: 'ok' }]);
    const collected = await collect(events);
    const toolEnd = collected.find(event => event.type === 'tool_end');
    expect(toolEnd?.payload.error).toBe('PATH_OUTSIDE_PROJECT_ROOT');
  });

  it('blocks symlink escapes', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-outside-'));
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    fsSync.symlinkSync(outside, path.join(root, 'linked'), 'junction');
    try {
      const { events } = startLoop([{ tools: [{ name: 'read_file', input: { path: 'linked/secret.txt' } }] }, { text: 'ok' }]);
      const collected = await collect(events);
      const toolEnd = collected.find(event => event.type === 'tool_end');
      expect(toolEnd?.payload.error).toBe('SYMLINK_ESCAPE');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('denies destructive commands and raises waiting_approval', async () => {
    const { events, calls } = startLoop([
      { tools: [{ name: 'run_command', input: { command: ['git', 'reset', '--hard'] } }] },
      { text: 'understood, skipping' },
    ]);
    const collected = await collect(events);
    const toolEnd = collected.find(event => event.type === 'tool_end');
    expect(toolEnd?.payload.error).toBe('DESTRUCTIVE_COMMAND_DENIED');
    expect(toolEnd?.payload.approval_required).toBe(true);
    const warning = collected.find(event => event.type === 'warning');
    expect(warning?.payload.approval_required).toBe(true);
    const resultBlock = calls[1][calls[1].length - 1].content[0] as { content: string };
    expect(resultBlock.content).toContain('waiting_approval');
  });

  it('survives tool execution errors and continues the loop', async () => {
    const failing: ExecuteToolFn = async request => ({ tool_use_id: request.id, content: 'DISK_ON_FIRE', is_error: true });
    const { events } = startLoop(
      [{ tools: [{ name: 'read_file', input: { path: 'note.txt' } }] }, { text: 'handled' }],
      { executeToolOverride: failing },
    );
    const collected = await collect(events);
    expect(types(collected)).toEqual(['tool_start', 'tool_end', 'delta', 'complete']);
  });

  it('cancels a hung model turn', async () => {
    const controller = new AbortController();
    const streamModel: StreamModelFn = (_conversation, signal) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const conversation: ModelTurn[] = [{ role: 'user', content: [{ type: 'text', text: 'task' }] }];
    const events = runToolLoop({
      protocol,
      conversation,
      tools: LOCAL_TOOL_SCHEMAS,
      streamModel,
      executeTool,
      maxToolSteps: 20,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    const collected = await collect(events);
    expect(types(collected)).toEqual(['cancelled']);
  });

  it('stops between tool executions when cancelled', async () => {
    const controller = new AbortController();
    const cancelling: ExecuteToolFn = async request => {
      controller.abort();
      return executeTool(request);
    };
    const { events } = startLoop(
      [{ tools: [{ name: 'list_files', input: { path: '.' } }, { name: 'read_file', input: { path: 'note.txt' } }] }],
      { signal: controller.signal, executeToolOverride: cancelling },
    );
    const collected = await collect(events);
    expect(collected[collected.length - 1].type).toBe('cancelled');
    expect(collected.filter(event => event.type === 'tool_end').length).toBe(1);
  });

  it('blocks the run at maxToolSteps', async () => {
    const { events } = startLoop(
      [{ tools: [{ name: 'list_files', input: { path: '.' } }] }],
      { maxToolSteps: 3 },
    );
    const collected = await collect(events);
    const last = collected[collected.length - 1];
    expect(last.type).toBe('max_tool_steps');
    expect(last.payload.reason).toBe('max_tool_steps');
    expect(last.payload.limit).toBe(3);
    expect(types(collected)).not.toContain('complete');
  });

  it('executes multiple tool calls sequentially in one turn', async () => {
    const { events, calls } = startLoop([
      { tools: [{ name: 'list_files', input: { path: '.' } }, { name: 'read_file', input: { path: 'note.txt' } }] },
      { text: 'both done' },
    ]);
    const collected = await collect(events);
    expect(types(collected)).toEqual(['tool_start', 'tool_end', 'tool_start', 'tool_end', 'delta', 'complete']);
    const resultTurn = calls[1][calls[1].length - 1];
    expect(resultTurn.content.length).toBe(2);
    expect(resultTurn.content.every(block => block.type === 'tool_result')).toBe(true);
  });
});
