import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';

export interface ProjectMemory {
  project_id: string;
  summary: string;
  architecture: string;
  rules: string;
  known_issues: string;
  updated_at: string;
}

export interface MemoryChunk {
  id: string;
  project_id: string;
  conversation_id: string | null;
  task_id: string | null;
  kind: string;
  text: string;
  created_at: string;
}

export interface Handoff {
  id: string;
  task_id: string;
  from_agent: string;
  to_agent: string | null;
  summary: string;
  files: string[];
  tests: string[];
  decisions: string[];
  open_issues: string[];
  created_at: string;
}

function now(): string {
  return new Date().toISOString();
}

export class MemoryRepository {
  constructor(private readonly database: Database) {}

  upsertProjectMemory(projectId: string, fields: Partial<Omit<ProjectMemory, 'project_id' | 'updated_at'>>): ProjectMemory {
    const existing = this.getProjectMemory(projectId);
    const merged = {
      summary: fields.summary ?? existing?.summary ?? '',
      architecture: fields.architecture ?? existing?.architecture ?? '',
      rules: fields.rules ?? existing?.rules ?? '',
      known_issues: fields.known_issues ?? existing?.known_issues ?? '',
    };
    this.database.prepare(`
      INSERT INTO project_memory (project_id, summary, architecture, rules, known_issues, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET summary = excluded.summary, architecture = excluded.architecture, rules = excluded.rules, known_issues = excluded.known_issues, updated_at = excluded.updated_at
    `).run(projectId, merged.summary, merged.architecture, merged.rules, merged.known_issues, now());
    return this.getProjectMemory(projectId)!;
  }

  getProjectMemory(projectId: string): ProjectMemory | null {
    const row = this.database.prepare('SELECT * FROM project_memory WHERE project_id = ?').get(projectId) as ProjectMemory | undefined;
    return row ?? null;
  }

  addChunk(input: { projectId: string; conversationId?: string | null; taskId?: string | null; kind: string; text: string }): MemoryChunk {
    const chunk: MemoryChunk = {
      id: crypto.randomUUID(),
      project_id: input.projectId,
      conversation_id: input.conversationId ?? null,
      task_id: input.taskId ?? null,
      kind: input.kind,
      text: input.text,
      created_at: now(),
    };
    this.database.prepare('INSERT INTO memory_chunks (id, project_id, conversation_id, task_id, kind, text, searchable_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      chunk.id, chunk.project_id, chunk.conversation_id, chunk.task_id, chunk.kind, chunk.text, chunk.text.toLowerCase(), chunk.created_at,
    );
    return chunk;
  }

  search(projectId: string, query: string, taskId?: string, limit = 8): MemoryChunk[] {
    const terms = query.split(/[^\p{L}\p{N}_]+/u).filter(term => term.length >= 3).slice(0, 12);
    if (!terms.length) return [];
    const match = terms.map(term => `"${term.replace(/"/g, '""')}"`).join(' OR ');
    try {
      return this.database.prepare(`
        SELECT mc.id, mc.project_id, mc.conversation_id, mc.task_id, mc.kind, mc.text, mc.created_at
        FROM memory_chunks_fts f
        JOIN memory_chunks mc ON mc.rowid = f.rowid
        WHERE memory_chunks_fts MATCH ? AND mc.project_id = ?
        ORDER BY (CASE WHEN mc.task_id = ? THEN 0 ELSE 1 END), bm25(memory_chunks_fts), mc.created_at DESC
        LIMIT ?
      `).all(match, projectId, taskId ?? '', limit) as MemoryChunk[];
    } catch {
      return [];
    }
  }

  createHandoff(input: { taskId: string; fromAgent: string; toAgent?: string | null; summary: string; files?: string[]; tests?: string[]; decisions?: string[]; openIssues?: string[] }): Handoff {
    const handoff: Handoff = {
      id: crypto.randomUUID(),
      task_id: input.taskId,
      from_agent: input.fromAgent,
      to_agent: input.toAgent ?? null,
      summary: input.summary,
      files: input.files ?? [],
      tests: input.tests ?? [],
      decisions: input.decisions ?? [],
      open_issues: input.openIssues ?? [],
      created_at: now(),
    };
    this.database.prepare('INSERT INTO handoffs (id, task_id, from_agent, to_agent, summary, files_json, tests_json, decisions_json, open_issues_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      handoff.id, handoff.task_id, handoff.from_agent, handoff.to_agent, handoff.summary,
      JSON.stringify(handoff.files), JSON.stringify(handoff.tests), JSON.stringify(handoff.decisions), JSON.stringify(handoff.open_issues), handoff.created_at,
    );
    return handoff;
  }

  latestHandoff(taskId: string): Handoff | null {
    const row = this.database.prepare('SELECT * FROM handoffs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(taskId) as any;
    if (!row) return null;
    return { ...row, files: JSON.parse(row.files_json), tests: JSON.parse(row.tests_json), decisions: JSON.parse(row.decisions_json), open_issues: JSON.parse(row.open_issues_json) };
  }
}

export interface ContextPackBudget {
  system: number;
  project: number;
  task: number;
  history: number;
  handoff: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextPackBudget = { system: 2000, project: 5000, task: 4000, history: 8000, handoff: 4000 };

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToBudget(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;
  const marker = '\n[section truncated to fit context budget]';
  const maxChars = tokenBudget * 4 - marker.length - 1;
  return `${text.slice(0, maxChars)}${marker}`;
}

const SYSTEM_RULES = [
  '- You are one agent inside Agent Office; the conversation and memory are shared with other agents.',
  '- Paths are relative to the project root; never touch files outside it.',
  '- Destructive operations require human approval and will be denied otherwise.',
  '- When done, summarize what changed and stop calling tools.',
].join('\n');

export interface ContextPackInput {
  projectId: string;
  taskId?: string;
  conversationId?: string;
  extraInstructions?: string;
}

export interface ContextPack {
  text: string;
  tokens: number;
  sections: Record<string, number>;
}

export class ContextPackBuilder {
  constructor(private readonly database: Database, private readonly budget: ContextPackBudget = DEFAULT_CONTEXT_BUDGET) {}

  build(input: ContextPackInput): ContextPack {
    const memory = new MemoryRepository(this.database);
    const sections: Record<string, string> = {};

    sections['SYSTEM RULES'] = SYSTEM_RULES;

    const projectMemory = memory.getProjectMemory(input.projectId);
    sections['PROJECT SUMMARY'] = projectMemory
      ? [projectMemory.summary, projectMemory.architecture && `Architecture: ${projectMemory.architecture}`, projectMemory.rules && `Rules: ${projectMemory.rules}`, projectMemory.known_issues && `Known issues: ${projectMemory.known_issues}`].filter(Boolean).join('\n')
      : '(no project memory yet)';

    let taskQuery = '';
    if (input.taskId) {
      const task = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(input.taskId) as any;
      if (task) {
        taskQuery = `${task.title} ${task.description}`;
        sections['CURRENT TASK'] = [`Title: ${task.title}`, task.description && `Description: ${task.description}`, `Category: ${task.category} | Risk: ${task.risk} | Status: ${task.status} | Attempt: ${task.attempt_count}`].filter(Boolean).join('\n');
        const lastRun = this.database.prepare('SELECT status, output_summary, error_json FROM runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1').get(input.taskId) as any;
        sections['CURRENT STATE'] = lastRun ? `Last run: ${lastRun.status}\n${lastRun.output_summary || ''}${lastRun.error_json ? `\nError: ${lastRun.error_json}` : ''}` : 'No runs yet.';
        sections['ACCEPTANCE CRITERIA'] = task.description ? task.description : 'Relevant tests pass; no regressions introduced.';
      }
    }
    if (!sections['CURRENT TASK']) sections['CURRENT TASK'] = '(no active task)';
    if (!sections['CURRENT STATE']) sections['CURRENT STATE'] = '(no state)';
    if (!sections['ACCEPTANCE CRITERIA']) sections['ACCEPTANCE CRITERIA'] = 'Relevant tests pass; no regressions introduced.';

    const decisions = this.database.prepare(`SELECT text FROM memory_chunks WHERE project_id = ? AND kind = 'decision' ORDER BY created_at DESC LIMIT 5`).all(input.projectId) as Array<{ text: string }>;
    sections['RELEVANT DECISIONS'] = decisions.length ? decisions.map(chunk => `- ${chunk.text}`).join('\n') : '(none recorded)';

    const historyParts: string[] = [];
    if (taskQuery) {
      for (const chunk of memory.search(input.projectId, taskQuery, input.taskId)) {
        historyParts.push(`[${chunk.kind}] ${chunk.text}`);
      }
    }
    if (input.conversationId) {
      const recent = this.database.prepare(`SELECT role, agent_id, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 10`).all(input.conversationId) as Array<{ role: string; agent_id: string | null; content: string }>;
      for (const message of recent.reverse()) {
        historyParts.push(`${message.role}${message.agent_id ? `(${message.agent_id})` : ''}: ${message.content.slice(0, 500)}`);
      }
    }
    sections['RELEVANT HISTORY'] = historyParts.length ? historyParts.join('\n---\n') : '(none)';

    if (input.taskId) {
      const handoff = memory.latestHandoff(input.taskId);
      sections['LAST HANDOFF'] = handoff
        ? [`From: ${handoff.from_agent}`, handoff.summary, handoff.files.length && `Files: ${handoff.files.join(', ')}`, handoff.decisions.length && `Decisions: ${handoff.decisions.join('; ')}`, handoff.open_issues.length && `Open issues: ${handoff.open_issues.join('; ')}`].filter(Boolean).join('\n')
        : '(no handoff)';
    } else {
      sections['LAST HANDOFF'] = '(no handoff)';
    }

    const budgetBySection: Record<string, number> = {
      'SYSTEM RULES': this.budget.system,
      'PROJECT SUMMARY': this.budget.project,
      'CURRENT TASK': this.budget.task,
      'CURRENT STATE': this.budget.task,
      'RELEVANT DECISIONS': this.budget.handoff,
      'RELEVANT HISTORY': this.budget.history,
      'LAST HANDOFF': this.budget.handoff,
      'ACCEPTANCE CRITERIA': this.budget.task,
    };

    const parts: string[] = [];
    const sectionTokens: Record<string, number> = {};
    for (const [name, content] of Object.entries(sections)) {
      const truncated = truncateToBudget(content, budgetBySection[name] ?? 1000);
      sectionTokens[name] = estimateTokens(truncated);
      parts.push(`# ${name}\n${truncated}`);
    }
    if (input.extraInstructions) parts.push(`# EXTRA INSTRUCTIONS\n${truncateToBudget(input.extraInstructions, 1000)}`);
    const text = parts.join('\n\n');
    return { text, tokens: estimateTokens(text), sections: sectionTokens };
  }
}
