export interface Project {
  id: string;
  name: string;
  root_path: string;
  git_enabled: boolean;
  git_branch: string | null;
}

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  risk: string | null;
  status: TaskStatus;
  assigned_agent: string | null;
  attempt_count: number;
  created_at: string;
}

export interface TaskEvent {
  run_id: string;
  event_type: string;
  payload_json: string;
  created_at: string;
}

export interface Message {
  id: string;
  role: string;
  agent_id: string | null;
  content: string;
  created_at: string;
}

export interface Conversation {
  conversation_id: string;
  messages: Message[];
}

export interface UsageEntry {
  agent_id: string;
  input_tokens: number;
  output_tokens: number;
  runs: number;
  cost_usd: number | null;
  average_duration_ms: number | null;
  window_days: number;
  has_data: boolean;
}

export interface ProviderConfig {
  base_url?: string;
  model?: string;
  api_key?: string;
  auth_scheme?: string;
  timeout_ms?: number;
  max_tool_steps?: number;
  [key: string]: unknown;
}

export type AgentId = string;


export interface UniversalProvider {
  id: string;
  name: string;
  protocol_driver: string;
  base_url: string;
  auth_driver: string;
  secret_ref: string | null;
  headers: Record<string, string>;
  query: Record<string, string>;
  auth_config: Record<string, unknown>;
  protocol_config: Record<string, unknown>;
  timeout_ms: number;
  enabled: boolean;
  health_status: string;
  last_health_at: string | null;
  last_health_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderModel {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  capabilities: Record<string, unknown>;
  context_window: number | null;
  max_output_tokens: number | null;
  pricing: Record<string, unknown>;
  metadata: Record<string, unknown>;
  enabled: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  slug: string;
  role: string;
  description: string;
  avatar_key: string;
  provider_id: string | null;
  model_id: string | null;
  system_prompt: string;
  enabled: boolean;
  sort_order: number;
  idle_after_seconds: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ChatRun {
  id: string;
  conversation_id: string;
  project_id: string;
  agent_id: string | null;
  provider_id: string | null;
  model_id: string | null;
  status: string;
  mode: 'single' | 'team' | 'review';
  parent_run_id: string | null;
  started_at: string;
  ended_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface ActivityEventV2 {
  id: string;
  project_id: string | null;
  conversation_id: string | null;
  run_id: string | null;
  agent_id: string | null;
  type: string;
  severity: 'debug' | 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AgentState {
  id: string;
  agent_id: string;
  project_id: string | null;
  run_id: string | null;
  state: string;
  activity: string;
  progress: number | null;
  updated_at: string;
}


export interface ProviderPreset {
  id: string;
  name: string;
  protocol_driver: string;
  base_url: string;
  auth_driver: string;
  auth_config?: Record<string, unknown>;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  protocol_config?: Record<string, unknown>;
}

export interface ProviderEngineCapabilities {
  protocol_drivers: string[];
  auth_drivers: string[];
  presets: ProviderPreset[];
}

export interface ProviderHealthResult {
  provider_id: string;
  status: 'healthy' | 'unavailable';
  latency_ms: number;
  models_discoverable: boolean;
  error?: string;
}

export interface DiscoveredModel {
  model_id: string;
  display_name: string;
  capabilities: Record<string, unknown>;
  context_window: number | null;
  max_output_tokens: number | null;
  metadata: Record<string, unknown>;
}


export interface ChatRunReceipt {
  run_id: string;
  conversation_id: string;
  selected_agents: string[];
  mode: 'single' | 'team';
  status: 'running';
  tools_enabled: false;
}

export interface ChatStartInput {
  project_id: string;
  conversation_id?: string;
  message: string;
  target?: 'auto' | 'team' | string;
  model_override?: string;
}

export interface ChatStreamEnvelope {
  sequence: number;
  run_id: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}


export interface ProjectRootSetting {
  path: string;
  configured: boolean;
}
