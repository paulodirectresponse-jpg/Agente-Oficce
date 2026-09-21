import type { AgentAdapter, AgentRunInput, AgentEvent, UsageSnapshot, AgentHealth, AgentCapabilities } from './adapterFramework.js';
import { createProviderProtocol, type ToolDefinition, type ToolResult } from './providerProtocol.js';
import type { ModelTurn, ToolRequest, StreamParser } from './providerProtocol.js';
import { executeLocalTool, type LocalToolContext, type LocalToolName } from './localTools.js';
import { runToolLoop, DEFAULT_MAX_TOOL_STEPS, type CompletedModelTurn } from './toolLoop.js';

export interface ClaudeAdapterConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  authScheme?: 'bearer' | 'x-api-key' | 'custom';
  customAuthHeader?: string;
  healthCheckEndpoint?: string;
  healthCheckMethod?: 'GET' | 'POST';
  maxToolSteps?: number;
  systemPrompt?: string;
}

const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';
const DEFAULT_TIMEOUT = 60000;

const DEFAULT_SYSTEM_PROMPT = [
  'You are a coding agent inside Agent Office, a local-first orchestrator.',
  'Use the provided tools to inspect and modify the project when needed.',
  'Paths are always relative to the project root.',
  'When the task is finished, respond with a concise summary and stop calling tools.',
].join(' ');

export const LOCAL_TOOL_SCHEMAS: ToolDefinition[] = [
  {
    name: 'list_files',
    description: 'List files in a directory within the project root.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to project root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a bounded text file within the project root.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Search files in a directory for a literal text pattern.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Literal text to search for' },
        path: { type: 'string', description: 'Directory path to search in, relative to project root' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'write_file',
    description: 'Write a text file within the project root. Creates directories if needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'apply_patch',
    description: 'Replace an exact unique text segment of a file with new text.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
        old_text: { type: 'string', description: 'Exact existing text to replace. Must occur exactly once in the file.' },
        new_text: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'git_status',
    description: 'Inspect project Git status.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'git_diff',
    description: 'Inspect project Git diff.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'run_command',
    description: 'Run an allowlisted executable (git, npm, node) without a shell. Destructive commands are denied.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command as an array: executable followed by arguments, e.g. ["git", "status", "--short"]',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'run_tests',
    description: 'Run the project test command (npm test).',
    input_schema: { type: 'object', properties: {} },
  },
];

const LOCAL_TOOL_NAMES = LOCAL_TOOL_SCHEMAS.map(tool => tool.name);

export function createClaudeAdapter(config: ClaudeAdapterConfig): AgentAdapter {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const model = config.model || DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT;
  const authScheme = config.authScheme || 'bearer';
  const customAuthHeader = config.customAuthHeader || 'Authorization';
  const healthCheckEndpoint = config.healthCheckEndpoint || '/v1/models';
  const healthCheckMethod = config.healthCheckMethod || 'GET';
  const maxToolSteps = config.maxToolSteps || DEFAULT_MAX_TOOL_STEPS;
  const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const protocol = createProviderProtocol({ strategy: 'anthropic_messages' });

  function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (authScheme === 'bearer' || authScheme === 'custom') {
      headers[customAuthHeader] = authScheme === 'bearer' ? `Bearer ${config.apiKey}` : config.apiKey;
    } else if (authScheme === 'x-api-key') {
      headers['x-api-key'] = config.apiKey;
    }
    return headers;
  }

  const activeControllers = new Map<string, { controller: AbortController; timedOut: boolean }>();

  async function streamModelTurn(
    conversation: ModelTurn[],
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<CompletedModelTurn> {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...authHeaders(),
      },
      body: JSON.stringify(protocol.buildRequest({
        model,
        conversation,
        tools: LOCAL_TOOL_SCHEMAS,
        systemPrompt,
      })),
      signal,
    });
    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`CLAUDE_API_ERROR_${response.status}: ${errorText}`.slice(0, 500));
    }
    const parser: StreamParser = protocol.createStreamParser();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const toolRequests: ToolRequest[] = [];
    let stopReason = 'end_turn';
    let usage: CompletedModelTurn['usage'];
    const handle = (events: ReturnType<StreamParser['push']>): void => {
      for (const streamEvent of events) {
        if (streamEvent.type === 'text_delta') {
          text += streamEvent.text;
          onText(streamEvent.text);
        } else if (streamEvent.type === 'tool_use') {
          toolRequests.push(streamEvent.request);
        } else if (streamEvent.type === 'message_complete') {
          stopReason = streamEvent.stopReason;
          usage = streamEvent.usage;
        } else if (streamEvent.type === 'error') {
          throw new Error(streamEvent.message);
        }
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      handle(parser.push(decoder.decode(value, { stream: true })));
    }
    handle(parser.flush());
    return { text, toolRequests, stopReason, usage };
  }

  return {
    id: 'claude',
    async healthCheck(): Promise<AgentHealth> {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${baseUrl}${healthCheckEndpoint}`, { method: healthCheckMethod, headers: authHeaders(), signal: controller.signal });
        clearTimeout(timer);
        if (response.ok) {
          return { status: 'healthy', capabilities: { streaming: true, resume: false, tools: [...LOCAL_TOOL_NAMES], max_context_tokens: 200000 } };
        }
        if (response.status === 401) return { status: 'unavailable', details: 'Invalid API key' };
        return { status: 'degraded', details: `HTTP ${response.status}` };
      } catch (error) {
        return { status: 'unavailable', details: error instanceof Error ? error.message : 'Health check failed' };
      }
    },
    getCapabilities(): AgentCapabilities {
      return { streaming: true, resume: false, tools: [...LOCAL_TOOL_NAMES], max_context_tokens: 200000 };
    },
    async getUsage(): Promise<UsageSnapshot | null> {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${baseUrl}/v1/usage`, { headers: authHeaders(), signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) return null;
        const data = await response.json() as Record<string, unknown>;
        return { source: 'provider', raw: data };
      } catch {
        return null;
      }
    },
    async *startRun({ taskId, contextPack, projectRoot }: AgentRunInput): AsyncIterable<AgentEvent> {
      const controller = new AbortController();
      const state = { controller, timedOut: false };
      activeControllers.set(taskId, state);
      const timer = setTimeout(() => {
        state.timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const toolContext: LocalToolContext = { projectRoot };
        const conversation: ModelTurn[] = [{ role: 'user', content: [{ type: 'text', text: contextPack }] }];
        const events = runToolLoop({
          protocol,
          conversation,
          tools: LOCAL_TOOL_SCHEMAS,
          maxToolSteps,
          signal: controller.signal,
          streamModel: (turns, signal, onText) => streamModelTurn(turns, signal, onText),
          executeTool: async (request: ToolRequest): Promise<ToolResult> => {
            const result = await executeLocalTool(request.name as LocalToolName, request.input, toolContext);
            if (!result.ok) {
              return { tool_use_id: request.id, content: result.error ?? 'LOCAL_TOOL_FAILED', is_error: true };
            }
            return { tool_use_id: request.id, content: JSON.stringify(result.data ?? {}) };
          },
        });
        for await (const event of events) {
          if (state.timedOut && (event.type === 'cancelled' || event.type === 'error')) {
            yield { type: 'error', timestamp: event.timestamp, payload: { message: 'RUN_TIMEOUT', timeoutMs } };
            continue;
          }
          yield event;
        }
      } finally {
        clearTimeout(timer);
        activeControllers.delete(taskId);
      }
    },
    async cancel(runId: string): Promise<void> {
      const state = activeControllers.get(runId);
      if (state) {
        state.controller.abort();
        activeControllers.delete(runId);
      }
    },
  };
}
