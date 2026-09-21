import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeAgentOfficeDatabase, openAgentOfficeDatabase } from './database.js';
import { ProjectRepository } from './projectRepository.js';
import { ConversationRepository, MessageRepository } from './conversationRepository.js';

describe('Phase 2 integration: project + conversation + message persistence and restart', () => {
  it('restart simulation: data survives new database connection', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
    const projectDir = fs.mkdtempSync(path.join(dataDir, 'proj-'));
    // First "session"
    {
      const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
      const projects = new ProjectRepository(database.connection);
      const conversations = new ConversationRepository(database.connection);
      const messages = new MessageRepository(database.connection);
      const project = projects.create({ root_path: projectDir, name: 'Test Project' });
      const convId = conversations.ensureForProject(project.id);
      messages.create({ conversation_id: convId, role: 'user', content: 'Primeira mensagem' });
      messages.create({ conversation_id: convId, role: 'assistant', agent_id: 'kimi', content: 'Resposta do Kimi' });
      database.connection.close();
    }
    // Simulated restart: new connection to same file
    {
      const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
      const projects = new ProjectRepository(database.connection);
      const conversations = new ConversationRepository(database.connection);
      const messages = new MessageRepository(database.connection);
      const loaded = projects.list();
      expect(loaded).toHaveLength(1);
      const convId = conversations.ensureForProject(loaded[0].id);
      const history = messages.list(convId);
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('Primeira mensagem');
      expect(history[1].content).toBe('Resposta do Kimi');
      database.connection.close();
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});