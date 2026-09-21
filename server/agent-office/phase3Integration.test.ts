import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeAgentOfficeDatabase, openAgentOfficeDatabase } from './database.js';
import { adapterRegistry, MockAdapter } from './adapterFramework.js';
import { TaskRunManager } from './taskRunManager.js';
import { ProjectRepository } from './projectRepository.js';
import { ConversationRepository, MessageRepository } from './conversationRepository.js';

describe('Phase 3 integration: adapter framework + task manager + project + conversation', () => {
  it('full flow: create project -> conversation -> task -> mock run -> complete -> restart retains state', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
    const projectDir = fs.mkdtempSync(path.join(dataDir, 'proj-'));
    // Session 1
    let database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    let projects = new ProjectRepository(database.connection);
    let conversations = new ConversationRepository(database.connection);
    let messages = new MessageRepository(database.connection);
    const project = projects.create({ root_path: projectDir, name: 'Integration Project' });
    const convId = conversations.ensureForProject(project.id);
    messages.create({ conversation_id: convId, role: 'user', content: 'Implement login page' });
    let manager = new TaskRunManager({ database: database.connection, adapterRegistry: adapterRegistry.getMap(), maxAutoAttempts: 3, maxAgentSwitches: 3 });
    const task = manager.createTask({ projectId: project.id, conversationId: convId, title: 'Implement login page', risk: 'low' });
    const { runId, events } = await manager.startRun(task.id, 'kimi', 'Context pack: implement login', projectDir);
    for await (const _event of events) {}
    await manager.completeRun(runId, true, 'Login page implemented');
    database.connection.close();

    // Session 2 (restart)
    database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    projects = new ProjectRepository(database.connection);
    conversations = new ConversationRepository(database.connection);
    messages = new MessageRepository(database.connection);
    const manager2 = new TaskRunManager({ database: database.connection, adapterRegistry: adapterRegistry.getMap(), maxAutoAttempts: 3, maxAgentSwitches: 3 });
    const loadedProjects = projects.list();
    expect(loadedProjects).toHaveLength(1);
    const loadedConvId = conversations.ensureForProject(loadedProjects[0].id);
    const history = messages.list(loadedConvId);
    expect(history.some(m => m.content === 'Implement login page')).toBe(true);
    const loadedTask = manager2.getTask(task.id);
    expect(loadedTask?.status).toBe('completed');
    database.connection.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});