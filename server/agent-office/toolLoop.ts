import type { AgentEvent } from './adapterFramework.js';
import type { ModelTurn, ProviderProtocol, ToolDefinition, ToolRequest, ToolResult, TurnUsage } from './providerProtocol.js';

export interface CompletedModelTurn {
  text: string;
  toolRequests: ToolRequest[];
  stopReason: string;
  usage?: TurnUsage;
}

export type StreamModelFn = (
  conversation: ModelTurn[],
  signal: AbortSignal,
  onText: (text: string) => void,
) => Promise<CompletedModelTurn>;

export type ExecuteToolFn = (request: ToolRequest) => Promise<ToolResult>;

export interface ToolLoopOptions {
  protocol: ProviderProtocol;
  conversation: ModelTurn[];
  tools: ToolDefinition[];
  streamModel: StreamModelFn;
  executeTool: ExecuteToolFn;
  maxToolSteps: number;
  signal: AbortSignal;
}

export const DEFAULT_MAX_TOOL_STEPS = 20;

function now(): string {
  return new Date().toISOString();
}

function event(type: AgentEvent['type'], payload: Record<string, unknown>): AgentEvent {
  return { type, timestamp: now(), payload };
}

class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length) {
      const waiter = this.waiters.shift()!;
      waiter({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.items.length) {
          return Promise.resolve({ value: this.items.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<T>>(resolve => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

function validateToolArguments(request: ToolRequest, tools: ToolDefinition[]): string | null {
  const definition = tools.find(tool => tool.name === request.name);
  if (!definition) return `UNKNOWN_TOOL: ${request.name}`;
  const schema = definition.input_schema as { required?: string[]; properties?: Record<string, { type?: string }> };
  for (const required of schema.required ?? []) {
    if (request.input[required] === undefined || request.input[required] === null) {
      return `INVALID_ARGUMENTS: missing required field "${required}" for tool "${request.name}"`;
    }
  }
  const typeMap: Record<string, string> = { string: 'string', number: 'number', boolean: 'boolean', array: 'object', object: 'object' };
  for (const [field, spec] of Object.entries(schema.properties ?? {})) {
    const value = request.input[field];
    if (value === undefined || !spec.type) continue;
    const expected = typeMap[spec.type];
    if (expected && typeof value !== expected) {
      return `INVALID_ARGUMENTS: field "${field}" for tool "${request.name}" must be ${spec.type}`;
    }
    if (spec.type === 'array' && !Array.isArray(value)) {
      return `INVALID_ARGUMENTS: field "${field}" for tool "${request.name}" must be array`;
    }
  }
  return null;
}

const APPROVAL_ERROR_CODES = new Set(['DESTRUCTIVE_COMMAND_DENIED', 'WRITE_TARGET_NOT_APPROVED', 'COMMAND_NOT_ALLOWED']);

export function runToolLoop(options: ToolLoopOptions): AsyncIterable<AgentEvent> {
  const queue = new EventQueue<AgentEvent>();
  const { protocol, conversation, tools, streamModel, executeTool, maxToolSteps, signal } = options;

  const run = async (): Promise<void> => {
    let toolSteps = 0;
    try {
      while (true) {
        if (signal.aborted) {
          queue.push(event('cancelled', { reason: 'aborted' }));
          return;
        }
        const turn = await streamModel(conversation, signal, text => {
          queue.push(event('delta', { text }));
        });
        if (turn.toolRequests.length === 0) {
          queue.push(event('complete', { success: true, stopReason: turn.stopReason, usage: turn.usage }));
          return;
        }
        conversation.push(protocol.assistantTurn(turn.text, turn.toolRequests));
        const results: ToolResult[] = [];
        let limitHit = false;
        for (const request of turn.toolRequests) {
          toolSteps += 1;
          if (toolSteps > maxToolSteps) {
            queue.push(event('max_tool_steps', { steps: toolSteps - 1, limit: maxToolSteps, reason: 'max_tool_steps' }));
            limitHit = true;
            break;
          }
          if (signal.aborted) break;
          queue.push(event('tool_start', { id: request.id, name: request.name, input: request.input }));
          const validationError = validateToolArguments(request, tools);
          let result: ToolResult;
          if (validationError) {
            result = { tool_use_id: request.id, content: validationError, is_error: true };
          } else {
            try {
              result = await executeTool(request);
            } catch (error) {
              result = { tool_use_id: request.id, content: error instanceof Error ? error.message : 'TOOL_EXECUTION_FAILED', is_error: true };
            }
          }
          const approvalRequired = result.is_error && APPROVAL_ERROR_CODES.has(result.content);
          queue.push(event('tool_end', {
            id: request.id,
            name: request.name,
            ok: !result.is_error,
            ...(result.is_error ? { error: result.content } : {}),
            ...(approvalRequired ? { approval_required: true } : {}),
          }));
          if (approvalRequired) {
            queue.push(event('warning', {
              approval_required: true,
              tool: request.name,
              reason: result.content,
              message: 'Operation requires human approval and was not executed.',
            }));
            result = {
              ...result,
              content: `${result.content}. This operation requires human approval (waiting_approval) and was not executed. Do not retry the same operation.`,
            };
          }
          results.push(result);
        }
        if (limitHit) return;
        if (signal.aborted) {
          queue.push(event('cancelled', { reason: 'aborted' }));
          return;
        }
        conversation.push(protocol.buildToolResultTurn(results));
      }
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        queue.push(event('cancelled', { reason: 'aborted' }));
      } else {
        queue.push(event('error', { message: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }));
      }
    } finally {
      queue.close();
    }
  };

  void run();
  return queue;
}
