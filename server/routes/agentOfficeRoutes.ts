import { Router } from 'express';
import crypto from 'node:crypto';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { ProjectRepository } from '../agent-office/projectRepository.js';
import { ConversationRepository, MessageRepository } from '../agent-office/conversationRepository.js';
import { getAgentOfficeConfig, ensureAgentOfficeDataDir } from '../agent-office/config.js';

export const agentOfficeRouter = Router();

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
  try {
    const database = openAgentOfficeDatabase();
    const project = new ProjectRepository(database.connection).create({ name: request.body?.name, root_path: String(request.body?.root_path || '') });
    database.connection.close();
    response.status(201).json({ ok: true, data: project });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'PROJECT_CREATE_FAILED';
    const status = code === 'PROJECT_PATH_NOT_FOUND' || code === 'PROJECT_PATH_NOT_DIRECTORY' ? 400 : code === 'PROJECT_ALREADY_EXISTS' ? 409 : 500;
    response.status(status).json({ ok: false, error: { code, message: code === 'PROJECT_PATH_NOT_FOUND' ? 'Project folder does not exist.' : code === 'PROJECT_PATH_NOT_DIRECTORY' ? 'Project path is not a folder.' : code === 'PROJECT_ALREADY_EXISTS' ? 'This project folder is already registered.' : 'Unable to create project.' } });
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
    const task = {
      id: crypto.randomUUID(),
      project_id: request.params.projectId,
      conversation_id: conversationId,
      title: request.body?.title || 'Untitled Task',
      description: request.body?.description || '',
      category: request.body?.category || 'unknown',
      risk: request.body?.risk || 'medium',
      status: 'queued',
      assigned_agent: null,
      attempt_count: 0,
      writer_lock: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    };
    database.connection.prepare(`INSERT INTO tasks (id, project_id, conversation_id, title, description, category, risk, status, assigned_agent, attempt_count, writer_lock, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      task.id, task.project_id, task.conversation_id, task.title, task.description, task.category, task.risk, task.status, task.assigned_agent, task.attempt_count, task.writer_lock, task.created_at, task.updated_at, task.completed_at,
    );
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