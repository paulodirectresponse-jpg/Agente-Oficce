import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from './database.js';
import type { SecretStore } from './secretStore.js';
import { ProviderRepositoryV2 } from './v2DataModel.js';
import {
  UniversalProviderEngine,
  supportedAuthDrivers,
  supportedProtocolDrivers,
} from './universalProviderEngine.js';

class MemorySecretStore implements SecretStore {
  private values = new Map<string, string>();
  async get(reference: string): Promise<string | null> { return this.values.get(reference) ?? null; }
  async set(reference: string, value: string): Promise<void> { this.values.set(reference, value); }
  async delete(reference: string): Promise<void> { this.values.delete(reference); }
}

function tempDatabase() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-provider-engine-'));
  const database = openAgentOfficeDatabase({
    dataDir,
    databasePath: path.join(dataDir, 'office.sqlite'),
    logLevel: 'silent',
  });
  return {
    dataDir,
    database,
    cleanup() {
      database.connection.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function streamResponse(payload: string, contentType = 'text/event-stream'): Response {
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': contentType },
  });
}

describe('UniversalProviderEngine', () => {
  it('supports the intended protocol and authentication driver families', () => {
    expect(supportedProtocolDrivers()).toEqual([
      'openai_chat',
      'openai_responses',
      'anthropic_messages',
      'google_gemini',
      'generic_json',
      'generic_sse',
      'generic_ndjson',
    ]);
    expect(supportedAuthDrivers()).toEqual([
      'bearer',
      'x-api-key',
      'custom_header',
      'query_param',
      'basic',
      'none',
    ]);
  });

  it('calls OpenAI-compatible chat APIs with bearer auth and normalizes usage', async () => {
    const fixture = tempDatabase();
    const secrets = new MemorySecretStore();
    await secrets.set('openai-secret', 'secret-token');
    const providers = new ProviderRepositoryV2(fixture.database.connection);
    providers.create({
      id: 'openai-compatible',
      name: 'OpenAI Compatible',
      protocol_driver: 'openai_chat',
      base_url: 'https://provider.example',
      auth_driver: 'bearer',
      secret_ref: 'openai-secret',
    });

    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return jsonResponse({
        choices: [{ message: { content: 'Hello from compatible API' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      });
    };

    const engine = new UniversalProviderEngine(fixture.database.connection, secrets, fetchImpl);
    const result = await engine.complete('openai-compatible', {
      model: 'model-a',
      messages: [{ role: 'user', content: 'hello' }],
      max_output_tokens: 100,
    });

    expect(capturedUrl).toBe('https://provider.example/v1/chat/completions');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-token');
    const body = JSON.parse(String(capturedInit?.body));
    expect(body).toMatchObject({ model: 'model-a', stream: false, max_tokens: 100 });
    expect(result.text).toBe('Hello from compatible API');
    expect(result.usage).toEqual({ input_tokens: 12, output_tokens: 5 });
    fixture.cleanup();
  });

  it('supports OpenAI Responses request/response and streaming event shapes', async () => {
    const fixture = tempDatabase();
    const secrets = new MemorySecretStore();
    await secrets.set('responses-secret', 'responses-token');
    const providers = new ProviderRepositoryV2(fixture.database.connection);
    providers.create({
      id: 'responses',
      name: 'Responses',
      protocol_driver: 'openai_responses',
      base_url: 'https://responses.example',
      auth_driver: 'bearer',
      secret_ref: 'responses-secret',
    });

    let call = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      call += 1;
      const body = JSON.parse(String(init?.body));
      expect(body.instructions).toBe('Be concise.');
      if (call === 1) {
        return jsonResponse({
          status: 'completed',
          output_text: 'response text',
          usage: { input_tokens: 8, output_tokens: 3 },
        });
      }
      return streamResponse(
        'data: {"type":"response.output_text.delta","delta":"A"}\n\n' +
        'data: {"type":"response.output_text.delta","delta":"B"}\n\n' +
        'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":4,"output_tokens":2}}}\n\n',
      );
    };

    const engine = new UniversalProviderEngine(fixture.database.connection, secrets, fetchImpl);
    const input = {
      model: 'response-model',
      messages: [
        { role: 'system' as const, content: 'Be concise.' },
        { role: 'user' as const, content: 'Hello' },
      ],
    };
    expect((await engine.complete('responses', input)).text).toBe('response text');

    const events = [];
    for await (const event of engine.stream('responses', input)) events.push(event);
    expect(events).toContainEqual({ type: 'text_delta', text: 'A' });
    expect(events).toContainEqual({ type: 'text_delta', text: 'B' });
    expect(events).toContainEqual({ type: 'usage', usage: { input_tokens: 4, output_tokens: 2 } });
    expect(events).toContainEqual({ type: 'completed', finish_reason: 'completed' });
    fixture.cleanup();
  });

  it('supports Anthropic Messages with x-api-key auth and model discovery', async () => {
    const fixture = tempDatabase();
    const secrets = new MemorySecretStore();
    await secrets.set('anthropic-secret', 'anthropic-key');
    const providers = new ProviderRepositoryV2(fixture.database.connection);
    providers.create({
      id: 'anthropic',
      name: 'Anthropic',
      protocol_driver: 'anthropic_messages',
      base_url: 'https://anthropic.example',
      auth_driver: 'x-api-key',
      secret_ref: 'anthropic-secret',
    });

    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith('/v1/models')) {
        return jsonResponse({ data: [{ id: 'claude-test', display_name: 'Claude Test' }] });
      }
      return jsonResponse({
        content: [{ type: 'text', text: 'Anthropic answer' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 7 },
      });
    };

    const engine = new UniversalProviderEngine(fixture.database.connection, secrets, fetchImpl);
    const result = await engine.complete('anthropic', {
      model: 'claude-test',
      messages: [
        { role: 'system', content: 'System instruction' },
        { role: 'user', content: 'Question' },
      ],
    });
    expect(result.text).toBe('Anthropic answer');
    const headers = requests[0].init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('anthropic-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const requestBody = JSON.parse(String(requests[0].init?.body));
    expect(requestBody.system).toBe('System instruction');
    expect(requestBody.messages).toEqual([{ role: 'user', content: 'Question' }]);

    const models = await engine.discoverModels('anthropic');
    expect(models[0]).toMatchObject({ model_id: 'claude-test', display_name: 'Claude Test' });
    expect(providers.listModels('anthropic')).toHaveLength(1);
    fixture.cleanup();
  });

  it('supports Gemini native endpoints, custom auth header and model metadata', async () => {
    const fixture = tempDatabase();
    const secrets = new MemorySecretStore();
    await secrets.set('gemini-secret', 'gemini-key');
    const providers = new ProviderRepositoryV2(fixture.database.connection);
    providers.create({
      id: 'gemini',
      name: 'Gemini',
      protocol_driver: 'google_gemini',
      base_url: 'https://gemini.example',
      auth_driver: 'custom_header',
      secret_ref: 'gemini-secret',
      auth_config: { header_name: 'x-goog-api-key' },
      protocol_config: { api_version: 'v1beta' },
    });

    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith('/v1beta/models')) {
        return jsonResponse({
          models: [{
            name: 'models/gemini-test',
            displayName: 'Gemini Test',
            inputTokenLimit: 32000,
            outputTokenLimit: 8000,
            supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
          }],
        });
      }
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Gemini answer' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 4 },
      });
    };

    const engine = new UniversalProviderEngine(fixture.database.connection, secrets, fetchImpl);
    const result = await engine.complete('gemini', {
      model: 'gemini-test',
      messages: [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Hello' },
      ],
    });

    expect(requests[0].url).toBe('https://gemini.example/v1beta/models/gemini-test:generateContent');
    expect((requests[0].init?.headers as Record<string, string>)['x-goog-api-key']).toBe('gemini-key');
    expect(result).toMatchObject({ text: 'Gemini answer', usage: { input_tokens: 6, output_tokens: 4 } });

    const models = await engine.discoverModels('gemini');
    expect(models[0]).toMatchObject({
      model_id: 'gemini-test',
      context_window: 32000,
      max_output_tokens: 8000,
    });
    fixture.cleanup();
  });

  it('supports configurable generic JSON APIs and query-parameter authentication', async () => {
    const fixture = tempDatabase();
    const secrets = new MemorySecretStore();
    await secrets.set('custom-secret', 'query-secret');
    const providers = new ProviderRepositoryV2(fixture.database.connection);
    providers.create({
      id: 'custom-json',
      name: 'Custom JSON',
      protocol_driver: 'generic_json',
      base_url: 'https://custom.example/api',
      auth_driver: 'query_param',
      secret_ref: 'custom-secret',
      auth_config: { param_name: 'token' },
      protocol_config: {
        completion_path: '/generate',
        request_template: {
          engine: '{{model}}',
          prompt: '{{last_user}}',
          history: '{{messages}}',
        },
        response_text_path: 'result.answer',
        input_tokens_path: 'usage.in',
        output_tokens_path: 'usage.out',
      },
    });

    let capturedUrl = '';
    let body: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      body = JSON.parse(String(init?.body));
      return jsonResponse({ result: { answer: 'Custom answer' }, usage: { in: 9, out: 2 } });
    };

    const engine = new UniversalProviderEngine(fixture.database.connection, secrets, fetchImpl);
    const result = await engine.complete('custom-json', {
      model: 'custom-model',
      messages: [{ role: 'user', content: 'My prompt' }],
    });

    expect(capturedUrl).toBe('https://custom.example/api/generate?token=query-secret');
    expect(body).toMatchObject({ engine: 'custom-model', prompt: 'My prompt' });
    expect(Array.isArray(body.history)).toBe(true);
    expect(result.text).toBe('Custom answer');
    expect(result.usage).toEqual({ input_tokens: 9, output_tokens: 2 });
    fixture.cleanup();
  });

  it('normalizes generic SSE streams', async () => {
    const fixture = tempDatabase();
    const providers = new ProviderRepositoryV2(fixture.database.connection);
    providers.create({
      id: 'generic-sse',
      name: 'Generic SSE',
      protocol_driver: 'generic_sse',
      base_url: 'https://stream.example',
      auth_driver: 'none',
      protocol_config: {
        completion_path: '/stream',
        request_template: { prompt: '{{last_user}}', stream: true },
        stream_text_path: 'delta.text',
        stream_done_path: 'done',
      },
    });

    const fetchImpl: typeof fetch = async () => streamResponse(
      'data: {"delta":{"text":"one "}}\n\n' +
      'data: {"delta":{"text":"two"}}\n\n' +
      'data: {"done":true}\n\n',
    );

    const engine = new UniversalProviderEngine(fixture.database.connection, new MemorySecretStore(), fetchImpl);
    const events = [];
    for await (const event of engine.stream('generic-sse', {
      model: 'custom',
      messages: [{ role: 'user', content: 'hello' }],
    })) events.push(event);

    expect(events).toEqual([
      { type: 'text_delta', text: 'one ' },
      { type: 'text_delta', text: 'two' },
      { type: 'completed' },
    ]);
    fixture.cleanup();
  });

  it('normalizes generic NDJSON streams', async () => {
    const fixture = tempDatabase();
    const providers = new ProviderRepositoryV2(fixture.database.connection);
    providers.create({
      id: 'generic-ndjson',
      name: 'Generic NDJSON',
      protocol_driver: 'generic_ndjson',
      base_url: 'https://ndjson.example',
      auth_driver: 'none',
      protocol_config: {
        completion_path: '/generate',
        stream_text_path: 'response',
        stream_done_path: 'done',
      },
    });

    const fetchImpl: typeof fetch = async () => streamResponse(
      '{"response":"A"}\n{"response":"B"}\n{"done":true}\n',
      'application/x-ndjson',
    );

    const engine = new UniversalProviderEngine(fixture.database.connection, new MemorySecretStore(), fetchImpl);
    const events = [];
    for await (const event of engine.stream('generic-ndjson', {
      model: 'local',
      messages: [{ role: 'user', content: 'hello' }],
    })) events.push(event);

    expect(events).toEqual([
      { type: 'text_delta', text: 'A' },
      { type: 'text_delta', text: 'B' },
      { type: 'completed' },
    ]);
    fixture.cleanup();
  });

  it('persists discovered OpenAI-style models and preserves a single default', async () => {
    const fixture = tempDatabase();
    const providers = new ProviderRepositoryV2(fixture.database.connection);
    providers.create({
      id: 'discovery',
      name: 'Discovery',
      protocol_driver: 'openai_chat',
      base_url: 'https://discovery.example',
      auth_driver: 'none',
    });

    const fetchImpl: typeof fetch = async () => jsonResponse({
      data: [
        { id: 'model-1' },
        { id: 'model-2' },
      ],
    });

    const engine = new UniversalProviderEngine(fixture.database.connection, new MemorySecretStore(), fetchImpl);
    await engine.discoverModels('discovery');
    await engine.discoverModels('discovery');

    const models = providers.listModels('discovery');
    expect(models).toHaveLength(2);
    expect(models.filter((model) => model.is_default)).toHaveLength(1);
    expect(models.every((model) => model.metadata.discovery_source === 'provider')).toBe(true);
    fixture.cleanup();
  });

  it('tests provider health and persists healthy/unavailable status without exposing secrets', async () => {
    const fixture = tempDatabase();
    const secrets = new MemorySecretStore();
    await secrets.set('health-secret', 'do-not-leak');
    const providers = new ProviderRepositoryV2(fixture.database.connection);
    providers.create({
      id: 'health',
      name: 'Health',
      protocol_driver: 'openai_chat',
      base_url: 'https://health.example',
      auth_driver: 'bearer',
      secret_ref: 'health-secret',
    });

    let healthy = true;
    const fetchImpl: typeof fetch = async () => healthy
      ? jsonResponse({ data: [] })
      : jsonResponse({ error: { message: 'bad credentials' } }, 401);

    const engine = new UniversalProviderEngine(fixture.database.connection, secrets, fetchImpl);
    expect((await engine.testConnection('health')).status).toBe('healthy');
    expect(providers.get('health')?.health_status).toBe('healthy');

    healthy = false;
    const failed = await engine.testConnection('health');
    expect(failed.status).toBe('unavailable');
    expect(failed.error).toContain('401');
    const stored = providers.get('health')!;
    expect(stored.health_status).toBe('unavailable');
    expect(stored.last_health_error).not.toContain('do-not-leak');
    fixture.cleanup();
  });
});
