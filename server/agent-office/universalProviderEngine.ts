import type { Database } from 'better-sqlite3';
import type { SecretStore } from './secretStore.js';
import { ProviderFallbackRepository, ProviderResilienceManager, isRetryableProviderError } from './providerResilience.js';
import {
  ProviderRepositoryV2,
  type Provider,
  type ProviderModel,
} from './v2DataModel.js';

export type UniversalMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface UniversalToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface UniversalAttachment {
  kind: 'image'|'video'|'audio'|'document'|'code'|'archive'|'other'|string;
  mime_type: string;
  file_name: string;
  size_bytes: number;
  data_base64: string;
}

export interface UniversalMessage {
  role: UniversalMessageRole;
  content: string;
  attachments?: UniversalAttachment[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: UniversalToolCall[];
}

export interface UniversalToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface UniversalCompletionInput {
  model: string;
  messages: UniversalMessage[];
  temperature?: number;
  max_output_tokens?: number;
  metadata?: Record<string, unknown>;
  tools?: UniversalToolDefinition[];
}

export interface UniversalRequestOptions {
  signal?: AbortSignal;
  onResolvedModel?: (providerId: string, modelId: string) => void;
}

export interface UniversalUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface UniversalCompletionResult {
  text: string;
  provider_id?: string;
  model_id?: string;
  finish_reason?: string;
  usage?: UniversalUsage;
  tool_calls?: UniversalToolCall[];
  raw?: unknown;
}

export type UniversalStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'usage'; usage: UniversalUsage }
  | { type: 'completed'; finish_reason?: string }
  | { type: 'error'; message: string };

export interface DiscoveredModel {
  model_id: string;
  display_name: string;
  capabilities: Record<string, unknown>;
  context_window: number | null;
  max_output_tokens: number | null;
  metadata: Record<string, unknown>;
}

export interface ProviderHealthResult {
  provider_id: string;
  status: 'healthy' | 'unavailable';
  latency_ms: number;
  models_discoverable: boolean;
  error?: string;
}

interface PreparedRequest {
  method: 'GET' | 'POST';
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

interface ProtocolDriver {
  readonly id: string;
  prepareCompletion(provider: Provider, input: UniversalCompletionInput, stream: boolean): PreparedRequest;
  parseCompletion(provider: Provider, payload: unknown): UniversalCompletionResult;
  stream(provider: Provider, response: Response): AsyncIterable<UniversalStreamEvent>;
  prepareModelList(provider: Provider): PreparedRequest | null;
  parseModels(provider: Provider, payload: unknown): DiscoveredModel[];
  prepareHealth(provider: Provider): PreparedRequest | null;
}

type FetchLike = typeof fetch;

export class UniversalProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function getString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function configString(provider: Provider, key: string, fallback: string): string {
  const value = provider.protocol_config[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function configNumber(provider: Provider, key: string): number | undefined {
  const value = provider.protocol_config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizePath(value: string): string {
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function sanitizeProviderError(value: string, secret: string | null): string {
  if (!secret) return value;
  return value.split(secret).join('***');
}

function validateBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new UniversalProviderError('PROVIDER_BASE_URL_INVALID', 'Provider base URL is invalid.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UniversalProviderError('PROVIDER_BASE_URL_INVALID', 'Provider base URL must use http or https.');
  }
  if (parsed.username || parsed.password) {
    throw new UniversalProviderError('PROVIDER_BASE_URL_CREDENTIALS_FORBIDDEN', 'Put credentials in the authentication fields, not in the base URL.');
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const base = stripTrailingSlash(baseUrl);
  if (!base) throw new UniversalProviderError('PROVIDER_BASE_URL_REQUIRED', 'Provider base URL is required.');
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${normalizePath(path)}`;
}

function getByPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let current: unknown = value;
  for (const segment of path.split('.').filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function extractTextValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      const object = asObject(item);
      if (typeof object.text === 'string') return object.text;
      if (typeof object.content === 'string') return object.content;
      return '';
    }).join('');
  }
  const object = asObject(value);
  if (typeof object.text === 'string') return object.text;
  if (typeof object.content === 'string') return object.content;
  return '';
}


function openAiChatContent(message:UniversalMessage):unknown{
  const media=(message.attachments??[]).filter(a=>a.kind==='image'&&a.mime_type.startsWith('image/'));
  if(!media.length)return message.content;
  return [{type:'text',text:message.content},...media.map(a=>({type:'image_url',image_url:{url:`data:${a.mime_type};base64,${a.data_base64}`}}))];
}
function openAiResponsesContent(message:UniversalMessage):unknown{
  const parts:any[]=[{type:'input_text',text:message.content}];
  for(const a of message.attachments??[]){
    if(a.kind==='image'&&a.mime_type.startsWith('image/'))parts.push({type:'input_image',image_url:`data:${a.mime_type};base64,${a.data_base64}`});
    else if(a.mime_type==='application/pdf')parts.push({type:'input_file',filename:a.file_name,file_data:`data:${a.mime_type};base64,${a.data_base64}`});
  }
  return parts;
}
function anthropicContent(message:UniversalMessage):unknown{
  const parts:any[]=[];
  for(const a of message.attachments??[]){
    if(a.kind==='image'&&a.mime_type.startsWith('image/'))parts.push({type:'image',source:{type:'base64',media_type:a.mime_type,data:a.data_base64}});
    else if(a.mime_type==='application/pdf')parts.push({type:'document',source:{type:'base64',media_type:'application/pdf',data:a.data_base64}});
  }
  parts.push({type:'text',text:message.content});
  return parts.length===1?message.content:parts;
}
function geminiParts(message:UniversalMessage):any[]{
  const parts:any[]=[{text:message.content}];
  for(const a of message.attachments??[])parts.push({inlineData:{mimeType:a.mime_type,data:a.data_base64}});
  return parts;
}
function requiredModalities(input?:UniversalCompletionInput):Set<string>{
  const set=new Set<string>();
  for(const m of input?.messages??[])for(const a of m.attachments??[]){
    if(a.kind==='image')set.add('image');else if(a.kind==='audio')set.add('audio');else if(a.kind==='video')set.add('video');else if(a.mime_type==='application/pdf')set.add('pdf');
  }
  return set;
}

function systemAndConversation(messages: UniversalMessage[]): {
  system: string;
  conversation: UniversalMessage[];
} {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  return {
    system,
    conversation: messages.filter((message) => message.role !== 'system'),
  };
}

function applyTemplate(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const exact = /^\{\{([a-zA-Z0-9_]+)\}\}$/.exec(value);
    if (exact) return context[exact[1]];
    return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
      const replacement = context[key];
      if (replacement == null) return '';
      if (typeof replacement === 'string' || typeof replacement === 'number' || typeof replacement === 'boolean') {
        return String(replacement);
      }
      return JSON.stringify(replacement);
    });
  }
  if (Array.isArray(value)) return value.map((item) => applyTemplate(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, applyTemplate(item, context)]),
    );
  }
  return value;
}

function genericContext(input: UniversalCompletionInput, stream: boolean): Record<string, unknown> {
  const { system, conversation } = systemAndConversation(input.messages);
  const lastUser = [...conversation].reverse().find((message) => message.role === 'user')?.content ?? '';
  return {
    model: input.model,
    messages: input.messages,
    conversation,
    system,
    prompt: lastUser,
    last_user: lastUser,
    stream,
    temperature: input.temperature,
    max_output_tokens: input.max_output_tokens,
  };
}

function toUsage(input: unknown, output: unknown): UniversalUsage | undefined {
  const inputNumber = typeof input === 'number' ? input : undefined;
  const outputNumber = typeof output === 'number' ? output : undefined;
  return inputNumber !== undefined || outputNumber !== undefined
    ? { input_tokens: inputNumber, output_tokens: outputNumber }
    : undefined;
}

async function* decodedLines(response: Response): AsyncIterable<string> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        yield line;
        index = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer) yield buffer.replace(/\r$/, '');
  } finally {
    reader.releaseLock();
  }
}

async function* sseJsonPayloads(response: Response): AsyncIterable<Record<string, any>> {
  let dataLines: string[] = [];
  for await (const line of decodedLines(response)) {
    if (!line) {
      if (dataLines.length) {
        const raw = dataLines.join('\n');
        dataLines = [];
        if (raw === '[DONE]') continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') yield parsed;
        } catch {
          // Ignore malformed provider chunks and wait for the next complete event.
        }
      }
      continue;
    }
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length) {
    const raw = dataLines.join('\n');
    if (raw !== '[DONE]') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') yield parsed;
      } catch {
        // Ignore a trailing malformed chunk.
      }
    }
  }
}

async function* ndjsonPayloads(response: Response): AsyncIterable<Record<string, any>> {
  for await (const line of decodedLines(response)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') yield parsed;
    } catch {
      // Ignore malformed provider lines.
    }
  }
}

class OpenAiChatDriver implements ProtocolDriver {
  readonly id: string = 'openai_chat';

  prepareCompletion(provider: Provider, input: UniversalCompletionInput, stream: boolean): PreparedRequest {
    const messages = input.messages.map((message) => {
      const base: Record<string, unknown> = {
        role: message.role,
        content: openAiChatContent(message),
      };
      if (message.name) base.name = message.name;
      if (message.tool_call_id) base.tool_call_id = message.tool_call_id;
      if (message.tool_calls?.length) {
        base.tool_calls = message.tool_calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        }));
      }
      return base;
    });
    const body: Record<string, unknown> = {
      model: input.model,
      messages,
      stream,
    };
    if (input.tools?.length) {
      body.tools = input.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      }));
      body.tool_choice = 'auto';
    }
    if (stream) body.stream_options = { include_usage: true };
    if (input.temperature !== undefined) body.temperature = input.temperature;
    if (input.max_output_tokens !== undefined) {
      body[configString(provider, 'max_output_field', 'max_tokens')] = input.max_output_tokens;
    }
    return {
      method: 'POST',
      path: configString(provider, 'completion_path', '/v1/chat/completions'),
      body,
    };
  }

  parseCompletion(_provider: Provider, payload: unknown): UniversalCompletionResult {
    const root = asObject(payload);
    if (root.error) throw new UniversalProviderError('PROVIDER_RESPONSE_ERROR', getString(asObject(root.error).message, 'Provider returned an error.'));
    const choice = asObject(Array.isArray(root.choices) ? root.choices[0] : undefined);
    const message = asObject(choice.message);
    const usageRoot = asObject(root.usage);
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls: UniversalToolCall[] = rawCalls.flatMap((value: unknown, index: number) => {
      const call = asObject(value);
      const fn = asObject(call.function);
      const name = getString(fn.name);
      if (!name) return [];
      let args: Record<string, unknown> = {};
      const rawArguments = fn.arguments;
      if (typeof rawArguments === 'string' && rawArguments.trim()) {
        try {
          const parsed = JSON.parse(rawArguments);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
        } catch {
          args = { __raw_arguments: rawArguments };
        }
      } else if (rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
        args = rawArguments as Record<string, unknown>;
      }
      return [{
        id: getString(call.id) || `tool-call-${index + 1}`,
        name,
        arguments: args,
      }];
    });
    return {
      text: extractTextValue(message.content),
      finish_reason: getString(choice.finish_reason) || undefined,
      usage: toUsage(usageRoot.prompt_tokens ?? usageRoot.input_tokens, usageRoot.completion_tokens ?? usageRoot.output_tokens),
      tool_calls: toolCalls.length ? toolCalls : undefined,
      raw: payload,
    };
  }

  async *stream(_provider: Provider, response: Response): AsyncIterable<UniversalStreamEvent> {
    for await (const payload of sseJsonPayloads(response)) {
      if (payload.error) {
        yield { type: 'error', message: getString(asObject(payload.error).message, 'Provider stream error.') };
        continue;
      }
      const choice = asObject(Array.isArray(payload.choices) ? payload.choices[0] : undefined);
      const delta = asObject(choice.delta);
      const text = extractTextValue(delta.content);
      if (text) yield { type: 'text_delta', text };
      const usage = asObject(payload.usage);
      const normalized = toUsage(usage.prompt_tokens ?? usage.input_tokens, usage.completion_tokens ?? usage.output_tokens);
      if (normalized) yield { type: 'usage', usage: normalized };
      if (choice.finish_reason) yield { type: 'completed', finish_reason: String(choice.finish_reason) };
    }
  }

  prepareModelList(provider: Provider): PreparedRequest {
    return { method: 'GET', path: configString(provider, 'models_path', '/v1/models') };
  }

  parseModels(provider: Provider, payload: unknown): DiscoveredModel[] {
    if (configString(provider, 'models_format', '') === 'ollama') {
      const models = asObject(payload).models;
      return Array.isArray(models)
        ? models.flatMap((model) => {
          const object = asObject(model);
          const name = getString(object.name) || getString(object.model);
          return name ? [{
            model_id: name,
            display_name: name,
            capabilities: { text: true, streaming: true, image: true, pdf: this.id === 'openai_responses' },
            context_window: null,
            max_output_tokens: null,
            metadata: object,
          }] : [];
        })
        : [];
    }
    const data = asObject(payload).data;
    return Array.isArray(data)
      ? data.flatMap((model) => {
        const object = asObject(model);
        const modelId = getString(object.id);
        return modelId ? [{
          model_id: modelId,
          display_name: getString(object.display_name) || modelId,
          capabilities: { text: true, streaming: true, image: true, pdf: this.id === 'openai_responses' },
          context_window: typeof object.context_window === 'number' ? object.context_window : null,
          max_output_tokens: typeof object.max_output_tokens === 'number' ? object.max_output_tokens : null,
          metadata: object,
        }] : [];
      })
      : [];
  }

  prepareHealth(provider: Provider): PreparedRequest {
    const healthPath = getString(provider.protocol_config.health_path);
    return healthPath
      ? { method: getString(provider.protocol_config.health_method, 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET', path: healthPath }
      : this.prepareModelList(provider);
  }
}

class OpenAiResponsesDriver extends OpenAiChatDriver {
  readonly id = 'openai_responses';

  prepareCompletion(provider: Provider, input: UniversalCompletionInput, stream: boolean): PreparedRequest {
    const { system, conversation } = systemAndConversation(input.messages);
    const body: Record<string, unknown> = {
      model: input.model,
      input: conversation.map((message) => ({ role: message.role, content: openAiResponsesContent(message) })),
      stream,
    };
    if (system) body.instructions = system;
    if (input.temperature !== undefined) body.temperature = input.temperature;
    if (input.max_output_tokens !== undefined) body.max_output_tokens = input.max_output_tokens;
    return {
      method: 'POST',
      path: configString(provider, 'completion_path', '/v1/responses'),
      body,
    };
  }

  parseCompletion(_provider: Provider, payload: unknown): UniversalCompletionResult {
    const root = asObject(payload);
    if (root.error) throw new UniversalProviderError('PROVIDER_RESPONSE_ERROR', getString(asObject(root.error).message, 'Provider returned an error.'));
    let text = getString(root.output_text);
    if (!text && Array.isArray(root.output)) {
      text = root.output.map((item) => {
        const object = asObject(item);
        return extractTextValue(object.content);
      }).join('');
    }
    const usage = asObject(root.usage);
    return {
      text,
      finish_reason: getString(root.status) || undefined,
      usage: toUsage(usage.input_tokens, usage.output_tokens),
      raw: payload,
    };
  }

  async *stream(_provider: Provider, response: Response): AsyncIterable<UniversalStreamEvent> {
    for await (const payload of sseJsonPayloads(response)) {
      const eventType = getString(payload.type);
      if (eventType === 'response.output_text.delta' && typeof payload.delta === 'string') {
        yield { type: 'text_delta', text: payload.delta };
      } else if (eventType === 'response.completed') {
        const responseObject = asObject(payload.response);
        const usage = asObject(responseObject.usage);
        const normalized = toUsage(usage.input_tokens, usage.output_tokens);
        if (normalized) yield { type: 'usage', usage: normalized };
        yield { type: 'completed', finish_reason: getString(responseObject.status, 'completed') };
      } else if (eventType === 'response.failed' || eventType === 'error') {
        const error = asObject(payload.error ?? asObject(payload.response).error);
        yield { type: 'error', message: getString(error.message, 'Provider stream error.') };
      }
    }
  }
}

class AnthropicMessagesDriver implements ProtocolDriver {
  readonly id = 'anthropic_messages';

  prepareCompletion(provider: Provider, input: UniversalCompletionInput, stream: boolean): PreparedRequest {
    const { system, conversation } = systemAndConversation(input.messages);
    const body: Record<string, unknown> = {
      model: input.model,
      max_tokens: input.max_output_tokens ?? configNumber(provider, 'default_max_output_tokens') ?? 8192,
      messages: conversation.map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: anthropicContent(message),
      })),
      stream,
    };
    if (system) body.system = system;
    if (input.temperature !== undefined) body.temperature = input.temperature;
    return {
      method: 'POST',
      path: configString(provider, 'completion_path', '/v1/messages'),
      headers: {
        'anthropic-version': configString(provider, 'anthropic_version', '2023-06-01'),
      },
      body,
    };
  }

  parseCompletion(_provider: Provider, payload: unknown): UniversalCompletionResult {
    const root = asObject(payload);
    if (root.error) throw new UniversalProviderError('PROVIDER_RESPONSE_ERROR', getString(asObject(root.error).message, 'Provider returned an error.'));
    const content = Array.isArray(root.content) ? root.content : [];
    const usage = asObject(root.usage);
    return {
      text: content.map(extractTextValue).join(''),
      finish_reason: getString(root.stop_reason) || undefined,
      usage: toUsage(usage.input_tokens, usage.output_tokens),
      raw: payload,
    };
  }

  async *stream(_provider: Provider, response: Response): AsyncIterable<UniversalStreamEvent> {
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let stopReason: string | undefined;
    for await (const payload of sseJsonPayloads(response)) {
      const type = getString(payload.type);
      if (type === 'message_start') {
        const usage = asObject(asObject(payload.message).usage);
        if (typeof usage.input_tokens === 'number') inputTokens = usage.input_tokens;
        if (typeof usage.output_tokens === 'number') outputTokens = usage.output_tokens;
      } else if (type === 'content_block_delta') {
        const delta = asObject(payload.delta);
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          yield { type: 'text_delta', text: delta.text };
        }
      } else if (type === 'message_delta') {
        const delta = asObject(payload.delta);
        if (typeof delta.stop_reason === 'string') stopReason = delta.stop_reason;
        const usage = asObject(payload.usage);
        if (typeof usage.output_tokens === 'number') outputTokens = usage.output_tokens;
      } else if (type === 'message_stop') {
        const usage = toUsage(inputTokens, outputTokens);
        if (usage) yield { type: 'usage', usage };
        yield { type: 'completed', finish_reason: stopReason ?? 'end_turn' };
      } else if (type === 'error') {
        yield { type: 'error', message: getString(asObject(payload.error).message, 'Provider stream error.') };
      }
    }
  }

  prepareModelList(provider: Provider): PreparedRequest {
    return {
      method: 'GET',
      path: configString(provider, 'models_path', '/v1/models'),
      headers: {
        'anthropic-version': configString(provider, 'anthropic_version', '2023-06-01'),
      },
    };
  }

  parseModels(_provider: Provider, payload: unknown): DiscoveredModel[] {
    const data = asObject(payload).data;
    return Array.isArray(data)
      ? data.flatMap((model) => {
        const object = asObject(model);
        const modelId = getString(object.id);
        return modelId ? [{
          model_id: modelId,
          display_name: getString(object.display_name) || modelId,
          capabilities: { text: true, streaming: true, image: true, pdf: this.id === 'openai_responses' },
          context_window: typeof object.context_window === 'number' ? object.context_window : null,
          max_output_tokens: typeof object.max_output_tokens === 'number' ? object.max_output_tokens : null,
          metadata: object,
        }] : [];
      })
      : [];
  }

  prepareHealth(provider: Provider): PreparedRequest {
    const healthPath = getString(provider.protocol_config.health_path);
    return healthPath
      ? {
        method: getString(provider.protocol_config.health_method, 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
        path: healthPath,
        headers: { 'anthropic-version': configString(provider, 'anthropic_version', '2023-06-01') },
      }
      : this.prepareModelList(provider);
  }
}

class GoogleGeminiDriver implements ProtocolDriver {
  readonly id = 'google_gemini';

  private apiVersion(provider: Provider): string {
    return configString(provider, 'api_version', 'v1beta');
  }

  private cleanModel(model: string): string {
    return model.replace(/^models\//, '');
  }

  prepareCompletion(provider: Provider, input: UniversalCompletionInput, stream: boolean): PreparedRequest {
    const { system, conversation } = systemAndConversation(input.messages);
    const model = this.cleanModel(input.model);
    const version = this.apiVersion(provider);
    const suffix = stream ? 'streamGenerateContent' : 'generateContent';
    const body: Record<string, unknown> = {
      contents: conversation.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: geminiParts(message),
      })),
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const generationConfig: Record<string, unknown> = {};
    if (input.temperature !== undefined) generationConfig.temperature = input.temperature;
    if (input.max_output_tokens !== undefined) generationConfig.maxOutputTokens = input.max_output_tokens;
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
    return {
      method: 'POST',
      path: `/${version}/models/${encodeURIComponent(model)}:${suffix}`,
      query: stream ? { alt: 'sse' } : undefined,
      body,
    };
  }

  parseCompletion(_provider: Provider, payload: unknown): UniversalCompletionResult {
    const root = asObject(payload);
    if (root.error) throw new UniversalProviderError('PROVIDER_RESPONSE_ERROR', getString(asObject(root.error).message, 'Provider returned an error.'));
    const candidate = asObject(Array.isArray(root.candidates) ? root.candidates[0] : undefined);
    const content = asObject(candidate.content);
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const usage = asObject(root.usageMetadata);
    return {
      text: parts.map(extractTextValue).join(''),
      finish_reason: getString(candidate.finishReason) || undefined,
      usage: toUsage(usage.promptTokenCount, usage.candidatesTokenCount),
      raw: payload,
    };
  }

  async *stream(_provider: Provider, response: Response): AsyncIterable<UniversalStreamEvent> {
    for await (const payload of sseJsonPayloads(response)) {
      if (payload.error) {
        yield { type: 'error', message: getString(asObject(payload.error).message, 'Provider stream error.') };
        continue;
      }
      const candidate = asObject(Array.isArray(payload.candidates) ? payload.candidates[0] : undefined);
      const content = asObject(candidate.content);
      const parts = Array.isArray(content.parts) ? content.parts : [];
      const text = parts.map(extractTextValue).join('');
      if (text) yield { type: 'text_delta', text };
      const usage = asObject(payload.usageMetadata);
      const normalized = toUsage(usage.promptTokenCount, usage.candidatesTokenCount);
      if (normalized) yield { type: 'usage', usage: normalized };
      if (candidate.finishReason) yield { type: 'completed', finish_reason: String(candidate.finishReason) };
    }
  }

  prepareModelList(provider: Provider): PreparedRequest {
    return {
      method: 'GET',
      path: configString(provider, 'models_path', `/${this.apiVersion(provider)}/models`),
    };
  }

  parseModels(_provider: Provider, payload: unknown): DiscoveredModel[] {
    const models = asObject(payload).models;
    return Array.isArray(models)
      ? models.flatMap((model) => {
        const object = asObject(model);
        const name = getString(object.name);
        const modelId = name.replace(/^models\//, '');
        if (!modelId) return [];
        const methods = Array.isArray(object.supportedGenerationMethods) ? object.supportedGenerationMethods : [];
        return [{
          model_id: modelId,
          display_name: getString(object.displayName) || modelId,
          capabilities: {
            text: methods.includes('generateContent') || methods.includes('streamGenerateContent'),
            streaming: methods.includes('streamGenerateContent'),
            image: true,
            audio: true,
            video: true,
            pdf: true,
          },
          context_window: typeof object.inputTokenLimit === 'number' ? object.inputTokenLimit : null,
          max_output_tokens: typeof object.outputTokenLimit === 'number' ? object.outputTokenLimit : null,
          metadata: object,
        }];
      })
      : [];
  }

  prepareHealth(provider: Provider): PreparedRequest {
    const healthPath = getString(provider.protocol_config.health_path);
    return healthPath
      ? { method: getString(provider.protocol_config.health_method, 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET', path: healthPath }
      : this.prepareModelList(provider);
  }
}

class GenericDriver implements ProtocolDriver {
  constructor(
    readonly id: 'generic_json' | 'generic_sse' | 'generic_ndjson',
  ) {}

  prepareCompletion(provider: Provider, input: UniversalCompletionInput, stream: boolean): PreparedRequest {
    const method = configString(provider, 'method', 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
    const template = provider.protocol_config.request_template;
    const body = template == null
      ? genericContext(input, stream)
      : applyTemplate(template, genericContext(input, stream));
    return {
      method,
      path: configString(provider, stream ? 'stream_path' : 'completion_path', configString(provider, 'completion_path', '/')),
      body: method === 'POST' ? body : undefined,
    };
  }

  parseCompletion(provider: Provider, payload: unknown): UniversalCompletionResult {
    const errorPath = getString(provider.protocol_config.error_path);
    const errorValue = errorPath ? getByPath(payload, errorPath) : undefined;
    if (errorValue) throw new UniversalProviderError('PROVIDER_RESPONSE_ERROR', extractTextValue(errorValue) || 'Provider returned an error.');
    const textPath = configString(provider, 'response_text_path', 'text');
    const inputTokensPath = getString(provider.protocol_config.input_tokens_path);
    const outputTokensPath = getString(provider.protocol_config.output_tokens_path);
    const finishPath = getString(provider.protocol_config.finish_reason_path);
    return {
      text: extractTextValue(getByPath(payload, textPath)),
      finish_reason: finishPath ? extractTextValue(getByPath(payload, finishPath)) || undefined : undefined,
      usage: toUsage(
        inputTokensPath ? getByPath(payload, inputTokensPath) : undefined,
        outputTokensPath ? getByPath(payload, outputTokensPath) : undefined,
      ),
      raw: payload,
    };
  }

  async *stream(provider: Provider, response: Response): AsyncIterable<UniversalStreamEvent> {
    if (this.id === 'generic_json') {
      const payload = await response.json();
      const result = this.parseCompletion(provider, payload);
      if (result.text) yield { type: 'text_delta', text: result.text };
      if (result.usage) yield { type: 'usage', usage: result.usage };
      yield { type: 'completed', finish_reason: result.finish_reason };
      return;
    }

    const textPath = configString(provider, 'stream_text_path', configString(provider, 'response_text_path', 'text'));
    const inputTokensPath = getString(provider.protocol_config.input_tokens_path);
    const outputTokensPath = getString(provider.protocol_config.output_tokens_path);
    const donePath = getString(provider.protocol_config.stream_done_path);
    const errorPath = getString(provider.protocol_config.error_path);
    const payloads = this.id === 'generic_sse' ? sseJsonPayloads(response) : ndjsonPayloads(response);

    for await (const payload of payloads) {
      const errorValue = errorPath ? getByPath(payload, errorPath) : undefined;
      if (errorValue) {
        yield { type: 'error', message: extractTextValue(errorValue) || 'Provider stream error.' };
        continue;
      }
      const text = extractTextValue(getByPath(payload, textPath));
      if (text) yield { type: 'text_delta', text };
      const usage = toUsage(
        inputTokensPath ? getByPath(payload, inputTokensPath) : undefined,
        outputTokensPath ? getByPath(payload, outputTokensPath) : undefined,
      );
      if (usage) yield { type: 'usage', usage };
      if (donePath && Boolean(getByPath(payload, donePath))) {
        yield { type: 'completed' };
      }
    }
  }

  prepareModelList(provider: Provider): PreparedRequest | null {
    const path = getString(provider.protocol_config.models_path);
    return path ? { method: 'GET', path } : null;
  }

  parseModels(provider: Provider, payload: unknown): DiscoveredModel[] {
    const listPath = configString(provider, 'models_list_path', 'data');
    const idPath = configString(provider, 'model_id_path', 'id');
    const namePath = configString(provider, 'model_display_name_path', idPath);
    const list = getByPath(payload, listPath);
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      const modelId = extractTextValue(getByPath(item, idPath));
      if (!modelId) return [];
      return [{
        model_id: modelId,
        display_name: extractTextValue(getByPath(item, namePath)) || modelId,
        capabilities: { text: true, streaming: this.id !== 'generic_json' },
        context_window: null,
        max_output_tokens: null,
        metadata: asObject(item),
      }];
    });
  }

  prepareHealth(provider: Provider): PreparedRequest | null {
    const path = getString(provider.protocol_config.health_path);
    if (path) {
      return {
        method: getString(provider.protocol_config.health_method, 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
        path,
      };
    }
    return this.prepareModelList(provider);
  }
}

function createProtocolDriver(id: string): ProtocolDriver {
  if (id === 'openai_chat' || id === 'openai_compatible') return new OpenAiChatDriver();
  if (id === 'openai_responses') return new OpenAiResponsesDriver();
  if (id === 'anthropic_messages') return new AnthropicMessagesDriver();
  if (id === 'google_gemini') return new GoogleGeminiDriver();
  if (id === 'generic_json') return new GenericDriver('generic_json');
  if (id === 'generic_sse') return new GenericDriver('generic_sse');
  if (id === 'generic_ndjson') return new GenericDriver('generic_ndjson');
  throw new UniversalProviderError('PROTOCOL_DRIVER_UNSUPPORTED', `Unsupported protocol driver: ${id}`);
}

function authHeadersAndQuery(
  provider: Provider,
  secret: string | null,
): { headers: Record<string, string>; query: Record<string, string> } {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  const driver = provider.auth_driver.trim().toLowerCase();

  if (driver === 'none' || !driver) return { headers, query };
  if (!secret) throw new UniversalProviderError('PROVIDER_SECRET_MISSING', 'Provider secret is not configured.');

  if (driver === 'bearer') {
    headers.Authorization = `Bearer ${secret}`;
  } else if (driver === 'x-api-key' || driver === 'x_api_key') {
    headers['x-api-key'] = secret;
  } else if (driver === 'custom_header') {
    const name = getString(provider.auth_config.header_name);
    if (!name) throw new UniversalProviderError('AUTH_HEADER_NAME_REQUIRED', 'Custom header authentication requires header_name.');
    const prefix = getString(provider.auth_config.prefix);
    headers[name] = prefix ? `${prefix}${secret}` : secret;
  } else if (driver === 'query_param') {
    const name = getString(provider.auth_config.param_name, 'key');
    const prefix = getString(provider.auth_config.prefix);
    query[name] = prefix ? `${prefix}${secret}` : secret;
  } else if (driver === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(secret).toString('base64')}`;
  } else {
    throw new UniversalProviderError('AUTH_DRIVER_UNSUPPORTED', `Unsupported auth driver: ${provider.auth_driver}`);
  }

  return { headers, query };
}

class HttpTransport {
  constructor(private readonly fetchImpl: FetchLike) {}

  private prepare(provider: Provider, request: PreparedRequest, secret: string | null): {
    url: string;
    init: RequestInit;
  } {
    validateBaseUrl(provider.base_url);
    const auth = authHeadersAndQuery(provider, secret);
    const url = new URL(joinUrl(provider.base_url, request.path));
    for (const [key, value] of Object.entries(provider.query)) url.searchParams.set(key, value);
    for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, value);
    for (const [key, value] of Object.entries(auth.query)) url.searchParams.set(key, value);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...provider.headers,
      ...(request.headers ?? {}),
      ...auth.headers,
    };

    const init: RequestInit = {
      method: request.method,
      headers,
    };

    if (request.body !== undefined) {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      init.body = JSON.stringify(request.body);
    }

    return { url: url.toString(), init };
  }

  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new UniversalProviderError('PROVIDER_CANCELLED', 'Provider request was cancelled.'));
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async request(
    provider: Provider,
    request: PreparedRequest,
    secret: string | null,
    options: UniversalRequestOptions = {},
  ): Promise<Response> {
    const { url, init } = this.prepare(provider, request, secret);
    const configuredRetries = configNumber(provider, 'retry_attempts');
    const maxRetries = Math.max(0, Math.min(5, configuredRetries ?? (request.method === 'GET' ? 2 : 0)));
    const baseBackoffMs = Math.max(100, configNumber(provider, 'retry_backoff_ms') ?? 500);

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (options.signal?.aborted) {
        throw new UniversalProviderError('PROVIDER_CANCELLED', 'Provider request was cancelled.');
      }

      const controller = new AbortController();
      let timedOut = false;
      const onExternalAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onExternalAbort, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, Math.max(1, provider.timeout_ms));

      try {
        const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
        if (response.ok) return response;

        const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
        let detail = '';
        try {
          detail = sanitizeProviderError((await response.text()).slice(0, 1000), secret);
        } catch {
          detail = '';
        }

        if (!retryable || attempt >= maxRetries) {
          throw new UniversalProviderError(
            'PROVIDER_HTTP_ERROR',
            `Provider request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
            response.status,
          );
        }

        const retryAfter = Number(response.headers.get('retry-after'));
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(10_000, baseBackoffMs * (2 ** attempt));
        await this.delay(delayMs, options.signal);
      } catch (error) {
        if (error instanceof UniversalProviderError) throw error;
        if (options.signal?.aborted) {
          throw new UniversalProviderError('PROVIDER_CANCELLED', 'Provider request was cancelled.');
        }
        if (error instanceof Error && error.name === 'AbortError') {
          if (timedOut) {
            if (attempt < maxRetries && request.method === 'GET') {
              await this.delay(Math.min(10_000, baseBackoffMs * (2 ** attempt)), options.signal);
              continue;
            }
            throw new UniversalProviderError('PROVIDER_TIMEOUT', 'Provider request timed out.');
          }
          throw new UniversalProviderError('PROVIDER_CANCELLED', 'Provider request was cancelled.');
        }
        if (attempt < maxRetries && request.method === 'GET') {
          await this.delay(Math.min(10_000, baseBackoffMs * (2 ** attempt)), options.signal);
          continue;
        }
        throw new UniversalProviderError(
          'PROVIDER_NETWORK_ERROR',
          error instanceof Error ? sanitizeProviderError(error.message, secret) : 'Provider request failed.',
        );
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', onExternalAbort);
      }
    }

    throw new UniversalProviderError('PROVIDER_NETWORK_ERROR', 'Provider request failed.');
  }

  async json(
    provider: Provider,
    request: PreparedRequest,
    secret: string | null,
    options: UniversalRequestOptions = {},
  ): Promise<unknown> {
    const response = await this.request(provider, request, secret, options);
    try {
      return await response.json();
    } catch {
      throw new UniversalProviderError('PROVIDER_JSON_INVALID', 'Provider returned invalid JSON.');
    }
  }
}

export class UniversalProviderEngine {
  private readonly providers: ProviderRepositoryV2;
  private readonly transport: HttpTransport;
  private readonly resilience: ProviderResilienceManager;
  private readonly fallbacks: ProviderFallbackRepository;

  constructor(
    private readonly database: Database,
    private readonly secrets: SecretStore,
    fetchImpl: FetchLike = fetch,
  ) {
    this.providers = new ProviderRepositoryV2(database);
    this.transport = new HttpTransport(fetchImpl);
    this.resilience = new ProviderResilienceManager(database);
    this.fallbacks = new ProviderFallbackRepository(database);
  }

  private provider(providerId: string): Provider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new UniversalProviderError('PROVIDER_NOT_FOUND', 'Provider not found.');
    if (!provider.enabled) throw new UniversalProviderError('PROVIDER_DISABLED', 'Provider is disabled.');
    return provider;
  }

  private async secret(provider: Provider): Promise<string | null> {
    if (provider.auth_driver === 'none' || !provider.auth_driver) return null;
    if (!provider.secret_ref) throw new UniversalProviderError('PROVIDER_SECRET_MISSING', 'Provider secret is not configured.');
    const secret = await this.secrets.get(provider.secret_ref);
    if (!secret) throw new UniversalProviderError('PROVIDER_SECRET_MISSING', 'Provider secret is not available.');
    return secret;
  }

  private estimatedTokens(input: UniversalCompletionInput): number {
    const chars = input.messages.reduce((sum, message) => sum + message.content.length, 0);
    return Math.max(1, Math.ceil(chars / 4));
  }

  private candidates(providerId: string, model: string, input?: UniversalCompletionInput): Array<{ providerId: string; model: string; implicit?: boolean }> {
    const result: Array<{ providerId: string; model: string; implicit?: boolean }> = [{ providerId, model }];
    const seen = new Set([providerId + '::' + model]);

    // Explicit user-configured fallbacks always win.
    for (const fallback of this.fallbacks.list(providerId, model)) {
      const targetProvider = this.providers.get(fallback.target_provider_id);
      if (!targetProvider?.enabled) continue;
      const targetModel = fallback.target_model
        || this.providers.listModels(targetProvider.id, false).find(item => item.is_default)?.model_id
        || this.providers.listModels(targetProvider.id, false)[0]?.model_id;
      if (!targetModel) continue;
      const key = targetProvider.id + '::' + targetModel;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ providerId: targetProvider.id, model: targetModel });
    }

    // Surgical resilience: if the selected model itself is temporarily unavailable,
    // try another enabled compatible model from the SAME provider before giving up.
    // This does not run on auth/config errors and does not override explicit fallbacks.
    const needsTools = Boolean(input?.tools?.length);
    const modalities=requiredModalities(input);
    const providerAccepts=(candidateProvider:Provider,candidateModel:string)=>{
      if(!modalities.size)return true;
      const modelRow=this.providers.listModels(candidateProvider.id,false).find(item=>item.model_id===candidateModel);
      const caps=modelRow?.capabilities??{};
      const protocol=candidateProvider.protocol_driver;
      for(const modality of modalities){
        if(caps[modality]===false)return false;
        if(caps[modality]===true)continue;
        if(modality==='image'&&['openai_chat','openai_compatible','openai_responses','anthropic_messages','google_gemini'].includes(protocol))continue;
        if(modality==='pdf'&&['openai_responses','anthropic_messages','google_gemini'].includes(protocol))continue;
        if((modality==='audio'||modality==='video')&&protocol==='google_gemini')continue;
        return false;
      }
      return true;
    };
    const initial=result.filter(item=>{const p=this.providers.get(item.providerId);return Boolean(p&&providerAccepts(p,item.model))});
    result.splice(0,result.length,...initial);
    const sameProviderModels = this.providers.listModels(providerId, false)
      .filter(item => item.enabled && item.model_id !== model)
      .filter(item => !needsTools || item.capabilities.tools !== false)
      .filter(item => {const p=this.providers.get(providerId);return Boolean(p&&providerAccepts(p,item.model_id))})
      .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.display_name.localeCompare(b.display_name));

    for (const item of sameProviderModels) {
      const key = providerId + '::' + item.model_id;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ providerId, model: item.model_id, implicit: true });
    }

    if(modalities.size){
      for(const candidateProvider of this.providers.list().filter(item=>item.enabled&&item.id!==providerId)){
        const modelRow=this.providers.listModels(candidateProvider.id,false)
          .filter(item=>item.enabled)
          .sort((a,b)=>Number(b.is_default)-Number(a.is_default)||a.display_name.localeCompare(b.display_name))
          .find(item=>providerAccepts(candidateProvider,item.model_id)&&(!needsTools||item.capabilities.tools!==false));
        if(!modelRow)continue;
        const key=candidateProvider.id+'::'+modelRow.model_id;
        if(seen.has(key))continue;
        seen.add(key);
        result.push({providerId:candidateProvider.id,model:modelRow.model_id,implicit:true});
      }
    }

    if(!result.length&&requiredModalities(input).size)throw new UniversalProviderError('MODEL_MULTIMODAL_UNSUPPORTED','No configured provider/model can accept the attached media types. Configure a compatible multimodal model or fallback.');
    return result;
  }

  private isModelScopedTransient(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const status = 'status' in error ? Number((error as any).status) : undefined;
    return status === 502 || status === 503 || status === 504;
  }

  private async completeCandidate(
    providerId: string,
    model: string,
    input: UniversalCompletionInput,
    options: UniversalRequestOptions,
  ): Promise<UniversalCompletionResult> {
    const provider = this.provider(providerId);
    const release = await this.resilience.acquire(provider, this.estimatedTokens(input), options.signal);
    try {
      const driver = createProtocolDriver(provider.protocol_driver);
      const secret = await this.secret(provider);
      const payload = await this.transport.json(provider, driver.prepareCompletion(provider, { ...input, model }, false), secret, options);
      const result = driver.parseCompletion(provider, payload);
      this.resilience.recordSuccess(provider, model, Math.max(0,
        (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0) - this.estimatedTokens(input)
      ));
      return { ...result, provider_id: provider.id, model_id: model };
    } catch (error) {
      if (this.isModelScopedTransient(error)) this.resilience.recordModelFailure(provider, model, error);
      else this.resilience.recordFailure(provider, model, error);
      throw error;
    } finally {
      release();
    }
  }

  async complete(
    providerId: string,
    input: UniversalCompletionInput,
    options: UniversalRequestOptions = {},
  ): Promise<UniversalCompletionResult> {
    const candidates = this.candidates(providerId, input.model, input);
    let lastError: unknown;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (candidate.implicit && lastError && !this.isModelScopedTransient(lastError)) continue;
      try {
        return await this.completeCandidate(candidate.providerId, candidate.model, input, options);
      } catch (error) {
        lastError = error;
        if (!isRetryableProviderError(error) || index === candidates.length - 1) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new UniversalProviderError('PROVIDER_REQUEST_FAILED', 'Provider request failed.');
  }

  async *stream(
    providerId: string,
    input: UniversalCompletionInput,
    options: UniversalRequestOptions = {},
  ): AsyncIterable<UniversalStreamEvent> {
    const candidates = this.candidates(providerId, input.model, input);
    let lastError: unknown;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (candidate.implicit && lastError && !this.isModelScopedTransient(lastError)) continue;
      const provider = this.provider(candidate.providerId);
      let release: (() => void) | null = null;
      let emitted = false;
      try {
        release = await this.resilience.acquire(provider, this.estimatedTokens(input), options.signal);
        const driver = createProtocolDriver(provider.protocol_driver);
        const secret = await this.secret(provider);
        const response = await this.transport.request(provider, driver.prepareCompletion(provider, { ...input, model: candidate.model }, true), secret, options);
        options.onResolvedModel?.(provider.id, candidate.model);
        let tokenTotal = 0;
        for await (const event of driver.stream(provider, response)) {
          if (event.type === 'usage') tokenTotal += (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
          if (event.type === 'text_delta') emitted = true;
          yield event;
        }
        this.resilience.recordSuccess(provider, candidate.model, Math.max(0, tokenTotal - this.estimatedTokens(input)));
        return;
      } catch (error) {
        lastError = error;
        const code = error && typeof error === 'object' && 'code' in error ? String((error as any).code ?? '') : '';
        if (release || (code !== 'PROVIDER_CIRCUIT_OPEN' && code !== 'PROVIDER_COOLDOWN')) {
          if (this.isModelScopedTransient(error)) this.resilience.recordModelFailure(provider, candidate.model, error);
          else this.resilience.recordFailure(provider, candidate.model, error);
        }
        if (emitted || !isRetryableProviderError(error) || index === candidates.length - 1) throw error;
      } finally {
        release?.();
      }
    }
    throw lastError instanceof Error ? lastError : new UniversalProviderError('PROVIDER_REQUEST_FAILED', 'Provider stream failed.');
  }

  async discoverModels(providerId: string, persist = true): Promise<DiscoveredModel[]> {
    const provider = this.provider(providerId);
    const driver = createProtocolDriver(provider.protocol_driver);
    const request = driver.prepareModelList(provider);
    if (!request) throw new UniversalProviderError('MODEL_DISCOVERY_UNSUPPORTED', 'This provider has no model-list endpoint configured.');
    const secret = await this.secret(provider);
    const payload = await this.transport.json(provider, request, secret);
    const models = driver.parseModels(provider, payload);
    if (persist) {
      const discoveredIds = new Set(models.map(model => model.model_id));
      for (const model of models) {
        this.providers.upsertDiscoveredModel(provider.id, model);
        this.database.prepare(`
          INSERT INTO provider_model_runtime_state (
            provider_id, model_id, operational_status, last_success_at, last_failure_at, last_error, updated_at
          ) VALUES (?, ?, 'healthy', ?, NULL, NULL, ?)
          ON CONFLICT(provider_id,model_id) DO UPDATE SET
            operational_status='healthy', last_success_at=excluded.last_success_at,
            last_error=NULL, updated_at=excluded.updated_at
        `).run(provider.id, model.model_id, new Date().toISOString(), new Date().toISOString());
      }
      const existing = this.providers.listModels(provider.id, true);
      for (const model of existing) {
        if (discoveredIds.has(model.model_id)) continue;
        this.database.prepare(`
          INSERT INTO provider_model_runtime_state (
            provider_id, model_id, operational_status, last_success_at, last_failure_at, last_error, updated_at
          ) VALUES (?, ?, 'unavailable', NULL, ?, 'Model was not returned by provider discovery.', ?)
          ON CONFLICT(provider_id,model_id) DO UPDATE SET
            operational_status='unavailable', last_failure_at=excluded.last_failure_at,
            last_error=excluded.last_error, updated_at=excluded.updated_at
        `).run(provider.id, model.model_id, new Date().toISOString(), new Date().toISOString());
      }
    }
    return models;
  }

  async testConnection(providerId: string): Promise<ProviderHealthResult> {
    const provider = this.provider(providerId);
    const driver = createProtocolDriver(provider.protocol_driver);
    const request = driver.prepareHealth(provider);
    if (!request) {
      throw new UniversalProviderError(
        'PROVIDER_HEALTH_UNSUPPORTED',
        'Configure health_path or models_path to test this provider.',
      );
    }

    const started = Date.now();
    try {
      const secret = await this.secret(provider);
      await this.transport.request(provider, request, secret);
      const latency = Date.now() - started;
      this.providers.update(provider.id, {
        health_status: 'healthy',
        last_health_at: new Date().toISOString(),
        last_health_error: null,
      });
      this.resilience.recordSuccess(provider, '__health__');
      return {
        provider_id: provider.id,
        status: 'healthy',
        latency_ms: latency,
        models_discoverable: driver.prepareModelList(provider) !== null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider connection failed.';
      this.resilience.recordFailure(provider, '__health__', error);
      this.providers.update(provider.id, {
        health_status: 'unavailable',
        last_health_at: new Date().toISOString(),
        last_health_error: message.slice(0, 1000),
      });
      return {
        provider_id: provider.id,
        status: 'unavailable',
        latency_ms: Date.now() - started,
        models_discoverable: driver.prepareModelList(provider) !== null,
        error: message,
      };
    }
  }
}

export function supportedProtocolDrivers(): string[] {
  return [
    'openai_chat',
    'openai_responses',
    'anthropic_messages',
    'google_gemini',
    'generic_json',
    'generic_sse',
    'generic_ndjson',
  ];
}

export function supportedAuthDrivers(): string[] {
  return ['bearer', 'x-api-key', 'custom_header', 'query_param', 'basic', 'none'];
}
