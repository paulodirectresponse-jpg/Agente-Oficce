import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';

export type HealthStatus = 'unknown' | 'healthy' | 'degraded' | 'unavailable';
export type ActivitySeverity = 'debug' | 'info' | 'warning' | 'error';
export type ChatRunMode = 'single' | 'team' | 'review';

export interface Provider {
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

export interface Agent {
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
  mode: ChatRunMode;
  parent_run_id: string | null;
  started_at: string;
  ended_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface ActivityEvent {
  id: string;
  project_id: string | null;
  conversation_id: string | null;
  run_id: string | null;
  agent_id: string | null;
  type: string;
  severity: ActivitySeverity;
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

function now(): string {
  return new Date().toISOString();
}

function id(): string {
  return crypto.randomUUID();
}

function parseJson<T extends Record<string, unknown> | Record<string, string>>(
  value: string | null | undefined,
  fallback: T,
): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

function normalizeProvider(row: any): Provider {
  return {
    id: row.id,
    name: row.name,
    protocol_driver: row.protocol_driver,
    base_url: row.base_url,
    auth_driver: row.auth_driver,
    secret_ref: row.secret_ref ?? null,
    headers: parseJson(row.headers_json, {}),
    query: parseJson(row.query_json, {}),
    auth_config: parseJson(row.auth_config_json, {}),
    protocol_config: parseJson(row.protocol_config_json, {}),
    timeout_ms: Number(row.timeout_ms ?? 60000),
    enabled: Boolean(row.enabled),
    health_status: row.health_status,
    last_health_at: row.last_health_at ?? null,
    last_health_error: row.last_health_error ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeModel(row: any): ProviderModel {
  return {
    id: row.id,
    provider_id: row.provider_id,
    model_id: row.model_id,
    display_name: row.display_name,
    capabilities: parseJson(row.capabilities_json, {}),
    context_window: row.context_window == null ? null : Number(row.context_window),
    max_output_tokens: row.max_output_tokens == null ? null : Number(row.max_output_tokens),
    pricing: parseJson(row.pricing_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    enabled: Boolean(row.enabled),
    is_default: Boolean(row.is_default),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeAgent(row: any): Agent {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: row.role,
    description: row.description,
    avatar_key: row.avatar_key,
    provider_id: row.provider_id ?? null,
    model_id: row.model_id ?? null,
    system_prompt: row.system_prompt,
    enabled: Boolean(row.enabled),
    sort_order: Number(row.sort_order),
    idle_after_seconds: Number(row.idle_after_seconds),
    metadata: parseJson(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeRun(row: any): ChatRun {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    project_id: row.project_id,
    agent_id: row.agent_id ?? null,
    provider_id: row.provider_id ?? null,
    model_id: row.model_id ?? null,
    status: row.status,
    mode: row.mode,
    parent_run_id: row.parent_run_id ?? null,
    started_at: row.started_at,
    ended_at: row.ended_at ?? null,
    input_tokens: row.input_tokens == null ? null : Number(row.input_tokens),
    output_tokens: row.output_tokens == null ? null : Number(row.output_tokens),
    error: row.error_json ? parseJson(row.error_json, {}) : null,
    metadata: parseJson(row.metadata_json, {}),
  };
}

function normalizeActivity(row: any): ActivityEvent {
  return {
    id: row.id,
    project_id: row.project_id ?? null,
    conversation_id: row.conversation_id ?? null,
    run_id: row.run_id ?? null,
    agent_id: row.agent_id ?? null,
    type: row.type,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    payload: parseJson(row.payload_json, {}),
    created_at: row.created_at,
  };
}

function normalizeState(row: any): AgentState {
  return {
    id: row.id,
    agent_id: row.agent_id,
    project_id: row.project_id ?? null,
    run_id: row.run_id ?? null,
    state: row.state,
    activity: row.activity,
    progress: row.progress == null ? null : Number(row.progress),
    updated_at: row.updated_at,
  };
}

export class ProviderRepositoryV2 {
  constructor(private readonly database: Database) {}

  create(input: {
    id?: string;
    name: string;
    protocol_driver: string;
    base_url?: string;
    auth_driver?: string;
    secret_ref?: string | null;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    auth_config?: Record<string, unknown>;
    protocol_config?: Record<string, unknown>;
    timeout_ms?: number;
    enabled?: boolean;
    health_status?: HealthStatus;
  }): Provider {
    const timestamp = now();
    const providerId = input.id?.trim() || id();
    this.database.prepare(`
      INSERT INTO providers (
        id, name, protocol_driver, base_url, auth_driver, secret_ref,
        headers_json, query_json, auth_config_json, protocol_config_json, timeout_ms,
        enabled, health_status, last_health_at, last_health_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      providerId,
      input.name.trim(),
      input.protocol_driver.trim(),
      input.base_url?.trim() ?? '',
      input.auth_driver?.trim() || 'bearer',
      input.secret_ref ?? null,
      JSON.stringify(input.headers ?? {}),
      JSON.stringify(input.query ?? {}),
      JSON.stringify(input.auth_config ?? {}),
      JSON.stringify(input.protocol_config ?? {}),
      input.timeout_ms && input.timeout_ms > 0 ? input.timeout_ms : 60000,
      input.enabled === false ? 0 : 1,
      input.health_status ?? 'unknown',
      null,
      null,
      timestamp,
      timestamp,
    );
    return this.get(providerId)!;
  }

  get(providerId: string): Provider | null {
    const row = this.database.prepare('SELECT * FROM providers WHERE id = ?').get(providerId);
    return row ? normalizeProvider(row) : null;
  }

  list(): Provider[] {
    return this.database.prepare('SELECT * FROM providers ORDER BY name COLLATE NOCASE, created_at').all().map(normalizeProvider);
  }

  update(providerId: string, patch: Partial<Omit<Provider, 'id' | 'created_at' | 'updated_at'>>): Provider {
    const current = this.get(providerId);
    if (!current) throw new Error('PROVIDER_NOT_FOUND');
    const updatedAt = now();
    const next = {
      ...current,
      ...patch,
      headers: patch.headers ?? current.headers,
      query: patch.query ?? current.query,
      auth_config: patch.auth_config ?? current.auth_config,
      protocol_config: patch.protocol_config ?? current.protocol_config,
      updated_at: updatedAt,
    };
    this.database.prepare(`
      UPDATE providers SET
        name = ?, protocol_driver = ?, base_url = ?, auth_driver = ?, secret_ref = ?,
        headers_json = ?, query_json = ?, auth_config_json = ?, protocol_config_json = ?,
        timeout_ms = ?, enabled = ?, health_status = ?, last_health_at = ?,
        last_health_error = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.name,
      next.protocol_driver,
      next.base_url,
      next.auth_driver,
      next.secret_ref,
      JSON.stringify(next.headers),
      JSON.stringify(next.query),
      JSON.stringify(next.auth_config),
      JSON.stringify(next.protocol_config),
      next.timeout_ms,
      next.enabled ? 1 : 0,
      next.health_status,
      next.last_health_at,
      next.last_health_error,
      updatedAt,
      providerId,
    );
    return this.get(providerId)!;
  }

  delete(providerId: string): boolean {
    return this.database.prepare('DELETE FROM providers WHERE id = ?').run(providerId).changes > 0;
  }

  createModel(providerId: string, input: {
    id?: string;
    model_id: string;
    display_name?: string;
    capabilities?: Record<string, unknown>;
    context_window?: number | null;
    max_output_tokens?: number | null;
    pricing?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    enabled?: boolean;
    is_default?: boolean;
  }): ProviderModel {
    if (!this.get(providerId)) throw new Error('PROVIDER_NOT_FOUND');
    const timestamp = now();
    const modelPk = input.id?.trim() || id();
    const makeDefault = input.is_default === true;

    const transaction = this.database.transaction(() => {
      if (makeDefault) {
        this.database.prepare('UPDATE provider_models SET is_default = 0, updated_at = ? WHERE provider_id = ?').run(timestamp, providerId);
      }
      this.database.prepare(`
        INSERT INTO provider_models (
          id, provider_id, model_id, display_name, capabilities_json, context_window,
          max_output_tokens, pricing_json, metadata_json, enabled, is_default, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        modelPk,
        providerId,
        input.model_id.trim(),
        input.display_name?.trim() || input.model_id.trim(),
        JSON.stringify(input.capabilities ?? {}),
        input.context_window ?? null,
        input.max_output_tokens ?? null,
        JSON.stringify(input.pricing ?? {}),
        JSON.stringify(input.metadata ?? {}),
        input.enabled === false ? 0 : 1,
        makeDefault ? 1 : 0,
        timestamp,
        timestamp,
      );
    });
    transaction();
    return this.getModel(modelPk)!;
  }

  getModel(modelPk: string): ProviderModel | null {
    const row = this.database.prepare('SELECT * FROM provider_models WHERE id = ?').get(modelPk);
    return row ? normalizeModel(row) : null;
  }

  listModels(providerId: string, includeDisabled = true): ProviderModel[] {
    const sql = includeDisabled
      ? 'SELECT * FROM provider_models WHERE provider_id = ? ORDER BY is_default DESC, display_name COLLATE NOCASE'
      : 'SELECT * FROM provider_models WHERE provider_id = ? AND enabled = 1 ORDER BY is_default DESC, display_name COLLATE NOCASE';
    return this.database.prepare(sql).all(providerId).map(normalizeModel);
  }

  updateModel(modelPk: string, patch: Partial<Omit<ProviderModel, 'id' | 'provider_id' | 'created_at' | 'updated_at'>>): ProviderModel {
    const current = this.getModel(modelPk);
    if (!current) throw new Error('PROVIDER_MODEL_NOT_FOUND');
    const updatedAt = now();
    const next = {
      ...current,
      ...patch,
      capabilities: patch.capabilities ?? current.capabilities,
      pricing: patch.pricing ?? current.pricing,
      metadata: patch.metadata ?? current.metadata,
    };
    const transaction = this.database.transaction(() => {
      if (patch.is_default === true) {
        this.database.prepare('UPDATE provider_models SET is_default = 0, updated_at = ? WHERE provider_id = ? AND id <> ?').run(updatedAt, current.provider_id, modelPk);
      }
      this.database.prepare(`
        UPDATE provider_models SET
          model_id = ?, display_name = ?, capabilities_json = ?, context_window = ?,
          max_output_tokens = ?, pricing_json = ?, metadata_json = ?, enabled = ?,
          is_default = ?, updated_at = ?
        WHERE id = ?
      `).run(
        next.model_id,
        next.display_name,
        JSON.stringify(next.capabilities),
        next.context_window,
        next.max_output_tokens,
        JSON.stringify(next.pricing),
        JSON.stringify(next.metadata),
        next.enabled ? 1 : 0,
        next.is_default ? 1 : 0,
        updatedAt,
        modelPk,
      );
    });
    transaction();
    return this.getModel(modelPk)!;
  }

  deleteModel(modelPk: string): boolean {
    return this.database.prepare('DELETE FROM provider_models WHERE id = ?').run(modelPk).changes > 0;
  }
}

export class AgentRepositoryV2 {
  constructor(private readonly database: Database) {}

  private validateBinding(providerId: string | null | undefined, modelId: string | null | undefined): void {
    if (!modelId) return;
    if (!providerId) throw new Error('AGENT_MODEL_REQUIRES_PROVIDER');
    const row = this.database.prepare('SELECT provider_id FROM provider_models WHERE id = ?').get(modelId) as { provider_id: string } | undefined;
    if (!row) throw new Error('PROVIDER_MODEL_NOT_FOUND');
    if (row.provider_id !== providerId) throw new Error('AGENT_MODEL_PROVIDER_MISMATCH');
  }

  create(input: {
    id?: string;
    name: string;
    slug: string;
    role?: string;
    description?: string;
    avatar_key?: string;
    provider_id?: string | null;
    model_id?: string | null;
    system_prompt?: string;
    enabled?: boolean;
    sort_order?: number;
    idle_after_seconds?: number;
    metadata?: Record<string, unknown>;
  }): Agent {
    this.validateBinding(input.provider_id, input.model_id);
    const timestamp = now();
    const agentId = input.id?.trim() || id();
    this.database.prepare(`
      INSERT INTO agents (
        id, name, slug, role, description, avatar_key, provider_id, model_id,
        system_prompt, enabled, sort_order, idle_after_seconds, metadata_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agentId,
      input.name.trim(),
      input.slug.trim(),
      input.role?.trim() ?? '',
      input.description?.trim() ?? '',
      input.avatar_key?.trim() || 'default',
      input.provider_id ?? null,
      input.model_id ?? null,
      input.system_prompt ?? '',
      input.enabled === false ? 0 : 1,
      input.sort_order ?? 0,
      input.idle_after_seconds ?? 300,
      JSON.stringify(input.metadata ?? {}),
      timestamp,
      timestamp,
    );
    return this.get(agentId)!;
  }

  get(agentId: string): Agent | null {
    const row = this.database.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    return row ? normalizeAgent(row) : null;
  }

  getBySlug(slug: string): Agent | null {
    const row = this.database.prepare('SELECT * FROM agents WHERE slug = ?').get(slug);
    return row ? normalizeAgent(row) : null;
  }

  list(includeDisabled = true): Agent[] {
    const sql = includeDisabled
      ? 'SELECT * FROM agents ORDER BY sort_order, name COLLATE NOCASE'
      : 'SELECT * FROM agents WHERE enabled = 1 ORDER BY sort_order, name COLLATE NOCASE';
    return this.database.prepare(sql).all().map(normalizeAgent);
  }

  update(agentId: string, patch: Partial<Omit<Agent, 'id' | 'created_at' | 'updated_at'>>): Agent {
    const current = this.get(agentId);
    if (!current) throw new Error('AGENT_NOT_FOUND');
    const next = {
      ...current,
      ...patch,
      metadata: patch.metadata ?? current.metadata,
    };
    this.validateBinding(next.provider_id, next.model_id);
    const updatedAt = now();
    this.database.prepare(`
      UPDATE agents SET
        name = ?, slug = ?, role = ?, description = ?, avatar_key = ?,
        provider_id = ?, model_id = ?, system_prompt = ?, enabled = ?,
        sort_order = ?, idle_after_seconds = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.name,
      next.slug,
      next.role,
      next.description,
      next.avatar_key,
      next.provider_id,
      next.model_id,
      next.system_prompt,
      next.enabled ? 1 : 0,
      next.sort_order,
      next.idle_after_seconds,
      JSON.stringify(next.metadata),
      updatedAt,
      agentId,
    );
    return this.get(agentId)!;
  }

  delete(agentId: string): boolean {
    return this.database.prepare('DELETE FROM agents WHERE id = ?').run(agentId).changes > 0;
  }
}

export class ChatRunRepository {
  constructor(private readonly database: Database) {}

  create(input: {
    conversation_id: string;
    project_id: string;
    agent_id?: string | null;
    provider_id?: string | null;
    model_id?: string | null;
    status?: string;
    mode?: ChatRunMode;
    parent_run_id?: string | null;
    metadata?: Record<string, unknown>;
  }): ChatRun {
    const runId = id();
    const startedAt = now();
    this.database.prepare(`
      INSERT INTO chat_runs (
        id, conversation_id, project_id, agent_id, provider_id, model_id,
        status, mode, parent_run_id, started_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      input.conversation_id,
      input.project_id,
      input.agent_id ?? null,
      input.provider_id ?? null,
      input.model_id ?? null,
      input.status ?? 'created',
      input.mode ?? 'single',
      input.parent_run_id ?? null,
      startedAt,
      JSON.stringify(input.metadata ?? {}),
    );
    return this.get(runId)!;
  }

  get(runId: string): ChatRun | null {
    const row = this.database.prepare('SELECT * FROM chat_runs WHERE id = ?').get(runId);
    return row ? normalizeRun(row) : null;
  }

  listForProject(projectId: string, limit = 100): ChatRun[] {
    return this.database.prepare('SELECT * FROM chat_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?').all(projectId, limit).map(normalizeRun);
  }

  update(runId: string, patch: {
    status?: string;
    ended_at?: string | null;
    input_tokens?: number | null;
    output_tokens?: number | null;
    error?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  }): ChatRun {
    const current = this.get(runId);
    if (!current) throw new Error('CHAT_RUN_NOT_FOUND');
    const next = {
      ...current,
      ...patch,
      error: patch.error === undefined ? current.error : patch.error,
      metadata: patch.metadata ?? current.metadata,
    };
    this.database.prepare(`
      UPDATE chat_runs SET
        status = ?, ended_at = ?, input_tokens = ?, output_tokens = ?,
        error_json = ?, metadata_json = ?
      WHERE id = ?
    `).run(
      next.status,
      next.ended_at,
      next.input_tokens,
      next.output_tokens,
      next.error ? JSON.stringify(next.error) : null,
      JSON.stringify(next.metadata),
      runId,
    );
    return this.get(runId)!;
  }

  delete(runId: string): boolean {
    return this.database.prepare('DELETE FROM chat_runs WHERE id = ?').run(runId).changes > 0;
  }
}

export class ActivityRepository {
  constructor(private readonly database: Database) {}

  append(input: {
    project_id?: string | null;
    conversation_id?: string | null;
    run_id?: string | null;
    agent_id?: string | null;
    type: string;
    severity?: ActivitySeverity;
    title: string;
    detail?: string;
    payload?: Record<string, unknown>;
  }): ActivityEvent {
    const eventId = id();
    const createdAt = now();
    this.database.prepare(`
      INSERT INTO activity_events (
        id, project_id, conversation_id, run_id, agent_id, type, severity,
        title, detail, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      input.project_id ?? null,
      input.conversation_id ?? null,
      input.run_id ?? null,
      input.agent_id ?? null,
      input.type,
      input.severity ?? 'info',
      input.title,
      input.detail ?? '',
      JSON.stringify(input.payload ?? {}),
      createdAt,
    );
    return this.get(eventId)!;
  }

  get(eventId: string): ActivityEvent | null {
    const row = this.database.prepare('SELECT * FROM activity_events WHERE id = ?').get(eventId);
    return row ? normalizeActivity(row) : null;
  }

  listForProject(projectId: string, limit = 250): ActivityEvent[] {
    return this.database.prepare('SELECT * FROM activity_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(projectId, limit).map(normalizeActivity);
  }

  listForRun(runId: string, limit = 500): ActivityEvent[] {
    return this.database.prepare('SELECT * FROM activity_events WHERE run_id = ? ORDER BY created_at ASC LIMIT ?').all(runId, limit).map(normalizeActivity);
  }
}

export class AgentStateRepository {
  constructor(private readonly database: Database) {}

  upsert(input: {
    agent_id: string;
    project_id?: string | null;
    run_id?: string | null;
    state: string;
    activity?: string;
    progress?: number | null;
  }): AgentState {
    const projectId = input.project_id ?? null;
    const existing = this.database.prepare(
      'SELECT id FROM agent_states WHERE agent_id = ? AND project_id IS ? ORDER BY updated_at DESC LIMIT 1',
    ).get(input.agent_id, projectId) as { id: string } | undefined;
    const updatedAt = now();
    const progress = input.progress == null ? null : Math.max(0, Math.min(1, input.progress));

    if (existing) {
      this.database.prepare(`
        UPDATE agent_states
        SET run_id = ?, state = ?, activity = ?, progress = ?, updated_at = ?
        WHERE id = ?
      `).run(input.run_id ?? null, input.state, input.activity ?? '', progress, updatedAt, existing.id);
      return this.get(existing.id)!;
    }

    const stateId = id();
    this.database.prepare(`
      INSERT INTO agent_states (id, agent_id, project_id, run_id, state, activity, progress, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(stateId, input.agent_id, projectId, input.run_id ?? null, input.state, input.activity ?? '', progress, updatedAt);
    return this.get(stateId)!;
  }

  get(stateId: string): AgentState | null {
    const row = this.database.prepare('SELECT * FROM agent_states WHERE id = ?').get(stateId);
    return row ? normalizeState(row) : null;
  }

  listForProject(projectId: string | null): AgentState[] {
    return this.database.prepare(
      'SELECT * FROM agent_states WHERE project_id IS ? ORDER BY updated_at DESC',
    ).all(projectId).map(normalizeState);
  }

  clearRun(runId: string): void {
    this.database.prepare(
      "UPDATE agent_states SET run_id = NULL, state = 'idle', activity = '', progress = NULL, updated_at = ? WHERE run_id = ?",
    ).run(now(), runId);
  }
}
