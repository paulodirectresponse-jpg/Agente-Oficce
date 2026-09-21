import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeAgentOfficeDatabase, openAgentOfficeDatabase } from './database.js';
import { adapterRegistry } from './adapterFramework.js';
import { TaskRunManager } from './taskRunManager.js';
import { ProjectRepository } from './projectRepository.js';
import { ConversationRepository, MessageRepository } from './conversationRepository.js';

describe('TaskRunManager', () => {
  it('creates task, runs mock adapter, cancels, and recovers', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
    const projectDir = fs.mkdtempSync(path.join(dataDir, 'proj-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    const projects = new ProjectRepository(database.connection);
    const conversations = new ConversationRepository(database.connection);
    const messages = new MessageRepository(database.connection);
    const project = projects.create({ root_path: projectDir });
    const convId = conversations.ensureForProject(project.id);

    const manager = new TaskRunManager({ database: database.connection, adapterRegistry: adapterRegistry.getMap(), maxAutoAttempts: 3, maxAgentSwitches: 3 });
    const task = manager.createTask({ projectId: project.id, conversationId: convId, title: 'Test task', risk: 'low' });
    expect(task.status).toBe('queued');

    const { runId, events } = await manager.startRun(task.id, 'kimi', 'Context pack', projectDir);
    expect(manager.getActiveRun()?.runId).toBe(runId);

    const collected: Array<{ type: string }> = [];
    for await (const event of events) collected.push({ type: event.type });
    expect(collected.some(e => e.type === 'complete')).toBe(true);

    await manager.completeRun(runId, true, 'Success');
    const completed = manager.getTask(task.id);
    expect(completed?.status).toBe('completed');
    expect(manager.getActiveRun()).toBeNull();

    database.connection.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('cancels running task and releases writer lock', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
    const projectDir = fs.mkdtempSync(path.join(dataDir, 'proj-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    const projects = new ProjectRepository(database.connection);
    const conversations = new ConversationRepository(database.connection);
    const project = projects.create({ root_path: projectDir });
    const convId = conversations.ensureForProject(project.id);

    const manager = new TaskRunManager({ database: database.connection, adapterRegistry: adapterRegistry.getMap(), maxAutoAttempts: 3, maxAgentSwitches: 3 });
    const task = manager.createTask({ projectId: project.id, conversationId: convId, title: 'Cancel test' });
    const { runId } = await manager.startRun(task.id, 'kimi', 'Context', projectDir);
    await manager.cancelRun(runId);
    const cancelled = manager.getTask(task.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(manager.getActiveRun()).toBeNull();

    database.connection.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('blocks after max attempts', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
    const projectDir = fs.mkdtempSync(path.join(dataDir, 'proj-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    const projects = new ProjectRepository(database.connection);
    const conversations = new ConversationRepository(database.connection);
    const project = projects.create({ root_path: projectDir });
    const convId = conversations.ensureForProject(project.id);

    const manager = new TaskRunManager({ database: database.connection, adapterRegistry: adapterRegistry.getMap(), maxAutoAttempts: 2, maxAgentSwitches: 2 });
    const task = manager.createTask({ projectId: project.id, conversationId: convId, title: 'Block test' });
    // Simulate 2 failed attempts (persist to DB so canAutoRetry reads from task)
    task.attempt_count = 2;
    manager['options'].database.prepare('UPDATE tasks SET attempt_count = ? WHERE id = ?').run(2, task.id);
    expect(manager.canAutoRetry(task.id)).toBe(false);

    database.connection.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('crash recovery marks orphan runs as failed and tasks as blocked', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
    const projectDir = fs.mkdtempSync(path.join(dataDir, 'proj-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    const projects = new ProjectRepository(database.connection);
    const conversations = new ConversationRepository(database.connection);
    const project = projects.create({ root_path: projectDir });
    const convId = conversations.ensureForProject(project.id);

    const manager = new TaskRunManager({ database: database.connection, adapterRegistry: adapterRegistry.getMap(), maxAutoAttempts: 3, maxAgentSwitches: 3 });
    const task = manager.createTask({ projectId: project.id, conversationId: convId, title: 'Crash recovery' });
    const { runId } = await manager.startRun(task.id, 'kimi', 'Context', projectDir);
    // Simulate crash: leave run in 'running' and close without cleanup
    database.connection.prepare('UPDATE runs SET status = ? WHERE id = ?').run('running', runId);
    database.connection.close();

    // New connection simulates restart
    const database2 = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    const manager2 = new TaskRunManager({ database: database2.connection, adapterRegistry: adapterRegistry.getMap(), maxAutoAttempts: 3, maxAgentSwitches: 3 });
    const { recoveredTasks } = await manager2.resumeAfterCrash();
    expect(recoveredTasks.length).toBe(1);
    expect(recoveredTasks[0].status).toBe('blocked');
    const run = database2.connection.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as { status: string } | undefined;
    expect(run?.status).toBe('failed');

    database2.connection.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});