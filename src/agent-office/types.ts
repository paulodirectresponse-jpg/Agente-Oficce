export interface Project {
  id: string;
  name: string;
  objective: string;
  lifecycle_status: 'active' | 'paused' | 'completed' | 'archived';
  root_path: string;
  git_enabled: boolean;
  git_branch: string | null;
  completed_at: string | null;
  archived_at: string | null;
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ProjectSummary {
  project: Project;
  operational_state: string;
  last_activity_at: string;
  counts: {
    runs: { total: number; root: number; active: number };
    plans: { total: number; completed: number; active: number; failed: number };
    steps: { total: number; completed: number; running: number; blocked: number; queued: number; failed: number };
    blockers: { total: number; open: number };
    artifacts: number;
  };
  active_run: Record<string, unknown> | null;
  active_plan: Record<string, unknown> | null;
}

export interface ProjectDecision {
  id: string;
  project_id: string;
  chat_run_id: string | null;
  execution_plan_id: string | null;
  execution_step_id: string | null;
  source_type: string;
  source_id: string | null;
  title: string;
  decision: string;
  rationale: string;
  created_at: string;
}

export interface ProjectBlocker {
  id: string;
  project_id: string;
  chat_run_id: string | null;
  execution_plan_id: string | null;
  execution_step_id: string | null;
  type: string;
  title: string;
  detail: string;
  status: 'open' | 'resolved' | 'dismissed';
  opened_at: string;
  resolved_at: string | null;
  resolution: string;
}

export interface ProjectResult {
  project_id: string;
  status: 'draft' | 'final';
  summary: string;
  result: string;
  completed_at: string | null;
  completed_by: string | null;
  metadata: Record<string, unknown>;
  artifacts: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail extends ProjectSummary {
  conversation: Record<string, unknown> | null;
  workspace: WorkspaceSnapshot;
  runs: ChatRun[];
  orchestration_runs: OrchestrationRun[];
  plans: Array<Record<string, any>>;
  workforces: Workforce[];
  participants: {
    agents: Array<Record<string, unknown>>;
    subagents: Array<Record<string, unknown>>;
    teams: Array<Record<string, unknown>>;
  };
  artifacts: Array<Record<string, any>>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_usd: number | null;
    tool_calls: number;
    execution_ms: number;
    elapsed_ms: number;
    cost_complete: boolean;
  };
  decisions: ProjectDecision[];
  blockers: ProjectBlocker[];
  result: ProjectResult | null;
  timeline: Array<Record<string, any>>;
}


export type AnalyticsRange = '24h' | '7d' | '30d' | 'all' | 'custom';

export interface AnalyticsUsageTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  requests: number;
  cost_usd: number | null;
  cost_coverage_pct: number;
  cost_known_events: number;
  cost_unknown_events: number;
  cost_reported_events: number;
  cost_estimated_events: number;
  average_duration_ms: number | null;
  usage_events: number;
  scoped_events: number;
  unscoped_events: number;
}

export interface AnalyticsWorker extends AnalyticsUsageTotals {
  worker_kind: 'agent' | 'subagent';
  id: string;
  name: string;
  role: string;
  owner_agent_id: string | null;
  team_id: string | null;
  provider_id: string | null;
  model_id: string | null;
  runs: number;
  completed_runs: number;
  failed_runs: number;
  cancelled_runs: number;
  success_rate: number | null;
  first_pass_rate: number | null;
  rework_rate: number | null;
  quality_signals: number;
  average_run_duration_ms: number | null;
}

export interface AnalyticsProject extends AnalyticsUsageTotals {
  id: string;
  name: string;
  lifecycle_status: string;
  runs: number;
  completed_runs: number;
  failed_runs: number;
  success_rate: number | null;
  plans: number;
  completed_plans: number;
  failed_plans: number;
  workforces: number;
  failed_workforces: number;
  open_blockers: number;
}

export interface AnalyticsProvider extends AnalyticsUsageTotals {
  id: string;
  name: string;
  enabled: boolean;
  health_status: string;
  operational_status: string;
  circuit_state: string | null;
  active_requests: number;
  queued_requests: number;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  models: Array<AnalyticsUsageTotals & { id:string; model_id:string; name:string; enabled:boolean }>;
}

export interface AnalyticsTool {
  name: string;
  calls: number;
  completed: number;
  failed: number;
  average_duration_ms: number | null;
  approvals: number;
  approved: number;
  denied: number;
  pending: number;
}

export interface AnalyticsSnapshot {
  generated_at: string;
  filters: {
    range: AnalyticsRange;
    from: string | null;
    to: string;
    project_id: string | null;
    agent_id: string | null;
    subagent_id: string | null;
    provider_id: string | null;
    model_id: string | null;
  };
  data_quality: {
    usage_source: string;
    run_source: string;
    anti_double_counting: boolean;
    scoped_usage_events: number;
    unscoped_usage_events: number;
    cost_coverage_pct: number;
    notes: string[];
  };
  overview: AnalyticsUsageTotals & {
    runs: number;
    completed_runs: number;
    failed_runs: number;
    cancelled_runs: number;
    success_rate: number | null;
    projects_touched: number;
    rework_events: number;
    operational_failures: number;
  };
  timeseries: Array<{
    bucket: string;
    runs: number;
    completed: number;
    failed: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_usd: number | null;
    cost_known_events: number;
    cost_events: number;
    cost_coverage_pct: number;
  }>;
  workers: AnalyticsWorker[];
  projects: AnalyticsProject[];
  execution: {
    plans:number; completed_plans:number; failed_plans:number; plan_success_rate:number|null;
    steps:number; completed_steps:number; failed_steps:number; blocked_steps:number; step_success_rate:number|null;
    attempts:number; retry_attempts:number; retry_rate:number|null; timed_out:number; budget_exceeded:number; replans:number;
    average_attempt_duration_ms:number|null; tool_calls:number; tool_failures:number; approvals:number; approvals_pending:number; approvals_denied:number;
    workforces: {
      total:number; completed:number; failed:number; cancelled:number; active:number;
      average_duration_ms:number|null; average_resources:number;
      resource_kinds:{agent:number;subagent:number;team:number};
    };
  };
  orchestrator: {
    total:number; routed:number; failed:number; success_rate:number|null;
    levels:{deterministic:number;fast:number;deep:number;fallback:number};
    fallback_events:number; fallback_runs:number; fallback_rate:number|null;
    execution_outcome:{linked:number;completed:number;failed:number;cancelled:number;running:number;success_rate:number|null};
    input_tokens:number; output_tokens:number; average_duration_ms:number|null;
  };
  providers: AnalyticsProvider[];
  tools: AnalyticsTool[];
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
  metadata?: Record<string, unknown>;
  metadata_json?: string;
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
  paused: boolean;
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
  selected_subagents?: string[];
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

export interface SubagentCapability {
  subagent_id: string;
  capability_key: string;
  declared_score: number;
  verified_score: number | null;
  confidence: number;
  evidence_count: number;
  source: 'manual' | 'seed' | 'learned';
  enabled: boolean;
  updated_at: string;
}

export interface Subagent {
  id: string;
  team_id: string;
  owner_agent_id: string;
  name: string;
  slug: string;
  role: string;
  description: string;
  avatar_key: string;
  provider_id: string | null;
  model_id: string | null;
  system_prompt: string;
  enabled: boolean;
  paused: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
  readiness: string;
  readiness_reason: string;
  capabilities: SubagentCapability[];
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  purpose: string;
  type: 'permanent' | 'system';
  owner_agent_id: string | null;
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
  subagents: Subagent[];
  legacy_members?: TeamMember[];
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


export interface OrchestratorModelRef { provider_id: string | null; model_id: string | null }
export interface OrchestratorSettings {
  enabled: boolean;
  principal: OrchestratorModelRef;
  fast: OrchestratorModelRef | null;
  deep: OrchestratorModelRef | null;
  fast_confidence_threshold: number;
  deep_confidence_threshold: number;
  deep_for_high_risk: boolean;
  updated_at: string | null;
}
export interface OrchestratorModelStatus extends OrchestratorModelRef {
  provider_name?: string;
  model_name?: string;
  enabled?: boolean;
  status?: string;
  circuit_state?: string;
  queued_requests?: number;
  fallback_count?: number;
}
export interface OrchestratorStatus {
  settings: OrchestratorSettings;
  principal: OrchestratorModelStatus | null;
  fast: OrchestratorModelStatus | null;
  deep: OrchestratorModelStatus | null;
  last_effective: { provider_name: string | null; model_id: string | null; model_name: string | null; level: string; created_at: string } | null;
  stats_24h: {
    total: number; deterministic: number; fast: number; deep: number; fallback: number;
    avg_duration_ms: number; input_tokens: number; output_tokens: number;
  };
  latest_run_at: string | null;
  healthy: boolean;
}
export interface OrchestrationRun {
  id: string; project_id: string; conversation_id: string | null; user_message_id: string | null;
  level_used: 'deterministic'|'fast'|'deep'|'fallback'; decision: Record<string, any> | null;
  status: string; provider_id: string | null; model_id: string | null; provider_name?: string | null; effective_model_id?: string | null; model_name?: string | null; input_tokens: number | null;
  output_tokens: number | null; duration_ms: number; error: Record<string, unknown> | null; created_at: string;
}
export interface OrchestrationEvent {
  id: string; orchestration_run_id: string | null; project_id: string; event_type: string;
  severity: 'debug'|'info'|'warning'|'error'; title: string; detail: string;
  payload: Record<string, unknown>; created_at: string;
}


export interface AgentCapabilityV3 {
  agent_id: string;
  capability_key: string;
  declared_score: number;
  verified_score: number | null;
  confidence: number;
  evidence_count: number;
  source: 'manual' | 'seed' | 'learned';
  enabled: boolean;
  updated_at: string;
}
export interface CapabilityDefinitionV3 {
  key: string;
  label: string;
  domain: string;
  parent_key: string | null;
  description: string;
  version: number;
  status: 'active' | 'deprecated';
  metadata: Record<string, unknown>;
}
export type AgentReadiness = 'inactive'|'paused'|'incomplete'|'ready'|'busy'|'queued'|'provider_degraded'|'provider_unavailable'|'model_unavailable'|'error';
export interface AgentPerformanceSummary {
  assertiveness: number | null;
  first_pass_rate: number | null;
  rework_rate: number | null;
  quality_signals: number;
  execution_successes: number;
  operational_failures: number;
  cancellations: number;
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  success_rate: number | null;
  average_duration_ms: number | null;
  cost_usd: number | null;
  input_tokens: number;
  output_tokens: number;
}
export interface AgentOverview {
  agent_id: string;
  administrative_state: 'active'|'inactive'|'paused';
  readiness: AgentReadiness;
  readiness_reason: string;
  current_state: string;
  current_activity: string;
  provider_status: string | null;
  model_status: string | null;
  provider_name: string | null;
  model_name: string | null;
  last_effective_model: string | null;
  latest_run_id: string | null;
  capabilities: AgentCapabilityV3[];
  performance: AgentPerformanceSummary;
  recent_activity: Array<{type:string;severity:string;title:string;detail:string;payload:Record<string,unknown>;created_at:string}>;
}


export interface TeamRoomEntry {
  id: string;
  team_id: string;
  agent_id: string | null;
  subagent_id?: string | null;
  entry_type: 'activity'|'decision'|'memory'|'note'|'delegation'|'result';
  content: string;
  payload: Record<string, unknown>;
  created_at: string;
}
export interface TeamRoom {
  team_id: string;
  instructions: string;
  shared_context: Record<string, unknown>;
  memory: Record<string, unknown>;
  updated_at: string;
  entries: TeamRoomEntry[];
}
export interface WorkforceMember {
  dynamic_team_id: string;
  agent_id: string;
  role_name: string;
  priority: number;
  enabled: boolean;
  metadata: Record<string, unknown>;
}
export interface WorkforceSubagentMember {
  dynamic_team_id: string;
  subagent_id: string;
  role_name: string;
  priority: number;
  enabled: boolean;
  metadata: Record<string, unknown>;
}
export interface WorkforceTeamMember {
  dynamic_team_id: string;
  team_id: string;
  team_version_id: string | null;
  snapshot: Record<string, any>;
  reason: string;
  priority: number;
  enabled: boolean;
  created_at: string;
}
export interface WorkforceResource {
  dynamic_team_id: string;
  worker_kind: 'agent'|'subagent'|'team';
  worker_id: string;
  reason: string;
  capability_keys: string[];
  source_team_id: string | null;
  source_owner_id: string | null;
  score: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
export interface Workforce {
  id: string;
  orchestration_run_id: string | null;
  execution_plan_id: string | null;
  chat_run_id: string | null;
  purpose: string;
  lead_agent_id: string | null;
  max_parallelism: number;
  max_delegation_depth: number;
  allow_external_borrowing: boolean;
  policy: TeamPolicy;
  status: 'active'|'completed'|'cancelled';
  lifecycle_status: 'forming'|'active'|'completed'|'failed'|'cancelled';
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  members: WorkforceMember[];
  subagents: WorkforceSubagentMember[];
  teams: WorkforceTeamMember[];
  resources: WorkforceResource[];
  created_at: string;
  updated_at: string;
}


export interface WorkspaceFileEntry {
  name: string;
  path: string;
  kind: 'directory'|'file';
  size: number | null;
  modified_at: string;
}
export interface WorkspaceFileContent {
  path: string;
  content: string;
  size: number;
  modified_at: string;
}
export interface WorkspaceGitStatus {
  enabled: boolean;
  branch: string | null;
  head: string | null;
  files: Array<{ status: string; path: string }>;
}
export interface WorkspaceGitDiff {
  diff: string;
  additions: number;
  deletions: number;
}
export interface PreviewSession {
  id: string;
  project_id: string;
  chat_run_id: string | null;
  command: string;
  port: number | null;
  url: string | null;
  status: 'starting'|'healthy'|'failed'|'stopped';
  stdout: string;
  stderr: string;
  started_at: string;
  updated_at: string;
  stopped_at: string | null;
  running?: boolean;
}
export interface WorkspaceCommand {
  id: string;
  project_id: string;
  chat_run_id: string | null;
  execution_plan_id: string | null;
  command_type: 'orient'|'enqueue'|'interrupt';
  message: string;
  target: string;
  status: 'pending'|'applied'|'dispatched'|'cancelled';
  created_at: string;
  applied_at: string | null;
}
export interface WorkspacePlan {
  id: string;
  project_id: string;
  status: string;
  goal: string;
  version: number;
  budget: Record<string, unknown>;
  steps: Array<{
    id: string;
    key: string;
    title: string;
    goal: string;
    status: string;
    resume_state: string;
    assigned_agent_id: string | null;
    assigned_team_id?: string | null;
    assigned_dynamic_team_id?: string | null;
    required_capabilities: Array<Record<string, unknown>>;
    required_tools: string[];
  }>;
  dependencies: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  replans: Array<Record<string, unknown>>;
}
export interface WorkspaceSnapshot {
  project: Project;
  active_run: ChatRun | null;
  latest_run: ChatRun | null;
  active_plan: WorkspacePlan | null;
  workforce: Workforce | null;
  pending_approvals: ToolApproval[];
  pending_commands: WorkspaceCommand[];
  preview: PreviewSession | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  git: WorkspaceGitStatus;
}
export interface WorkspaceRunInspection {
  run: ChatRun;
  tools: ToolAuditEvent[];
  activities: ActivityEventV2[];
  files_changed: string[];
  workforce: Workforce | null;
  plan: WorkspacePlan | null;
  artifacts: Array<{ id:string;plan_id:string;step_id:string|null;type:string;uri:string|null;payload:Record<string,unknown>;created_at:string }>;
  baseline: Record<string, unknown> | null;
}
