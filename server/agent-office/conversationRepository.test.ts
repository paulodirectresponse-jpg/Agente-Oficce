import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeAgentOfficeDatabase, openAgentOfficeDatabase } from './database.js';
import { ConversationRepository, MessageRepository } from './conversationRepository.js';

describe('Conversation and Message repositories', () => {
  it('ensures one conversation per project and persists UTF-8 messages', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    const conversations = new ConversationRepository(database.connection);
    const messages = new MessageRepository(database.connection);
    const projectId = 'test-project';
    const convId = conversations.ensureForProject(projectId);
    expect(convId).toBe(conversations.ensureForProject(projectId));
    const msg = messages.create({ conversation_id: convId, role: 'user', content: 'Olá 👋 agente — está tudo bem?' });
    expect(msg.id).toBeDefined();
    const loaded = messages.list(convId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content).toBe('Olá 👋 agente — está tudo bem?');
    closeAgentOfficeDatabase(database);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('supports long messages and role variety', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    const conversations = new ConversationRepository(database.connection);
    const messages = new MessageRepository(database.connection);
    const convId = conversations.ensureForProject('p2');
    const long = 'x'.repeat(50000);
    messages.create({ conversation_id: convId, role: 'assistant', agent_id: 'kimi', content: long });
    const loaded = messages.list(convId);
    expect(loaded[0].content.length).toBe(50000);
    closeAgentOfficeDatabase(database);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});