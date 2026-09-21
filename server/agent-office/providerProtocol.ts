export type ProviderProtocolStrategy = 'anthropic_messages' | 'openai_compatible' | 'custom';

export interface ToolRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ModelTurn {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface TurnUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; request: ToolRequest }
  | { type: 'message_complete'; stopReason: string; usage?: TurnUsage }
  | { type: 'error'; message: string };

export interface StreamParser {
  push(chunk: string): StreamEvent[];
  flush(): StreamEvent[];
}

export interface BuildRequestInput {
  model: string;
  conversation: ModelTurn[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ProviderProtocol {
  readonly strategy: ProviderProtocolStrategy;
  buildRequest(input: BuildRequestInput): Record<string, unknown>;
  createStreamParser(): StreamParser;
  assistantTurn(text: string, toolRequests: ToolRequest[]): ModelTurn;
  buildToolResultTurn(results: ToolResult[]): ModelTurn;
}

class AnthropicStreamParser implements StreamParser {
  private buffer = '';
  private blocks = new Map<number, { kind: 'text' | 'tool_use'; id?: string; name?: string; json?: string }>();
  private inputTokens: number | undefined;
  private outputTokens: number | undefined;
  private stopReason: string | undefined;
  private completed = false;

  push(chunk: string): StreamEvent[] {
    this.buffer += chunk;
    const events: StreamEvent[] = [];
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.processLine(line, events);
      newlineIndex = this.buffer.indexOf('\n');
    }
    return events;
  }

  flush(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this.buffer.trim()) {
      this.processLine(this.buffer, events);
      this.buffer = '';
    }
    return events;
  }

  private processLine(line: string, events: StreamEvent[]): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let data: any;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    switch (data.type) {
      case 'message_start': {
        const usage = data.message?.usage;
        if (usage?.input_tokens !== undefined) this.inputTokens = usage.input_tokens;
        if (usage?.output_tokens !== undefined) this.outputTokens = usage.output_tokens;
        return;
      }
      case 'content_block_start': {
        const index: number = data.index;
        const block = data.content_block;
        if (block?.type === 'tool_use') {
          this.blocks.set(index, { kind: 'tool_use', id: block.id, name: block.name, json: '' });
        } else {
          this.blocks.set(index, { kind: 'text' });
        }
        return;
      }
      case 'content_block_delta': {
        const block = this.blocks.get(data.index);
        if (!block) return;
        const delta = data.delta;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          events.push({ type: 'text_delta', text: delta.text });
        } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          block.json = (block.json ?? '') + delta.partial_json;
        }
        return;
      }
      case 'content_block_stop': {
        const block = this.blocks.get(data.index);
        if (block?.kind === 'tool_use' && block.id && block.name) {
          let input: Record<string, unknown> = {};
          if (block.json) {
            try {
              const parsed = JSON.parse(block.json);
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
            } catch {
              events.push({ type: 'error', message: `TOOL_INPUT_JSON_INVALID: ${block.name}` });
              this.blocks.delete(data.index);
              return;
            }
          }
          events.push({ type: 'tool_use', request: { id: block.id, name: block.name, input } });
        }
        this.blocks.delete(data.index);
        return;
      }
      case 'message_delta': {
        if (data.delta?.stop_reason) this.stopReason = data.delta.stop_reason;
        if (data.usage?.output_tokens !== undefined) this.outputTokens = data.usage.output_tokens;
        return;
      }
      case 'message_stop': {
        this.completed = true;
        events.push({
          type: 'message_complete',
          stopReason: this.stopReason ?? 'end_turn',
          usage: this.inputTokens !== undefined || this.outputTokens !== undefined
            ? { input_tokens: this.inputTokens, output_tokens: this.outputTokens }
            : undefined,
        });
        return;
      }
      case 'error': {
        const message = data.error?.message ?? 'PROVIDER_STREAM_ERROR';
        events.push({ type: 'error', message });
        return;
      }
      default:
        return;
    }
  }
}

export class AnthropicMessagesProtocol implements ProviderProtocol {
  readonly strategy = 'anthropic_messages' as const;

  buildRequest(input: BuildRequestInput): Record<string, unknown> {
    const request: Record<string, unknown> = {
      model: input.model,
      max_tokens: input.maxTokens ?? 8192,
      stream: true,
      messages: input.conversation.map(turn => ({ role: turn.role, content: turn.content })),
    };
    if (input.systemPrompt) request.system = input.systemPrompt;
    if (input.temperature !== undefined) request.temperature = input.temperature;
    if (input.tools && input.tools.length) request.tools = input.tools;
    return request;
  }

  createStreamParser(): StreamParser {
    return new AnthropicStreamParser();
  }

  assistantTurn(text: string, toolRequests: ToolRequest[]): ModelTurn {
    const content: ContentBlock[] = [];
    if (text) content.push({ type: 'text', text });
    for (const request of toolRequests) {
      content.push({ type: 'tool_use', id: request.id, name: request.name, input: request.input });
    }
    return { role: 'assistant', content };
  }

  buildToolResultTurn(results: ToolResult[]): ModelTurn {
    return {
      role: 'user',
      content: results.map(result => ({
        type: 'tool_result' as const,
        tool_use_id: result.tool_use_id,
        content: result.content,
        ...(result.is_error ? { is_error: true } : {}),
      })),
    };
  }
}

export class OpenAiCompatibleProtocol implements ProviderProtocol {
  readonly strategy = 'openai_compatible' as const;

  buildRequest(input: BuildRequestInput): Record<string, unknown> {
    const messages: Record<string, unknown>[] = [];
    if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt });
    for (const turn of input.conversation) {
      const toolCalls = turn.content.filter(block => block.type === 'tool_use');
      if (turn.role === 'assistant' && toolCalls.length) {
        messages.push({
          role: 'assistant',
          content: turn.content.filter(block => block.type === 'text').map(block => (block as { type: 'text'; text: string }).text).join('') || null,
          tool_calls: toolCalls.map(block => ({
            id: (block as { id: string }).id,
            type: 'function',
            function: {
              name: (block as { name: string }).name,
              arguments: JSON.stringify((block as { input: Record<string, unknown> }).input),
            },
          })),
        });
        continue;
      }
      if (turn.role === 'assistant') {
        messages.push({ role: 'assistant', content: turn.content.map(block => (block as { type: 'text'; text: string }).text).join('') });
        continue;
      }
      const toolResults = turn.content.filter(block => block.type === 'tool_result');
      if (toolResults.length) {
        for (const block of toolResults) {
          const result = block as { tool_use_id: string; content: string; is_error?: boolean };
          messages.push({ role: 'tool', tool_call_id: result.tool_use_id, content: result.content });
        }
        continue;
      }
      messages.push({ role: 'user', content: turn.content.map(block => (block as { type: 'text'; text: string }).text).join('') });
    }
    const request: Record<string, unknown> = {
      model: input.model,
      stream: true,
      stream_options: { include_usage: true },
      messages,
    };
    if (input.maxTokens) request.max_tokens = input.maxTokens;
    if (input.temperature !== undefined) request.temperature = input.temperature;
    if (input.tools && input.tools.length) {
      request.tools = input.tools.map(tool => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
      }));
    }
    return request;
  }

  createStreamParser(): StreamParser {
    return new OpenAiStreamParser();
  }

  assistantTurn(text: string, toolRequests: ToolRequest[]): ModelTurn {
    const content: ContentBlock[] = [];
    if (text) content.push({ type: 'text', text });
    for (const request of toolRequests) {
      content.push({ type: 'tool_use', id: request.id, name: request.name, input: request.input });
    }
    return { role: 'assistant', content };
  }

  buildToolResultTurn(results: ToolResult[]): ModelTurn {
    return {
      role: 'user',
      content: results.map(result => ({
        type: 'tool_result' as const,
        tool_use_id: result.tool_use_id,
        content: result.content,
        ...(result.is_error ? { is_error: true } : {}),
      })),
    };
  }
}

class OpenAiStreamParser implements StreamParser {
  private buffer = '';
  private toolCalls = new Map<number, { id?: string; name?: string; args: string }>();
  private finishReason: string | undefined;
  private usage: TurnUsage | undefined;

  push(chunk: string): StreamEvent[] {
    this.buffer += chunk;
    const events: StreamEvent[] = [];
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.processLine(line, events);
      newlineIndex = this.buffer.indexOf('\n');
    }
    return events;
  }

  flush(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this.buffer.trim()) {
      this.processLine(this.buffer, events);
      this.buffer = '';
    }
    for (const request of this.closeToolCalls()) events.push({ type: 'tool_use', request });
    if (this.finishReason) {
      events.push({ type: 'message_complete', stopReason: this.finishReason, usage: this.usage });
    }
    return events;
  }

  private closeToolCalls(): ToolRequest[] {
    const completed: ToolRequest[] = [];
    for (const [index, call] of this.toolCalls) {
      if (call.id && call.name) {
        let input: Record<string, unknown> = {};
        if (call.args) {
          try {
            const parsed = JSON.parse(call.args);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
          } catch {
            input = {};
          }
        }
        completed.push({ id: call.id, name: call.name, input });
      }
      this.toolCalls.delete(index);
    }
    return completed;
  }

  private processLine(line: string, events: StreamEvent[]): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      if (payload === '[DONE]') this.finishReason = this.finishReason ?? 'stop';
      return;
    }
    let data: any;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    if (data.error) {
      const message = data.error?.message ?? 'PROVIDER_STREAM_ERROR';
      events.push({ type: 'error', message });
      return;
    }
    const choice = data.choices?.[0];
    const delta = choice?.delta;
    if (delta?.content) events.push({ type: 'text_delta', text: delta.content });
    if (Array.isArray(delta?.tool_calls)) {
      for (const toolCall of delta.tool_calls) {
        const index: number = toolCall.index ?? 0;
        const existing = this.toolCalls.get(index) ?? { args: '' };
        if (toolCall.id) existing.id = toolCall.id;
        if (toolCall.function?.name) existing.name = toolCall.function.name;
        if (toolCall.function?.arguments) existing.args += toolCall.function.arguments;
        this.toolCalls.set(index, existing);
      }
    }
    if (choice?.finish_reason) {
      this.finishReason = choice.finish_reason;
      for (const request of this.closeToolCalls()) events.push({ type: 'tool_use', request });
    }
    if (data.usage) {
      this.usage = {
        input_tokens: data.usage.prompt_tokens ?? data.usage.input_tokens,
        output_tokens: data.usage.completion_tokens ?? data.usage.output_tokens,
      };
    }
  }
}

export function createProviderProtocol(config: { strategy: ProviderProtocolStrategy }): ProviderProtocol {
  if (config.strategy === 'anthropic_messages') return new AnthropicMessagesProtocol();
  if (config.strategy === 'openai_compatible') return new OpenAiCompatibleProtocol();
  throw new Error(`PROTOCOL_STRATEGY_NOT_IMPLEMENTED: ${config.strategy}`);
}
