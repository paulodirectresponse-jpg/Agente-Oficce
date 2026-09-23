import type { ActivityEventV2, AgentProfile, AgentRelation, AgentState, AgentToolPolicy, ChatRun, ChatRunReceipt, ChatStartInput, Conversation, DiscoveredModel, Project, ProjectRootSetting, ProjectSummary, ProjectDetail, ProjectDecision, ProjectBlocker, ProjectResult, ProviderConfig, ProviderEngineCapabilities, ProviderHealthResult, ProviderModel, Task, TaskEvent, ToolApproval, ToolAuditEvent, ToolDefinitionV2, UniversalProvider, UsageEntry, Team, TeamMember, TeamVersion, TeamRoom, TeamRoomEntry, Workforce, Subagent, RuntimeToolHealth, ProviderRuntimeStatus, ProviderFallback, OrchestratorSettings, OrchestratorStatus, OrchestrationRun, OrchestrationEvent, AgentOverview, AgentCapabilityV3, CapabilityDefinitionV3, WorkspaceSnapshot, WorkspaceFileEntry, WorkspaceFileContent, WorkspaceGitStatus, WorkspaceGitDiff, WorkspaceRunInspection, WorkspaceCommand, PreviewSession, WorkspacePlan, AnalyticsSnapshot, AnalyticsRange, ReleasePreflightReport } from './types.js';

let apiBasePromise: Promise<string> | null = null;

async function resolveApiBase(): Promise<string> {
  if (import.meta.env.DEV) return '';

  if (!apiBasePromise) {
    apiBasePromise = import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<string>('backend_url'))
      .catch(() => '');
  }

  return apiBasePromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function fetchWithStartupRetry(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const attempts = method === 'GET' ? 8 : 1;
  const apiBase = await resolveApiBase();
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(`${apiBase}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(200 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Local Agent Office backend is unavailable.');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithStartupRetry(path, init);
  const payload = (await response.json()) as { ok: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message || `Request failed (${response.status})`);
  }
  return payload.data as T;
}

export const api = {
  health: () => request<{ service: string; storage: string }>('/api/agent-office/health'),
  listProjects: () => request<Project[]>('/api/agent-office/projects'),
  createProject: (input: { name: string; root_path?: string }) =>
    request<Project>('/api/agent-office/projects', { method: 'POST', body: JSON.stringify(input) }),
  getProjectRootSetting: () =>
    request<ProjectRootSetting>('/api/agent-office/settings/project-root'),
  saveProjectRootSetting: (path: string) =>
    request<ProjectRootSetting>('/api/agent-office/settings/project-root', {
      method: 'PUT',
      body: JSON.stringify({ path }),
    }),
  // V3 Projects
  listProjectSummariesV3: () => request<ProjectSummary[]>('/api/agent-office/v3/projects'),
  getProjectDetailV3: (projectId: string) => request<ProjectDetail>(`/api/agent-office/v3/projects/${projectId}`),
  updateProjectV3: (projectId: string, patch: Partial<Pick<Project,'name'|'objective'|'lifecycle_status'|'metadata'>>) =>
    request<ProjectSummary>(`/api/agent-office/v3/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addProjectDecisionV3: (projectId: string, input: Partial<ProjectDecision> & { decision: string }) =>
    request<ProjectDecision>(`/api/agent-office/v3/projects/${projectId}/decisions`, { method: 'POST', body: JSON.stringify(input) }),
  addProjectBlockerV3: (projectId: string, input: Partial<ProjectBlocker> & { title: string }) =>
    request<ProjectBlocker>(`/api/agent-office/v3/projects/${projectId}/blockers`, { method: 'POST', body: JSON.stringify(input) }),
  resolveProjectBlockerV3: (projectId: string, blockerId: string, resolution = '') =>
    request<ProjectBlocker>(`/api/agent-office/v3/projects/${projectId}/blockers/${blockerId}/resolve`, { method: 'POST', body: JSON.stringify({ resolution }) }),
  saveProjectResultV3: (projectId: string, input: { status?: 'draft'|'final'; summary?: string; result?: string; completed_by?: string; artifact_ids?: string[]; complete_project?: boolean; metadata?: Record<string,unknown> }) =>
    request<ProjectResult>(`/api/agent-office/v3/projects/${projectId}/result`, { method: 'PUT', body: JSON.stringify(input) }),
  getActiveProjectSelectionV3: () => request<{project_id:string|null}>('/api/agent-office/v3/projects/active-selection'),
  setActiveProjectSelectionV3: (projectId: string | null) =>
    request<{project_id:string|null}>('/api/agent-office/v3/projects/active-selection', { method: 'PUT', body: JSON.stringify({ project_id: projectId }) }),

  getConversation: (projectId: string) =>
    request<Conversation>(`/api/agent-office/projects/${projectId}/conversation`),
  listTasks: (projectId: string) => request<Task[]>(`/api/agent-office/projects/${projectId}/tasks`),
  createTask: (projectId: string, input: { title: string; description?: string; category?: string; risk?: string }) =>
    request<Task>(`/api/agent-office/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(input) }),
  runTask: (projectId: string, taskId: string, agentId?: string) =>
    request<{ task_id: string; agent_id: string; reason: string }>(
      `/api/agent-office/projects/${projectId}/tasks/${taskId}/run`,
      { method: 'POST', body: JSON.stringify(agentId ? { agent_id: agentId } : {}) },
    ),
  listTaskEvents: (projectId: string, taskId: string) =>
    request<TaskEvent[]>(`/api/agent-office/projects/${projectId}/tasks/${taskId}/events`),
  getUsage: () => request<UsageEntry[]>('/api/agent-office/usage'),
  getAnalyticsV3: (filters: { range?: AnalyticsRange; from?: string; to?: string; project_id?: string; agent_id?: string; subagent_id?: string; provider_id?: string; model_id?: string } = {}) => {
    const params = new URLSearchParams();
    for (const [key,value] of Object.entries(filters)) if (value) params.set(key, String(value));
    const query = params.toString();
    return request<AnalyticsSnapshot>(`/api/agent-office/v3/analytics${query ? `?${query}` : ''}`);
  },
  getReleasePreflightV3: (activeTools = false) => request<ReleasePreflightReport>(`/api/agent-office/v3/release/preflight${activeTools ? '?active_tools=1' : ''}`),
  getProviderConfig: (providerId: string) =>
    request<ProviderConfig>(`/api/agent-office/providers/${providerId}/config`),
  saveProviderConfig: (providerId: string, config: ProviderConfig) =>
    request<ProviderConfig>(`/api/agent-office/providers/${providerId}/config`, {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  // API-only chat runner
  startChatRun: (input: ChatStartInput) =>
    request<ChatRunReceipt>('/api/agent-office/chat/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getChatRun: (runId: string) =>
    request<ChatRun>(`/api/agent-office/chat/runs/${runId}`),
  cancelChatRun: (runId: string) =>
    request<{ run_id: string; cancel_requested: boolean; active: boolean }>(`/api/agent-office/chat/runs/${runId}/cancel`, {
      method: 'POST',
    }),
  getChatStreamUrl: async (runId: string, afterSequence = 0) => {
    const base = await resolveApiBase();
    const query = afterSequence > 0 ? `?after=${afterSequence}` : '';
    return `${base}/api/agent-office/chat/runs/${runId}/stream${query}`;
  },

  // V3 Dev Chat Workspace
  getWorkspaceSnapshotV3: (projectId: string) =>
    request<WorkspaceSnapshot>(`/api/agent-office/v3/workspace/projects/${projectId}/snapshot`),
  listWorkspaceFilesV3: (projectId: string, path = '.') =>
    request<WorkspaceFileEntry[]>(`/api/agent-office/v3/workspace/projects/${projectId}/files?path=${encodeURIComponent(path)}`),
  readWorkspaceFileV3: (projectId: string, path: string) =>
    request<WorkspaceFileContent>(`/api/agent-office/v3/workspace/projects/${projectId}/file?path=${encodeURIComponent(path)}`),
  getWorkspaceGitStatusV3: (projectId: string) =>
    request<WorkspaceGitStatus>(`/api/agent-office/v3/workspace/projects/${projectId}/git/status`),
  getWorkspaceGitDiffV3: (projectId: string, path?: string) =>
    request<WorkspaceGitDiff>(`/api/agent-office/v3/workspace/projects/${projectId}/git/diff${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  listWorkspaceRunsV3: (projectId: string) =>
    request<ChatRun[]>(`/api/agent-office/v3/workspace/projects/${projectId}/runs`),
  getWorkspaceRunV3: (runId: string) =>
    request<WorkspaceRunInspection>(`/api/agent-office/v3/workspace/runs/${runId}`),
  getWorkspacePlanV3: (planId: string) =>
    request<WorkspacePlan>(`/api/agent-office/v3/workspace/plans/${planId}`),
  sendWorkspaceCommandV3: (projectId: string, input: { command_type: 'orient'|'enqueue'|'interrupt'; message: string; target?: string; chat_run_id?: string; execution_plan_id?: string }) =>
    request<WorkspaceCommand>(`/api/agent-office/v3/workspace/projects/${projectId}/commands`, { method: 'POST', body: JSON.stringify(input) }),
  markWorkspaceCommandDispatchedV3: (commandId: string) =>
    request<{ id: string; status: string }>(`/api/agent-office/v3/workspace/commands/${commandId}/dispatched`, { method: 'POST' }),
  cancelWorkspaceCommandV3: (commandId: string) =>
    request<{ id: string; status: string }>(`/api/agent-office/v3/workspace/commands/${commandId}/cancel`, { method: 'POST' }),
  getPreviewV3: (projectId: string) =>
    request<PreviewSession | null>(`/api/agent-office/v3/workspace/projects/${projectId}/preview`),
  getPreviewLogsV3: (projectId: string) =>
    request<Pick<PreviewSession,'id'|'status'|'stdout'|'stderr'|'command'|'url'> | null>(`/api/agent-office/v3/workspace/projects/${projectId}/preview/logs`),
  startPreviewV3: (projectId: string, input: { chat_run_id?: string; command?: string } = {}) =>
    request<PreviewSession>(`/api/agent-office/v3/workspace/projects/${projectId}/preview/start`, { method: 'POST', body: JSON.stringify(input) }),
  stopPreviewV3: (projectId: string) =>
    request<PreviewSession | null>(`/api/agent-office/v3/workspace/projects/${projectId}/preview/stop`, { method: 'POST' }),
  restartPreviewV3: (projectId: string) =>
    request<PreviewSession>(`/api/agent-office/v3/workspace/projects/${projectId}/preview/restart`, { method: 'POST' }),

  // V2 dynamic data model
  providerEngineCapabilities: () =>
    request<ProviderEngineCapabilities>('/api/agent-office/v2/provider-engine/capabilities'),
  listProvidersV2: () => request<UniversalProvider[]>('/api/agent-office/v2/providers'),
  createProviderV2: (input: Partial<UniversalProvider> & { name: string; protocol_driver: string }) =>
    request<UniversalProvider>('/api/agent-office/v2/providers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  createProviderFromPresetV2: (input: { preset_id: string; id?: string; name?: string; base_url?: string; timeout_ms?: number }) =>
    request<UniversalProvider>('/api/agent-office/v2/providers/from-preset', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateProviderV2: (providerId: string, patch: Partial<UniversalProvider>) =>
    request<UniversalProvider>(`/api/agent-office/v2/providers/${providerId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteProviderV2: async (providerId: string) => {
    const response = await fetchWithStartupRetry(`/api/agent-office/v2/providers/${providerId}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new Error(`Request failed (${response.status})`);
  },
  saveProviderSecretV2: (providerId: string, secret: string) =>
    request<UniversalProvider>(`/api/agent-office/v2/providers/${providerId}/secret`, {
      method: 'POST',
      body: JSON.stringify({ secret }),
    }),
  deleteProviderSecretV2: async (providerId: string) => {
    const response = await fetchWithStartupRetry(`/api/agent-office/v2/providers/${providerId}/secret`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new Error(`Request failed (${response.status})`);
  },
  testProviderV2: (providerId: string) =>
    request<ProviderHealthResult>(`/api/agent-office/v2/providers/${providerId}/test`, { method: 'POST' }),
  discoverProviderModelsV2: (providerId: string, persist = true) =>
    request<DiscoveredModel[]>(`/api/agent-office/v2/providers/${providerId}/discover-models`, {
      method: 'POST',
      body: JSON.stringify({ persist }),
    }),
  listProviderModelsV2: (providerId: string) =>
    request<ProviderModel[]>(`/api/agent-office/v2/providers/${providerId}/models`),
  getProviderRuntimeV2: (providerId: string) =>
    request<ProviderRuntimeStatus>(`/api/agent-office/v2/providers/${providerId}/runtime`),
  listProviderFallbacksV2: (providerId: string) =>
    request<ProviderFallback[]>(`/api/agent-office/v2/providers/${providerId}/fallbacks`),
  saveProviderFallbacksV2: (providerId: string, fallbacks: Array<{ source_model?: string | null; target_provider_id: string; target_model?: string | null }>) =>
    request<ProviderFallback[]>(`/api/agent-office/v2/providers/${providerId}/fallbacks`, {
      method: 'PUT',
      body: JSON.stringify({ fallbacks }),
    }),
  createProviderModelV2: (providerId: string, input: Partial<ProviderModel> & { model_id: string }) =>
    request<ProviderModel>(`/api/agent-office/v2/providers/${providerId}/models`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateProviderModelV2: (modelId: string, patch: Partial<ProviderModel>) =>
    request<ProviderModel>(`/api/agent-office/v2/models/${modelId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteProviderModelV2: async (modelId: string) => {
    const response = await fetchWithStartupRetry(`/api/agent-office/v2/models/${modelId}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new Error(`Request failed (${response.status})`);
  },
  listAgentOverviewsV2: () => request<AgentOverview[]>('/api/agent-office/v2/agent-overviews'),
  getAgentOverviewV2: (agentId: string) => request<AgentOverview>(`/api/agent-office/v2/agents/${agentId}/overview`),
  recordAgentPerformanceV2: (agentId: string, input: { event_type: string; run_id?: string; project_id?: string; score?: number; source?: string; detail?: string }) =>
    request<AgentOverview>(`/api/agent-office/v2/agents/${agentId}/performance-events`, { method: 'POST', body: JSON.stringify(input) }),
  listCapabilitiesV3: () => request<CapabilityDefinitionV3[]>('/api/agent-office/v3/capabilities'),
  listAgentCapabilitiesV3: (agentId: string) => request<AgentCapabilityV3[]>(`/api/agent-office/v3/agents/${agentId}/capabilities`),
  inferAgentCapabilitiesV3: (agentId: string) =>
    request<AgentCapabilityV3[]>(`/api/agent-office/v3/agents/${agentId}/capabilities/infer`, { method: 'POST' }),
  saveAgentCapabilitiesV3: (agentId: string, capabilities: Array<{ capability_key: string; declared_score?: number; enabled?: boolean; source?: 'manual'|'seed'|'learned' }>) =>
    request<AgentCapabilityV3[]>(`/api/agent-office/v3/agents/${agentId}/capabilities`, { method: 'PUT', body: JSON.stringify({ capabilities }) }),
  listAgentsV2: () => request<AgentProfile[]>('/api/agent-office/v2/agents'),
  createAgentV2: (input: Partial<AgentProfile> & { name: string; slug: string }) =>
    request<AgentProfile>('/api/agent-office/v2/agents', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateAgentV2: (agentId: string, patch: Partial<AgentProfile>) =>
    request<AgentProfile>(`/api/agent-office/v2/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteAgentV2: async (agentId: string) => {
    const response = await fetchWithStartupRetry(`/api/agent-office/v2/agents/${agentId}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new Error(`Request failed (${response.status})`);
  },
  listToolDefinitionsV2: () =>
    request<ToolDefinitionV2[]>('/api/agent-office/v2/tools/definitions'),
  getRuntimeToolHealthV2: (projectRoot?: string) =>
    request<RuntimeToolHealth[]>('/api/agent-office/v2/tools/health' + (projectRoot ? `?project_root=${encodeURIComponent(projectRoot)}` : '')),
  testRuntimeToolHealthV2: (projectRoot?: string) =>
    request<RuntimeToolHealth[]>('/api/agent-office/v2/tools/health/test', {
      method: 'POST',
      body: JSON.stringify(projectRoot ? { project_root: projectRoot } : {}),
    }),
  getAgentToolPolicyV2: (agentId: string) =>
    request<AgentToolPolicy>(`/api/agent-office/v2/agents/${agentId}/tool-policy`),
  saveAgentToolPolicyV2: (agentId: string, policy: Omit<AgentToolPolicy, 'agent_id' | 'updated_at'>) =>
    request<AgentToolPolicy>(`/api/agent-office/v2/agents/${agentId}/tool-policy`, {
      method: 'PUT',
      body: JSON.stringify(policy),
    }),
  listToolAuditV2: (projectId: string) =>
    request<ToolAuditEvent[]>(`/api/agent-office/v2/projects/${projectId}/tool-audit`),
  listToolApprovalsV2: (projectId: string) =>
    request<ToolApproval[]>(`/api/agent-office/v2/projects/${projectId}/tool-approvals`),
  resolveToolApprovalV2: (approvalId: string, status: 'approved' | 'denied') =>
    request<{ id: string; status: 'approved' | 'denied' }>(`/api/agent-office/v2/tool-approvals/${approvalId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  listSubagentsV2: (agentId: string) =>
    request<AgentRelation[]>(`/api/agent-office/v2/agents/${agentId}/subagents`),
  saveSubagentsV2: (agentId: string, childAgentIds: string[]) =>
    request<AgentRelation[]>(`/api/agent-office/v2/agents/${agentId}/subagents`, {
      method: 'PUT',
      body: JSON.stringify({ child_agent_ids: childAgentIds }),
    }),
  listChatRunsV2: (projectId: string) =>
    request<ChatRun[]>(`/api/agent-office/v2/projects/${projectId}/chat-runs`),
  listActivityV2: (projectId: string) =>
    request<ActivityEventV2[]>(`/api/agent-office/v2/projects/${projectId}/activity`),
  listAgentStatesV2: (projectId: string) =>
    request<AgentState[]>(`/api/agent-office/v2/projects/${projectId}/agent-states`),

  // V3 Central Orchestrator
  getOrchestratorSettingsV3: () => request<OrchestratorSettings>('/api/agent-office/v3/orchestrator/settings'),
  saveOrchestratorSettingsV3: (input: Partial<OrchestratorSettings>) =>
    request<OrchestratorSettings>('/api/agent-office/v3/orchestrator/settings', { method: 'PUT', body: JSON.stringify(input) }),
  getOrchestratorStatusV3: () => request<OrchestratorStatus>('/api/agent-office/v3/orchestrator/status'),
  listOrchestrationRunsV3: (limit = 100) =>
    request<OrchestrationRun[]>(`/api/agent-office/v3/orchestrator/runs?limit=${limit}`),
  listOrchestrationEventsV3: (limit = 200) =>
    request<OrchestrationEvent[]>(`/api/agent-office/v3/orchestrator/events?limit=${limit}`),

  // V3.6 Teams + Subagents
  getOwnedTeamV3: (agentId: string) => request<Team | null>(`/api/agent-office/v3/agents/${agentId}/team`),
  createOwnedTeamV3: (agentId: string, input: { name: string; slug: string; purpose?: string; max_parallelism?: number; max_delegation_depth?: number; allow_external_borrowing?: boolean }) =>
    request<Team>(`/api/agent-office/v3/agents/${agentId}/team`, { method: 'POST', body: JSON.stringify(input) }),
  listOwnedSubagentsV3: (agentId: string) =>
    request<Subagent[]>(`/api/agent-office/v3/agents/${agentId}/team/subagents`),
  createOwnedSubagentV3: (agentId: string, input: Partial<Subagent> & { name: string }) =>
    request<Subagent>(`/api/agent-office/v3/agents/${agentId}/team/subagents`, { method: 'POST', body: JSON.stringify(input) }),
  listTeamSubagentsV3: (teamId: string) =>
    request<Subagent[]>(`/api/agent-office/v3/teams/${teamId}/subagents`),
  createTeamSubagentV3: (teamId: string, input: Partial<Subagent> & { name: string }) =>
    request<Subagent>(`/api/agent-office/v3/teams/${teamId}/subagents`, { method: 'POST', body: JSON.stringify(input) }),
  updateTeamSubagentV3: (teamId: string, subagentId: string, patch: Partial<Subagent>) =>
    request<Subagent>(`/api/agent-office/v3/teams/${teamId}/subagents/${subagentId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTeamSubagentV3: (teamId: string, subagentId: string) =>
    request<{ deleted: boolean }>(`/api/agent-office/v3/teams/${teamId}/subagents/${subagentId}`, { method: 'DELETE' }),
  getTeamRoomV3: (teamId: string) => request<TeamRoom>(`/api/agent-office/v3/teams/${teamId}/room`),
  updateTeamRoomV3: (teamId: string, patch: Partial<Pick<TeamRoom,'instructions'|'shared_context'|'memory'>>) =>
    request<TeamRoom>(`/api/agent-office/v3/teams/${teamId}/room`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addTeamRoomEntryV3: (teamId: string, input: { agent_id?: string | null; entry_type?: TeamRoomEntry['entry_type']; content?: string; payload?: Record<string, unknown> }) =>
    request<TeamRoomEntry>(`/api/agent-office/v3/teams/${teamId}/room/entries`, { method: 'POST', body: JSON.stringify(input) }),
  listWorkforcesV3: (limit = 100) => request<Workforce[]>(`/api/agent-office/v3/workforces?limit=${limit}`),
  getWorkforceV3: (workforceId: string) => request<Workforce>(`/api/agent-office/v3/workforces/${workforceId}`),
  listTeamsV3: () => request<Team[]>('/api/agent-office/v3/teams'),
  createTeamV3: (input: Partial<Team> & { name: string; slug: string }) =>
    request<Team>('/api/agent-office/v3/teams', { method: 'POST', body: JSON.stringify(input) }),
  updateTeamV3: (teamId: string, patch: Partial<Team>) =>
    request<Team>(`/api/agent-office/v3/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  disableTeamV3: (teamId: string) =>
    request<Team>(`/api/agent-office/v3/teams/${teamId}`, { method: 'DELETE' }),
  listTeamMembersV3: (teamId: string) =>
    request<TeamMember[]>(`/api/agent-office/v3/teams/${teamId}/members`),
  replaceTeamMembersV3: (teamId: string, members: Array<Pick<TeamMember, 'agent_id' | 'role_name' | 'priority' | 'enabled'>>) =>
    request<Team>(`/api/agent-office/v3/teams/${teamId}/members`, { method: 'PUT', body: JSON.stringify({ members }) }),
  listAgentTeamsV3: (agentId: string) =>
    request<Team[]>(`/api/agent-office/v3/agents/${agentId}/teams`),
  listTeamVersionsV3: (teamId: string) =>
    request<TeamVersion[]>(`/api/agent-office/v3/teams/${teamId}/versions`),
};
