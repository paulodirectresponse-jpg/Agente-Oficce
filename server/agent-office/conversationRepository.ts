import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';

export interface AgentOfficeMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'event';
  agent_id: string | null;
  content: string;
  created_at: string;
  metadata_json: string;
}

export interface CreateMessageInput {
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'event';
  agent_id?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
}

function now(): string { return new Date().toISOString(); }
function id(): string { return crypto.randomUUID(); }

export class ConversationRepository {
  constructor(private readonly database: Database) {}

  ensureForProject(projectId: string): string {
    const existing = this.database.prepare('SELECT id FROM conversations WHERE project_id = ?').get(projectId) as { id: string } | undefined;
    if (existing) return existing.id;
    const timestamp = now();
    const conversationId = id();
    const projectExists = this.database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId);
    if (!projectExists) {
      this.database.prepare('INSERT INTO projects (id, name, root_path, git_enabled, git_branch, created_at, updated_at) VALUES (?, ?, ?, 0, NULL, ?, ?)').run(projectId, projectId, projectId, timestamp, timestamp);
      this.database.prepare('INSERT INTO project_memory (project_id, updated_at) VALUES (?, ?)').run(projectId, timestamp);
    }
    this.database.prepare('INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(conversationId, projectId, 'Conversa principal', timestamp, timestamp);
    return conversationId;
  }

  get(conversationId: string): { id: string; project_id: string; title: string; created_at: string; updated_at: string } | null {
    return this.database.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as any || null;
  }
}

export class MessageRepository {
  constructor(private readonly database: Database) {}

  create(input: CreateMessageInput): AgentOfficeMessage {
    const message: AgentOfficeMessage = {
      id: id(),
      conversation_id: input.conversation_id,
      role: input.role,
      agent_id: input.agent_id ?? null,
      content: input.content,
      created_at: now(),
      metadata_json: JSON.stringify(input.metadata ?? {}),
    };
    this.database.prepare(`INSERT INTO messages (id, conversation_id, role, agent_id, content, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      message.id, message.conversation_id, message.role, message.agent_id, message.content, message.created_at, message.metadata_json,
    );
    this.database.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(message.created_at, input.conversation_id);
    return message;
  }

  list(conversationId: string, limit = 200): AgentOfficeMessage[] {
    return this.database.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?').all(conversationId, limit).map((row: any) => ({
      ...row,
      metadata: JSON.parse(row.metadata_json),
    }));
  }
}