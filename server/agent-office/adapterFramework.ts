export type AgentId = 'kimi' | 'claude' | 'codex';

export interface AgentCapabilities {
  streaming: boolean;
  resume: boolean;
  tools: string[];
  max_context_tokens?: number;
}

export interface AgentHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  details?: string;
  capabilities?: AgentCapabilities;
}

export interface UsageSnapshot {
  input_tokens?: number;
  output_tokens?: number;
  cache_tokens?: number;
  cost_usd?: number;
  request_count?: number;
  period_start?: string;
  period_end?: string;
  source: 'provider' | 'local' | 'manual';
  raw?: Record<string, unknown>;
}

export interface AgentRunInput {
  contextPack: string;
  taskId: string;
  projectRoot: string;
  metadata?: Record<string, unknown>;
}

export interface AgentEvent {
  type: 'delta' | 'tool_start' | 'tool_end' | 'file_change' | 'test_start' | 'test_end' | 'warning' | 'error' | 'complete' | 'cancelled' | 'max_tool_steps';
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface AgentAdapter {
  readonly id: AgentId;
  healthCheck(): Promise<AgentHealth>;
  getCapabilities(): AgentCapabilities;
  getUsage?(): Promise<UsageSnapshot | null>;
  startRun(input: AgentRunInput): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
  resume?(sessionId: string, input: AgentRunInput): AsyncIterable<AgentEvent>;
}

export const MockAdapter: AgentAdapter = {
  id: 'kimi',
  async healthCheck() { return { status: 'healthy', capabilities: { streaming: true, resume: false, tools: [] } }; },
  getCapabilities() { return { streaming: true, resume: false, tools: [] }; },
  async getUsage() { return { source: 'local', input_tokens: 0, output_tokens: 0 }; },
  async *startRun({ taskId }) {
    yield { type: 'delta', timestamp: new Date().toISOString(), payload: { text: `Mock run started for task ${taskId}` } };
    yield { type: 'delta', timestamp: new Date().toISOString(), payload: { text: 'Working…' } };
    yield { type: 'complete', timestamp: new Date().toISOString(), payload: { success: true } };
  },
  async cancel() {},
};

export class AdapterRegistry {
  private adapters = new Map<AgentId, AgentAdapter>();
  register(adapter: AgentAdapter): void { this.adapters.set(adapter.id, adapter); }
  get(id: AgentId): AgentAdapter | undefined { return this.adapters.get(id); }
  getAll(): AgentAdapter[] { return Array.from(this.adapters.values()); }
  getMap(): Map<string, AgentAdapter> { return this.adapters; }
}

export const adapterRegistry = new AdapterRegistry();
adapterRegistry.register(MockAdapter);