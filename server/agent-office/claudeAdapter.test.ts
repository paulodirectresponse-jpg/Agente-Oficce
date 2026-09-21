import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClaudeAdapter } from './claudeAdapter.js';

describe('ClaudeAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('creates adapter with required interface', () => {
    const adapter = createClaudeAdapter({ baseUrl: 'https://api.anthropic.com', apiKey: 'test-key', model: 'claude-3-5-sonnet' });
    expect(adapter.id).toBe('claude');
    expect(typeof adapter.healthCheck).toBe('function');
    expect(typeof adapter.getCapabilities).toBe('function');
    expect(typeof adapter.startRun).toBe('function');
    expect(typeof adapter.cancel).toBe('function');
  });

  it('healthCheck returns unavailable without network', async () => {
    const adapter = createClaudeAdapter({ baseUrl: 'http://127.0.0.1:9999', apiKey: 'test-key', model: 'test' });
    const health = await adapter.healthCheck();
    expect(health.status).toBe('unavailable');
    expect(health.details).toBeDefined();
  });
});

function sseStream(payload: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

function sseEvents(events: Array<Record<string, unknown>>): string {
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
}

describe('ClaudeAdapter tool loop over SSE', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs a full tool-use cycle against a mocked Anthropic endpoint', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-claude-'));
    await fs.writeFile(path.join(root, 'note.txt'), 'hello world');
    const requests: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) {
        return new Response(sseStream(sseEvents([
          { type: 'message_start', message: { usage: { input_tokens: 25, output_tokens: 1 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"note.txt"}' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } },
          { type: 'message_stop' },
        ])), { status: 200 });
      }
      return new Response(sseStream(sseEvents([
        { type: 'message_start', message: { usage: { input_tokens: 40, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'File says hello world' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
        { type: 'message_stop' },
      ])), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const adapter = createClaudeAdapter({ baseUrl: 'https://gateway.test', apiKey: 'key', model: 'claude-test' });
      const events = [];
      for await (const event of adapter.startRun({ taskId: 'run-1', contextPack: 'read note.txt', projectRoot: root })) {
        events.push(event);
      }
      expect(events.map(event => event.type)).toEqual(['tool_start', 'tool_end', 'delta', 'complete']);
      expect(events[1].payload.ok).toBe(true);
      expect(events[3].payload.usage).toEqual({ input_tokens: 40, output_tokens: 8 });
      const secondRequest = requests[1] as { messages: Array<{ role: string; content: Array<{ type: string; content?: string }> }>; tools: unknown[] };
      expect(secondRequest.tools.length).toBeGreaterThan(0);
      const lastMessage = secondRequest.messages[secondRequest.messages.length - 1];
      expect(lastMessage.role).toBe('user');
      expect(lastMessage.content[0].type).toBe('tool_result');
      expect(lastMessage.content[0].content).toContain('hello world');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('emits an error event when the provider rejects the request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));
    const adapter = createClaudeAdapter({ baseUrl: 'https://gateway.test', apiKey: 'bad', model: 'claude-test' });
    const events = [];
    for await (const event of adapter.startRun({ taskId: 'run-2', contextPack: 'task', projectRoot: process.cwd() })) {
      events.push(event);
    }
    expect(events.map(event => event.type)).toEqual(['error']);
    expect(String(events[0].payload.message)).toContain('CLAUDE_API_ERROR_401');
  });

  it('converts the run timeout into a RUN_TIMEOUT error', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    ));
    const adapter = createClaudeAdapter({ baseUrl: 'https://gateway.test', apiKey: 'key', model: 'claude-test', timeoutMs: 50 });
    const events = [];
    for await (const event of adapter.startRun({ taskId: 'run-3', contextPack: 'task', projectRoot: process.cwd() })) {
      events.push(event);
    }
    expect(events.map(event => event.type)).toEqual(['error']);
    expect(events[0].payload.message).toBe('RUN_TIMEOUT');
  });
});