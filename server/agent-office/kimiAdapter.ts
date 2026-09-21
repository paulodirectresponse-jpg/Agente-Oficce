import type { AgentAdapter, AgentRunInput, AgentEvent, UsageSnapshot, AgentHealth, AgentCapabilities } from './adapterFramework.js';
import { createProviderProtocol, type ToolDefinition, type ToolResult } from './providerProtocol.js';
import type { ModelTurn, ToolRequest, StreamParser } from './providerProtocol.js';
import { executeLocalTool, type LocalToolContext, type LocalToolName } from './localTools.js';
import { runToolLoop, DEFAULT_MAX_TOOL_STEPS, type CompletedModelTurn } from './toolLoop.js';
import { LOCAL_TOOL_SCHEMAS } from './claudeAdapter.js';

export interface KimiAdapterConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxToolSteps?: number;
  systemPrompt?: string;
}

const DEFAULT_BASE_URL = 'https://api.moonshot.ai/v1';
const DEFAULT_MODEL = 'kimi-k2-0905-preview';
const DEFAULT_TIMEOUT = 120000;

const DEFAULT_SYSTEM_PROMPT = [
  'You are the Kimi agent inside Agent Office, a local-first orchestrator.',
  'Use the provided tools to inspect and modify the project when needed.',
  'Paths are always relative to the project root.',
  'When the task is finished, respond with a concise summary and stop calling tools.',
].join(' ');

export function createKimiAdapter(config: KimiAdapterConfig): AgentAdapter {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const model = config.model || DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT;
  const maxToolSteps = config.maxToolSteps || DEFAULT_MAX_TOOL_STEPS;
  const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const protocol = createProviderProtocol({ strategy: 'openai_compatible' });
  const tools: ToolDefinition[] = LOCAL_TOOL_SCHEMAS;

  const activeControllers = new Map<string, { controller: AbortController; timedOut: boolean }>();

  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${config.apiKey}` };
  }

  async function streamModelTurn(
    conversation: ModelTurn[],
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<CompletedModelTurn> {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(protocol.buildRequest({
        model,
        conversation,
        tools,
        systemPrompt,
      })),
      signal,
    });
    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`KIMI_API_ERROR_${response.status}: ${errorText}`.slice(0, 500));
    }
    const parser: StreamParser = protocol.createStreamParser();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const toolRequests: ToolRequest[] = [];
    let stopReason = 'stop';
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
    id: 'kimi',
    async healthCheck(): Promise<AgentHealth> {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${baseUrl}/models`, { headers: authHeaders(), signal: controller.signal });
        clearTimeout(timer);
        if (response.ok) {
          return { status: 'healthy', capabilities: { streaming: true, resume: false, tools: tools.map(tool => tool.name) } };
        }
        if (response.status === 401) return { status: 'unavailable', details: 'Invalid API key' };
        return { status: 'degraded', details: `HTTP ${response.status}` };
      } catch (error) {
        return { status: 'unavailable', details: error instanceof Error ? error.message : 'Health check failed' };
      }
    },
    getCapabilities(): AgentCapabilities {
      return { streaming: true, resume: false, tools: tools.map(tool => tool.name) };
    },
    async getUsage(): Promise<UsageSnapshot | null> {
      return null;
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
          tools,
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
