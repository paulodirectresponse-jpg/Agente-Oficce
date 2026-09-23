import { Router } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { ProjectRepository } from '../agent-office/projectRepository.js';
import { ConversationRepository, MessageRepository } from '../agent-office/conversationRepository.js';
import { TaskRunManager } from '../agent-office/taskRunManager.js';
import { TaskOrchestrator } from '../agent-office/orchestrator.js';
import { buildAdapterRegistry } from '../agent-office/adapterFactory.js';
import { TaskRouter } from '../agent-office/router.js';
import { UsageTracker } from '../agent-office/usageTracker.js';
import { ProviderConfigRepository } from '../agent-office/providerConfig.js';
import { DevelopmentSecretStore } from '../agent-office/secretStore.js';
import { getAgentOfficeConfig, ensureAgentOfficeDataDir } from '../agent-office/config.js';
import { getProjectRootSetting, setProjectRootSetting } from '../agent-office/appSettings.js';
import { v2DataRouter } from './v2DataRoutes.js';
import { chatRouter } from './chatRoutes.js';
import { v3CapabilityRouter } from './v3CapabilityRoutes.js';
import { v3OrchestratorRouter } from './v3OrchestratorRoutes.js';
import { v3GapAnalysisRouter } from './v3GapAnalysisRoutes.js';
import { v3ExecutionGraphRouter } from './v3ExecutionGraphRoutes.js';
import { v3DurableExecutionRouter } from './v3DurableExecutionRoutes.js';
import { v3TeamsRouter } from './v3TeamsRoutes.js';
import { v3WorkspaceRouter } from './v3WorkspaceRoutes.js';
import { v3ProjectsRouter } from './v3ProjectsRoutes.js';
import { v3AnalyticsRouter } from './v3AnalyticsRoutes.js';
import { v3ReleaseRouter } from './v3ReleaseRoutes.js';
import { v3IntegrationRouter } from './v3IntegrationRoutes.js';

export const agentOfficeRouter = Router();

// V2 data model endpoints live behind a versioned namespace while the V1 API remains intact.
agentOfficeRouter.use('/agent-office/v2', v2DataRouter);
agentOfficeRouter.use('/agent-office/v3', v3CapabilityRouter);
agentOfficeRouter.use('/agent-office/v3/orchestrator', v3OrchestratorRouter);
agentOfficeRouter.use('/agent-office/v3/orchestration', v3GapAnalysisRouter);
agentOfficeRouter.use('/agent-office/v3/execution', v3ExecutionGraphRouter);
agentOfficeRouter.use('/agent-office/v3/durable', v3DurableExecutionRouter);
agentOfficeRouter.use('/agent-office/v3', v3TeamsRouter);
agentOfficeRouter.use('/agent-office/v3/workspace', v3WorkspaceRouter);
agentOfficeRouter.use('/agent-office/v3', v3ProjectsRouter);
agentOfficeRouter.use('/agent-office/v3', v3AnalyticsRouter);
agentOfficeRouter.use('/agent-office/v3', v3ReleaseRouter);
agentOfficeRouter.use('/agent-office/v3', v3IntegrationRouter);
agentOfficeRouter.use('/agent-office/chat', chatRouter);

// Health check - validates local SQLite foundation
agentOfficeRouter.get('/agent-office/health', (_request, response) => {
  const config = getAgentOfficeConfig();
  try {
    ensureAgentOfficeDataDir(config);
    const database = openAgentOfficeDatabase(config);
    database.connection.prepare('SELECT 1 AS ok').get();
    database.connection.close();
    response.json({
      ok: true,
      service: 'agent-office',
      storage: 'sqlite-wal',
      data_dir_configured: Boolean(config.dataDir),
      database_path_configured: Boolean(config.databasePath),
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      service: 'agent-office',
      error: { code: 'LOCAL_STORAGE_UNAVAILABLE', message: error instanceof Error ? error.message : 'Local storage is unavailable.' },
    });
  }
});

// Project root setting
agentOfficeRouter.get('/agent-office/settings/project-root', (_request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    response.json({ ok: true, data: getProjectRootSetting(database.connection) });
  } finally {
    database.connection.close();
  }
});

agentOfficeRouter.put('/agent-office/settings/project-root', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const setting = setProjectRootSetting(database.connection, String(request.body?.path || ''));
    response.json({ ok: true, data: setting });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'PROJECT_ROOT_SAVE_FAILED';
    response.status(400).json({ ok: false, error: { code, message: code } });
  } finally {
    database.connection.close();
  }
});

// Projects
agentOfficeRouter.get('/agent-office/projects', (_request, response) => {
  try {
    const database = openAgentOfficeDatabase();
    const projects = new ProjectRepository(database.connection).list();
    database.connection.close();
    response.json({ ok: true, data: projects });
  } catch (error) {
    response.status(500).json({ ok: false, error: { code: 'PROJECT_LIST_FAILED', message: error instanceof Error ? error.message : 'Unable to list projects.' } });
  }
});

agentOfficeRouter.post('/agent-office/projects', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const repository = new ProjectRepository(database.connection);
    const explicitRoot = typeof request.body?.root_path === 'string' && request.body.root_path.trim();
    const project = explicitRoot
      ? repository.create({ name: request.body?.name, root_path: request.body.root_path.trim() })
      : repository.createInDefaultRoot(String(request.body?.name || ''));
    response.status(201).json({ ok: true, data: project });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'PROJECT_CREATE_FAILED';
    const status = code === 'PROJECT_ALREADY_EXISTS' || code === 'PROJECT_FOLDER_ALREADY_EXISTS'
      ? 409
      : code.startsWith('PROJECT_')
        ? 400
        : 500;
    const messages: Record<string, string> = {
      PROJECT_PATH_NOT_FOUND: 'Project folder does not exist.',
      PROJECT_PATH_NOT_DIRECTORY: 'Project path is not a folder.',
      PROJECT_ALREADY_EXISTS: 'This project folder is already registered.',
      PROJECT_FOLDER_ALREADY_EXISTS: 'A folder with this project name already exists inside the default root.',
      PROJECT_ROOT_NOT_CONFIGURED: 'Configure the default project root first.',
      PROJECT_NAME_REQUIRED: 'Project name is required.',
      PROJECT_NAME_INVALID: 'Project name cannot be used as a folder name.',
    };
    response.status(status).json({ ok: false, error: { code, message: messages[code] ?? 'Unable to create project.' } });
  } finally {
    database.connection.close();
  }
});

agentOfficeRouter.get('/agent-office/projects/:projectId', (request, response) => {
  try {
    const database = openAgentOfficeDatabase();
    const project = new ProjectRepository(database.connection).get(request.params.projectId);
    database.connection.close();
    if (!project) {
      response.status(404).json({ ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      return;
    }
    response.json({ ok: true, data: project });
  } catch (error) {
    response.status(500).json({ ok: false, error: { code: 'PROJECT_GET_FAILED', message: error instanceof Error ? error.message : 'Unable to get project.' } });
  }
});

// Conversations (one per project)
agentOfficeRouter.get('/agent-office/projects/:projectId/conversation', (request, response) => {
  try {
    const database = openAgentOfficeDatabase();
    const conversations = new ConversationRepository(database.connection);
    const conversationId = conversations.ensureForProject(request.params.projectId);
    const messages = new MessageRepository(database.connection).list(conversationId, 200);
    database.connection.close();
    response.json({ ok: true, data: { conversation_id: conversationId, messages } });
  } catch (error) {
    response.status(500).json({ ok: false, error: { code: 'CONVERSATION_FAILED', message: error instanceof Error ? error.message : 'Unable to load conversation.' } });
  }
});

agentOfficeRouter.post('/agent-office/projects/:projectId/messages', (request, response) => {
  try {
    const database = openAgentOfficeDatabase();
    const conversations = new ConversationRepository(database.connection);
    const conversationId = conversations.ensureForProject(request.params.projectId);
    const messages = new MessageRepository(database.connection);
    const message = messages.create({
      conversation_id: conversationId,
      role: request.body?.role || 'user',
      agent_id: request.body?.agent_id ?? null,
      content: String(request.body?.content || ''),
      metadata: request.body?.metadata,
    });
    database.connection.close();
    response.status(201).json({ ok: true, data: message });
  } catch (error) {
    response.status(500).json({ ok: false, error: { code: 'MESSAGE_FAILED', message: error instanceof Error ? error.message : 'Unable to save message.' } });
  }
});

// Tasks
agentOfficeRouter.get('/agent-office/projects/:projectId/tasks', (request, response) => {
  try {
    const database = openAgentOfficeDatabase();
    const tasks = database.connection.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC').all(request.params.projectId);
    database.connection.close();
    response.json({ ok: true, data: tasks });
  } catch (error) {
    response.status(500).json({ ok: false, error: { code: 'TASK_LIST_FAILED', message: error instanceof Error ? error.message : 'Unable to list tasks.' } });
  }
});

agentOfficeRouter.post('/agent-office/projects/:projectId/tasks', (request, response) => {
  try {
    const database = openAgentOfficeDatabase();
    const conversations = new ConversationRepository(database.connection);
    const conversationId = conversations.ensureForProject(request.params.projectId);
    const manager = new TaskRunManager({ database: database.connection, adapterRegistry: new Map(), maxAutoAttempts: 3, maxAgentSwitches: 3 });
    const task = manager.createTask({
      projectId: request.params.projectId,
      conversationId,
      title: String(request.body?.title || 'Untitled Task'),
      description: String(request.body?.description || ''),
      category: String(request.body?.category || 'unknown'),
      risk: request.body?.risk === 'low' || request.body?.risk === 'high' ? request.body.risk : 'medium',
    });
    database.connection.close();
    response.status(201).json({ ok: true, data: task });
  } catch (error) {
    response.status(500).json({ ok: false, error: { code: 'TASK_CREATE_FAILED', message: error instanceof Error ? error.message : 'Unable to create task.' } });
  }
});

agentOfficeRouter.get('/agent-office/projects/:projectId/tasks/:taskId', (request, response) => {
  try {
    const database = openAgentOfficeDatabase();
    const task = database.connection.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(request.params.taskId, request.params.projectId);
    database.connection.close();
    if (!task) {
      response.status(404).json({ ok: false, error: { code: 'TASK_NOT_FOUND', message: 'Task not found.' } });
      return;
    }
    response.json({ ok: true, data: task });
  } catch (error) {
    response.status(500).json({ ok: false, error: { code: 'TASK_GET_FAILED', message: error instanceof Error ? error.message : 'Unable to get task.' } });
  }
});

// Run execution (autonomous loop, runs in background; poll task/events for progress)
agentOfficeRouter.post('/agent-office/projects/:projectId/tasks/:taskId/run', async (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const task = database.connection.prepare('SELECT * FROM tasks WHERE id = ? AND project_id = ?').get(request.params.taskId, request.params.projectId) as { id: string } | undefined;
    if (!task) {
      database.connection.close();
      response.status(404).json({ ok: false, error: { code: 'TASK_NOT_FOUND', message: 'Task not found.' } });
      return;
    }
    const project = new ProjectRepository(database.connection).get(request.params.projectId);
    if (!project) {
      database.connection.close();
      response.status(404).json({ ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
      return;
    }
    const config = getAgentOfficeConfig();
    const activeRun = database.connection.prepare(`
      SELECT runs.id FROM runs INNER JOIN tasks ON tasks.id = runs.task_id
      WHERE tasks.project_id = ? AND runs.status IN ('started', 'running') LIMIT 1
    `).get(request.params.projectId);
    if (activeRun) {
      database.connection.close();
      response.status(409).json({ ok: false, error: { code: 'WRITER_LOCK_ACTIVE', message: 'Another run is already active for this project.' } });
      return;
    }
    const secrets = new DevelopmentSecretStore(config.dataDir);
    const registry = await buildAdapterRegistry(database.connection, secrets);
    const manager = new TaskRunManager({ database: database.connection, adapterRegistry: registry, maxAutoAttempts: 3, maxAgentSwitches: 3 });
    const taskRow = database.connection.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as { title: string; description: string; attempt_count: number; status: string };
    const router = new TaskRouter(registry);
    const requestedAgent = typeof request.body?.agent_id === 'string' ? request.body.agent_id : null;
    const manual = requestedAgent && registry.has(requestedAgent) ? requestedAgent : null;
    const decision = router.decide({
      title: taskRow.title,
      description: taskRow.description,
      failures: Math.max(0, taskRow.attempt_count - 1),
    }, manual);
    const orchestrator = new TaskOrchestrator({ database: database.connection, manager, projectRoot: project.root_path });
    void orchestrator.executeTask(task.id, decision.agent)
      .catch(() => undefined)
      .finally(() => database.connection.close());
    response.status(202).json({ ok: true, data: { task_id: task.id, agent_id: decision.agent, reason: decision.reason, status: 'running' } });
  } catch (error) {
    database.connection.close();
    const code = error instanceof Error ? error.message : 'TASK_RUN_FAILED';
    const status = code === 'WRITER_LOCK_ACTIVE' ? 409 : code === 'ADAPTER_NOT_FOUND' || code === 'ADAPTER_UNAVAILABLE' ? 503 : 500;
    response.status(status).json({ ok: false, error: { code, message: 'Unable to start task run.' } });
  }
});

agentOfficeRouter.get('/agent-office/projects/:projectId/tasks/:taskId/events', (request, response) => {
  try {
    const database = openAgentOfficeDatabase();
    const events = database.connection.prepare('SELECT run_id, event_type, payload_json, created_at FROM agent_office_events WHERE task_id = ? ORDER BY created_at, event_key LIMIT 500').all(request.params.taskId);
    database.connection.close();
    response.json({ ok: true, data: events });
  } catch (error) {
    response.status(500).json({ ok: false, error: { code: 'EVENT_LIST_FAILED', message: error instanceof Error ? error.message : 'Unable to list events.' } });
  }
});

// Usage dashboard
agentOfficeRouter.get('/agent-office/usage', (_request, response) => {
  try {
    const database = openAgentOfficeDatabase();
    const summaries = new UsageTracker(database.connection).summarizeAll();
    database.connection.close();
    response.json({ ok: true, data: summaries });
  } catch (error) {
    response.status(500).json({ ok: false, error: { code: 'USAGE_FAILED', message: error instanceof Error ? error.message : 'Unable to load usage.' } });
  }
});

// Provider configuration (secrets stored outside SQLite, only secret_ref persisted)
agentOfficeRouter.post('/agent-office/providers/:providerId/config', async (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const config = getAgentOfficeConfig();
    const secrets = new DevelopmentSecretStore(config.dataDir);
    const body = request.body ?? {};
    let secretRef: string | null = body.secret_ref ?? null;
    if (typeof body.api_key === 'string' && body.api_key.trim()) {
      secretRef = `${request.params.providerId}-api-key`;
      await secrets.set(secretRef, body.api_key.trim());
    }
    const saved = new ProviderConfigRepository(database.connection).save({
      provider_id: request.params.providerId,
      base_url: String(body.base_url || ''),
      model: String(body.model || ''),
      auth_scheme: body.auth_scheme === 'x-api-key' || body.auth_scheme === 'custom' ? body.auth_scheme : 'bearer',
      auth_header: body.auth_header ?? null,
      custom_headers: body.custom_headers && typeof body.custom_headers === 'object' ? body.custom_headers : {},
      timeout_ms: Number(body.timeout_ms) > 0 ? Number(body.timeout_ms) : 60000,
      health_endpoint: String(body.health_endpoint || '/v1/models'),
      health_method: body.health_method === 'POST' ? 'POST' : 'GET',
      secret_ref: secretRef,
      max_tool_steps: Number(body.max_tool_steps) > 0 ? Number(body.max_tool_steps) : undefined,
    });
    database.connection.close();
    response.json({ ok: true, data: { ...saved, secret_ref: saved.secret_ref ? '***' : null } });
  } catch (error) {
    database.connection.close();
    response.status(500).json({ ok: false, error: { code: 'PROVIDER_CONFIG_FAILED', message: error instanceof Error ? error.message : 'Unable to save provider config.' } });
  }
});

agentOfficeRouter.get('/agent-office/providers/:providerId/config', (request, response) => {
  try {
    const database = openAgentOfficeDatabase();
    const config = new ProviderConfigRepository(database.connection).get(request.params.providerId);
    database.connection.close();
    if (!config) {
      response.status(404).json({ ok: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not configured.' } });
      return;
    }
    response.json({ ok: true, data: { ...config, secret_ref: config.secret_ref ? '***' : null } });
  } catch (error) {
    response.status(500).json({ ok: false, error: { code: 'PROVIDER_GET_FAILED', message: error instanceof Error ? error.message : 'Unable to load provider config.' } });
  }
});