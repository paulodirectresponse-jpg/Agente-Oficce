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
  tools_enabled: boolean;
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


export interface ToolDefinitionV2 {
  name: string;
  description: string;
  risk: 'read' | 'write' | 'execute' | 'external' | 'destructive';
  input_schema: Record<string, unknown>;
  default_enabled: boolean;
}

export interface AgentToolPolicy {
  agent_id: string;
  enabled: boolean;
  allowed_tools: string[];
  approval_mode: 'safe' | 'manual' | 'auto';
  max_tool_steps: number;
  updated_at: string;
}

export interface ToolAuditEvent {
  id: string;
  project_id: string;
  run_id: string | null;
  agent_id: string | null;
  tool_name: string;
  risk: string;
  status: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  started_at: string;
  ended_at: string | null;
}

export interface ToolApproval {
  id: string;
  project_id: string;
  run_id: string | null;
  agent_id: string | null;
  tool_name: string;
  input: Record<string, unknown>;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  resolved_at: string | null;
}

export interface AgentRelation {
  child_agent_id: string;
  relation_type: string;
  priority: number;
}


export interface TeamPolicy {
  allowed_tools: string[];
  permissions: string[];
  delegation_permissions: string[];
  approval_mode: 'safe' | 'manual' | 'auto';
  budget_defaults: Record<string, number>;
  metadata: Record<string, unknown>;
}

export interface TeamMember {
  team_id: string;
  agent_id: string;
  role_name: string;
  priority: number;
  enabled: boolean;
  metadata: Record<string, unknown>;
  name?: string;
  slug?: string;
  agent_enabled?: boolean;
  provider_enabled?: boolean;
  model_enabled?: boolean;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  purpose: string;
  type: 'permanent' | 'system';
  lead_agent_id: string | null;
  enabled: boolean;
  max_parallelism: number;
  max_delegation_depth: number;
  allow_external_borrowing: boolean;
  proposal_policy: 'manual' | 'approval_required' | 'disabled';
  metadata: Record<string, unknown>;
  current_version: number;
  policy: TeamPolicy;
  members: TeamMember[];
  created_at: string;
  updated_at: string;
}

export interface TeamVersion {
  id: string;
  team_id: string;
  version: number;
  snapshot: Record<string, unknown>;
  created_at: string;
}


export interface RuntimeToolHealth {
  id: string;
  label: string;
  status: 'healthy' | 'degraded' | 'unavailable' | 'unconfigured' | string;
  detail: string;
}


export interface ProviderRuntimeSnapshot {
  provider_id: string;
  operational_status: string;
  active_requests: number;
  queued_requests: number;
  rpm_used: number;
  tpm_used: number;
  rpm_limit: number;
  tpm_limit: number;
  cooldown_until: string | null;
  circuit_state: 'closed' | 'open' | 'half_open';
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface ProviderModelRuntimeState {
  provider_id: string;
  model_id: string;
  operational_status: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface ProviderRuntimeStatus {
  runtime: ProviderRuntimeSnapshot;
  models: ProviderModelRuntimeState[];
}

export interface ProviderFallback {
  id: string;
  source_provider_id: string;
  source_model: string | null;
  target_provider_id: string;
  target_model: string | null;
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
