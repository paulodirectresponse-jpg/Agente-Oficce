import { Router } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { ConversationRepository } from '../agent-office/conversationRepository.js';
import {
  ActivityRepository,
  AgentRepositoryV2,
  AgentStateRepository,
  ChatRunRepository,
  ProviderRepositoryV2,
  type Provider,
} from '../agent-office/v2DataModel.js';

export const v2DataRouter = Router();

function codeOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function statusFor(code: string): number {
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('MISMATCH') || code.includes('REQUIRES')) return 400;
  if (code.includes('CONSTRAINT') || code.includes('UNIQUE')) return 409;
  return 500;
}

function safeProvider(provider: Provider): Provider {
  return { ...provider, secret_ref: provider.secret_ref ? '***' : null };
}

// Providers
v2DataRouter.get('/providers', (_request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    response.json({ ok: true, data: new ProviderRepositoryV2(database.connection).list().map(safeProvider) });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.post('/providers', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const body = request.body ?? {};
    const created = new ProviderRepositoryV2(database.connection).create({
      id: typeof body.id === 'string' ? body.id : undefined,
      name: String(body.name || '').trim(),
      protocol_driver: String(body.protocol_driver || '').trim(),
      base_url: typeof body.base_url === 'string' ? body.base_url : '',
      auth_driver: typeof body.auth_driver === 'string' ? body.auth_driver : 'bearer',
      secret_ref: typeof body.secret_ref === 'string' ? body.secret_ref : null,
      headers: body.headers && typeof body.headers === 'object' ? body.headers : {},
      query: body.query && typeof body.query === 'object' ? body.query : {},
      enabled: body.enabled !== false,
      health_status: body.health_status,
    });
    response.status(201).json({ ok: true, data: safeProvider(created) });
  } catch (error) {
    const code = codeOf(error, 'PROVIDER_CREATE_FAILED');
    response.status(statusFor(code)).json({ ok: false, error: { code, message: code } });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.get('/providers/:providerId', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const provider = new ProviderRepositoryV2(database.connection).get(request.params.providerId);
    if (!provider) {
      response.status(404).json({ ok: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found.' } });
      return;
    }
    response.json({ ok: true, data: safeProvider(provider) });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.patch('/providers/:providerId', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const body = request.body ?? {};
    const patch: Record<string, unknown> = {};
    for (const key of ['name', 'protocol_driver', 'base_url', 'auth_driver', 'secret_ref', 'headers', 'query', 'enabled', 'health_status']) {
      if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
    }
    const updated = new ProviderRepositoryV2(database.connection).update(request.params.providerId, patch);
    response.json({ ok: true, data: safeProvider(updated) });
  } catch (error) {
    const code = codeOf(error, 'PROVIDER_UPDATE_FAILED');
    response.status(statusFor(code)).json({ ok: false, error: { code, message: code } });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.delete('/providers/:providerId', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const deleted = new ProviderRepositoryV2(database.connection).delete(request.params.providerId);
    if (!deleted) {
      response.status(404).json({ ok: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found.' } });
      return;
    }
    response.status(204).end();
  } finally {
    database.connection.close();
  }
});

// Provider models
v2DataRouter.get('/providers/:providerId/models', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const includeDisabled = request.query.enabled !== 'true';
    const data = new ProviderRepositoryV2(database.connection).listModels(request.params.providerId, includeDisabled);
    response.json({ ok: true, data });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.post('/providers/:providerId/models', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const body = request.body ?? {};
    const created = new ProviderRepositoryV2(database.connection).createModel(request.params.providerId, {
      id: typeof body.id === 'string' ? body.id : undefined,
      model_id: String(body.model_id || ''),
      display_name: typeof body.display_name === 'string' ? body.display_name : undefined,
      capabilities: body.capabilities && typeof body.capabilities === 'object' ? body.capabilities : {},
      context_window: body.context_window == null ? null : Number(body.context_window),
      max_output_tokens: body.max_output_tokens == null ? null : Number(body.max_output_tokens),
      pricing: body.pricing && typeof body.pricing === 'object' ? body.pricing : {},
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      enabled: body.enabled !== false,
      is_default: body.is_default === true,
    });
    response.status(201).json({ ok: true, data: created });
  } catch (error) {
    const code = codeOf(error, 'PROVIDER_MODEL_CREATE_FAILED');
    response.status(statusFor(code)).json({ ok: false, error: { code, message: code } });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.patch('/models/:modelId', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const body = request.body ?? {};
    const patch: Record<string, unknown> = {};
    for (const key of ['model_id', 'display_name', 'capabilities', 'context_window', 'max_output_tokens', 'pricing', 'metadata', 'enabled', 'is_default']) {
      if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
    }
    const updated = new ProviderRepositoryV2(database.connection).updateModel(request.params.modelId, patch);
    response.json({ ok: true, data: updated });
  } catch (error) {
    const code = codeOf(error, 'PROVIDER_MODEL_UPDATE_FAILED');
    response.status(statusFor(code)).json({ ok: false, error: { code, message: code } });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.delete('/models/:modelId', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    if (!new ProviderRepositoryV2(database.connection).deleteModel(request.params.modelId)) {
      response.status(404).json({ ok: false, error: { code: 'PROVIDER_MODEL_NOT_FOUND', message: 'Provider model not found.' } });
      return;
    }
    response.status(204).end();
  } finally {
    database.connection.close();
  }
});

// Agents
v2DataRouter.get('/agents', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    response.json({
      ok: true,
      data: new AgentRepositoryV2(database.connection).list(request.query.enabled !== 'true'),
    });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.post('/agents', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const body = request.body ?? {};
    const created = new AgentRepositoryV2(database.connection).create({
      id: typeof body.id === 'string' ? body.id : undefined,
      name: String(body.name || ''),
      slug: String(body.slug || ''),
      role: typeof body.role === 'string' ? body.role : '',
      description: typeof body.description === 'string' ? body.description : '',
      avatar_key: typeof body.avatar_key === 'string' ? body.avatar_key : 'default',
      provider_id: typeof body.provider_id === 'string' ? body.provider_id : null,
      model_id: typeof body.model_id === 'string' ? body.model_id : null,
      system_prompt: typeof body.system_prompt === 'string' ? body.system_prompt : '',
      enabled: body.enabled !== false,
      sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
      idle_after_seconds: Number.isFinite(Number(body.idle_after_seconds)) ? Number(body.idle_after_seconds) : 300,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    });
    response.status(201).json({ ok: true, data: created });
  } catch (error) {
    const code = codeOf(error, 'AGENT_CREATE_FAILED');
    response.status(statusFor(code)).json({ ok: false, error: { code, message: code } });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.get('/agents/:agentId', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const agent = new AgentRepositoryV2(database.connection).get(request.params.agentId);
    if (!agent) {
      response.status(404).json({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found.' } });
      return;
    }
    response.json({ ok: true, data: agent });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.patch('/agents/:agentId', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const body = request.body ?? {};
    const patch: Record<string, unknown> = {};
    for (const key of ['name', 'slug', 'role', 'description', 'avatar_key', 'provider_id', 'model_id', 'system_prompt', 'enabled', 'sort_order', 'idle_after_seconds', 'metadata']) {
      if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
    }
    const updated = new AgentRepositoryV2(database.connection).update(request.params.agentId, patch);
    response.json({ ok: true, data: updated });
  } catch (error) {
    const code = codeOf(error, 'AGENT_UPDATE_FAILED');
    response.status(statusFor(code)).json({ ok: false, error: { code, message: code } });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.delete('/agents/:agentId', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    if (!new AgentRepositoryV2(database.connection).delete(request.params.agentId)) {
      response.status(404).json({ ok: false, error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found.' } });
      return;
    }
    response.status(204).end();
  } finally {
    database.connection.close();
  }
});

// Chat runs and live activity data. Execution/streaming is implemented in Phase D.
v2DataRouter.get('/projects/:projectId/chat-runs', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    response.json({ ok: true, data: new ChatRunRepository(database.connection).listForProject(request.params.projectId) });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.post('/projects/:projectId/chat-runs', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const conversations = new ConversationRepository(database.connection);
    const conversationId = typeof request.body?.conversation_id === 'string'
      ? request.body.conversation_id
      : conversations.ensureForProject(request.params.projectId);
    const created = new ChatRunRepository(database.connection).create({
      conversation_id: conversationId,
      project_id: request.params.projectId,
      agent_id: request.body?.agent_id ?? null,
      provider_id: request.body?.provider_id ?? null,
      model_id: request.body?.model_id ?? null,
      status: typeof request.body?.status === 'string' ? request.body.status : 'created',
      mode: request.body?.mode === 'team' || request.body?.mode === 'review' ? request.body.mode : 'single',
      parent_run_id: request.body?.parent_run_id ?? null,
      metadata: request.body?.metadata && typeof request.body.metadata === 'object' ? request.body.metadata : {},
    });
    response.status(201).json({ ok: true, data: created });
  } catch (error) {
    const code = codeOf(error, 'CHAT_RUN_CREATE_FAILED');
    response.status(statusFor(code)).json({ ok: false, error: { code, message: code } });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.patch('/chat-runs/:runId', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const body = request.body ?? {};
    const updated = new ChatRunRepository(database.connection).update(request.params.runId, {
      status: typeof body.status === 'string' ? body.status : undefined,
      ended_at: Object.prototype.hasOwnProperty.call(body, 'ended_at') ? body.ended_at : undefined,
      input_tokens: Object.prototype.hasOwnProperty.call(body, 'input_tokens') ? body.input_tokens : undefined,
      output_tokens: Object.prototype.hasOwnProperty.call(body, 'output_tokens') ? body.output_tokens : undefined,
      error: Object.prototype.hasOwnProperty.call(body, 'error') ? body.error : undefined,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
    });
    response.json({ ok: true, data: updated });
  } catch (error) {
    const code = codeOf(error, 'CHAT_RUN_UPDATE_FAILED');
    response.status(statusFor(code)).json({ ok: false, error: { code, message: code } });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.get('/projects/:projectId/activity', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    response.json({ ok: true, data: new ActivityRepository(database.connection).listForProject(request.params.projectId) });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.post('/activity', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const body = request.body ?? {};
    const created = new ActivityRepository(database.connection).append({
      project_id: body.project_id ?? null,
      conversation_id: body.conversation_id ?? null,
      run_id: body.run_id ?? null,
      agent_id: body.agent_id ?? null,
      type: String(body.type || 'event'),
      severity: body.severity,
      title: String(body.title || ''),
      detail: typeof body.detail === 'string' ? body.detail : '',
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
    });
    response.status(201).json({ ok: true, data: created });
  } catch (error) {
    const code = codeOf(error, 'ACTIVITY_CREATE_FAILED');
    response.status(statusFor(code)).json({ ok: false, error: { code, message: code } });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.get('/projects/:projectId/agent-states', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    response.json({ ok: true, data: new AgentStateRepository(database.connection).listForProject(request.params.projectId) });
  } finally {
    database.connection.close();
  }
});

v2DataRouter.put('/projects/:projectId/agents/:agentId/state', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const body = request.body ?? {};
    const state = new AgentStateRepository(database.connection).upsert({
      agent_id: request.params.agentId,
      project_id: request.params.projectId,
      run_id: body.run_id ?? null,
      state: String(body.state || 'idle'),
      activity: typeof body.activity === 'string' ? body.activity : '',
      progress: body.progress == null ? null : Number(body.progress),
    });
    response.json({ ok: true, data: state });
  } catch (error) {
    const code = codeOf(error, 'AGENT_STATE_UPDATE_FAILED');
    response.status(statusFor(code)).json({ ok: false, error: { code, message: code } });
  } finally {
    database.connection.close();
  }
});
