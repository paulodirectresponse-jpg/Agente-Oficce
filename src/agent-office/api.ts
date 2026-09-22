import type { ActivityEventV2, AgentProfile, AgentRelation, AgentState, AgentToolPolicy, ChatRun, ChatRunReceipt, ChatStartInput, Conversation, DiscoveredModel, Project, ProjectRootSetting, ProviderConfig, ProviderEngineCapabilities, ProviderHealthResult, ProviderModel, Task, TaskEvent, ToolApproval, ToolAuditEvent, ToolDefinitionV2, UniversalProvider, UsageEntry } from './types.js';

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
};
