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
