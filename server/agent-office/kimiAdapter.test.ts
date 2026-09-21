import { describe, expect, it, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createKimiAdapter } from './kimiAdapter.js';

function sse(payload: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of payload) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.close();
    },
  });
}

describe('KimiAdapter (openai_compatible)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs a full tool cycle against a mocked Moonshot endpoint', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-kimi-'));
    await fs.writeFile(path.join(root, 'note.txt'), 'hello from kimi');
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) {
        return new Response(sse([
          {
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":' } }],
              },
            }],
          },
          {
            choices: [{
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '"note.txt"}' } }] },
            }],
          },
          { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 30, completion_tokens: 15 } },
          { choices: [] },
        ]), { status: 200 });
      }
      return new Response(sse([
        { choices: [{ index: 0, delta: { role: 'assistant', content: 'Kimi finished' } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 80, completion_tokens: 10 } },
      ]), { status: 200 });
    }));
    try {
      const adapter = createKimiAdapter({ baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'sk-test', model: 'kimi-k2-0905-preview' });
      const events = [];
      for await (const event of adapter.startRun({ taskId: 'k1', contextPack: 'read the note', projectRoot: root })) {
        events.push(event);
      }
      expect(events.map(event => event.type)).toEqual(['tool_start', 'tool_end', 'delta', 'complete']);
      expect(events[1].payload.ok).toBe(true);
      expect(events[3].payload.usage).toEqual({ input_tokens: 80, output_tokens: 10 });
      const firstRequest = requests[0] as { stream_options: unknown; tools: Array<{ type: string; function: { name: string } }>; messages: Array<{ role: string }> };
      expect(firstRequest.stream_options).toEqual({ include_usage: true });
      expect(firstRequest.tools[0].type).toBe('function');
      expect(firstRequest.tools.map(tool => tool.function.name)).toContain('read_file');
      expect(firstRequest.messages[0].role).toBe('system');
      const secondRequest = requests[1] as { messages: Array<{ role: string; tool_call_id?: string; content?: string }> };
      const toolMessage = secondRequest.messages.find(message => message.role === 'tool');
      expect(toolMessage?.tool_call_id).toBe('call_1');
      expect(toolMessage?.content).toContain('hello from kimi');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('cancels a hung stream', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    ));
    const adapter = createKimiAdapter({ baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'sk-test', model: 'm' });
    const iterator = adapter.startRun({ taskId: 'k2', contextPack: 'task', projectRoot: process.cwd() })[Symbol.asyncIterator]();
    const first = iterator.next();
    await adapter.cancel('k2');
    const result = await first;
    expect(result.done).toBe(false);
    expect(result.value.type).toBe('cancelled');
    expect((await iterator.next()).done).toBe(true);
  });

  it('emits an error event on provider rejection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad key', { status: 401 })));
    const adapter = createKimiAdapter({ baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'bad', model: 'm' });
    const events = [];
    for await (const event of adapter.startRun({ taskId: 'k3', contextPack: 'task', projectRoot: process.cwd() })) {
      events.push(event);
    }
    expect(events.map(event => event.type)).toEqual(['error']);
    expect(String(events[0].payload.message)).toContain('KIMI_API_ERROR_401');
  });

  it('converts timeout into RUN_TIMEOUT error', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    ));
    const adapter = createKimiAdapter({ baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'sk-test', model: 'm', timeoutMs: 50 });
    const events = [];
    for await (const event of adapter.startRun({ taskId: 'k4', contextPack: 'task', projectRoot: process.cwd() })) {
      events.push(event);
    }
    expect(events.map(event => event.type)).toEqual(['error']);
    expect(events[0].payload.message).toBe('RUN_TIMEOUT');
  });

  it('healthCheck reports unavailable without network', async () => {
    const adapter = createKimiAdapter({ baseUrl: 'http://127.0.0.1:9999', apiKey: 'sk-test', model: 'm' });
    const health = await adapter.healthCheck();
    expect(health.status).toBe('unavailable');
  });
});
