import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import {
  executeLocalTool,
  type LocalToolContext,
  type LocalToolName,
  type LocalToolResult,
} from './localTools.js';

export type ToolRisk = 'read' | 'write' | 'execute' | 'external' | 'destructive';
export type ToolApprovalMode = 'safe' | 'manual' | 'auto';

export interface AgentToolPolicy {
  agent_id: string;
  enabled: boolean;
  allowed_tools: string[];
  approval_mode: ToolApprovalMode;
  max_tool_steps: number;
  updated_at: string;
}

export interface ToolDefinition {
  name: LocalToolName;
  description: string;
  risk: ToolRisk;
  input_schema: Record<string, unknown>;
  default_enabled: boolean;
}

export interface ToolExecutionContext {
  database: Database;
  project_id: string;
  project_root: string;
  run_id: string;
  agent_id: string;
  signal?: AbortSignal;
}

export interface ToolExecutionResult extends LocalToolResult {
  audit_id: string;
  risk: ToolRisk;
  approval_required?: boolean;
  approval_id?: string;
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_files',
    description: 'List files and folders inside the active project only.',
    risk: 'read',
    default_enabled: true,
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative directory path. Use "." for the project root.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description: 'Read a bounded UTF-8 text file inside the active project.',
    risk: 'read',
    default_enabled: true,
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_files',
    description: 'Search text in files inside one project directory.',
    risk: 'read',
    default_enabled: true,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory. Defaults to project root.' },
        pattern: { type: 'string' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description: 'Create or replace a text file inside the active project.',
    risk: 'write',
    default_enabled: true,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'apply_patch',
    description: 'Replace one exact text occurrence in an existing project file.',
    risk: 'write',
    default_enabled: true,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string' },
        new_text: { type: 'string' },
      },
      required: ['path', 'old_text', 'new_text'],
      additionalProperties: false,
    },
  },
  {
    name: 'git_status',
    description: 'Inspect Git status in the active project.',
    risk: 'read',
    default_enabled: true,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'git_diff',
    description: 'Inspect the current Git diff inside the active project.',
    risk: 'read',
    default_enabled: true,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_tests',
    description: 'Run the project test command with bounded output and timeout.',
    risk: 'execute',
    default_enabled: true,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_command',
    description: 'Run an allowlisted git/npm/node command inside the active project. Destructive commands are always denied.',
    risk: 'execute',
    default_enabled: false,
    input_schema: {
      type: 'object',
      properties: {
        command: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' }, minItems: 1 },
          ],
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
];

function now(): string { return new Date().toISOString(); }

function parseTools(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export class AgentToolPolicyRepository {
  constructor(private readonly database: Database) {}

  get(agentId: string): AgentToolPolicy {
    const row = this.database.prepare('SELECT * FROM agent_tool_policies WHERE agent_id = ?').get(agentId) as any;
    if (!row) {
      return {
        agent_id: agentId,
        enabled: false,
        allowed_tools: TOOL_DEFINITIONS.filter((tool) => tool.default_enabled).map((tool) => tool.name),
        approval_mode: 'safe',
        max_tool_steps: 12,
        updated_at: now(),
      };
    }
    return {
      agent_id: row.agent_id,
      enabled: Boolean(row.enabled),
      allowed_tools: parseTools(row.allowed_tools_json),
      approval_mode: row.approval_mode as ToolApprovalMode,
      max_tool_steps: Number(row.max_tool_steps || 12),
      updated_at: row.updated_at,
    };
  }

  save(input: Omit<AgentToolPolicy, 'updated_at'>): AgentToolPolicy {
    const allowed = input.allowed_tools.filter((name) => TOOL_DEFINITIONS.some((tool) => tool.name === name));
    const timestamp = now();
    this.database.prepare(`
      INSERT INTO agent_tool_policies (agent_id, enabled, allowed_tools_json, approval_mode, max_tool_steps, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        enabled = excluded.enabled,
        allowed_tools_json = excluded.allowed_tools_json,
        approval_mode = excluded.approval_mode,
        max_tool_steps = excluded.max_tool_steps,
        updated_at = excluded.updated_at
    `).run(
      input.agent_id,
      input.enabled ? 1 : 0,
      JSON.stringify(allowed),
      input.approval_mode,
      Math.max(1, Math.min(40, input.max_tool_steps || 12)),
      timestamp,
    );
    return this.get(input.agent_id);
  }
}

export class AgentRelationRepository {
  constructor(private readonly database: Database) {}

  listChildren(parentAgentId: string): Array<{ child_agent_id: string; relation_type: string; priority: number }> {
    return this.database.prepare(`
      SELECT child_agent_id, relation_type, priority
      FROM agent_relations
      WHERE parent_agent_id = ? AND enabled = 1
      ORDER BY priority ASC, child_agent_id ASC
    `).all(parentAgentId) as Array<{ child_agent_id: string; relation_type: string; priority: number }>;
  }

  replaceChildren(parentAgentId: string, childAgentIds: string[]): void {
    const timestamp = now();
    const transaction = this.database.transaction(() => {
      this.database.prepare('DELETE FROM agent_relations WHERE parent_agent_id = ?').run(parentAgentId);
      const insert = this.database.prepare(`
        INSERT INTO agent_relations (
          parent_agent_id, child_agent_id, relation_type, enabled, priority, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'supervises', 1, ?, '{}', ?, ?)
      `);
      childAgentIds.forEach((childId, index) => insert.run(parentAgentId, childId, index, timestamp, timestamp));
    });
    transaction();
  }
}

export class ToolRegistry {
  listDefinitions(): ToolDefinition[] {
    return TOOL_DEFINITIONS.map((tool) => ({ ...tool, input_schema: { ...tool.input_schema } }));
  }

  definitionsForPolicy(policy: AgentToolPolicy): ToolDefinition[] {
    if (!policy.enabled) return [];
    const allowed = new Set(policy.allowed_tools);
    return TOOL_DEFINITIONS.filter((tool) => allowed.has(tool.name));
  }

  private needsApproval(tool: ToolDefinition, policy: AgentToolPolicy): boolean {
    if (tool.risk === 'destructive' || tool.risk === 'external') return true;
    if (policy.approval_mode === 'manual') return tool.risk !== 'read';
    if (policy.approval_mode === 'auto') return false;
    return tool.name === 'run_command';
  }

  async execute(
    toolName: string,
    input: Record<string, unknown>,
    policy: AgentToolPolicy,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const definition = TOOL_DEFINITIONS.find((tool) => tool.name === toolName);
    if (!definition) {
      return { ok: false, error: 'TOOL_NOT_FOUND', audit_id: '', risk: 'execute' };
    }
    if (!policy.enabled || !policy.allowed_tools.includes(definition.name)) {
      return { ok: false, error: 'TOOL_NOT_ALLOWED_FOR_AGENT', audit_id: '', risk: definition.risk };
    }
    if (context.signal?.aborted) {
      return { ok: false, error: 'TOOL_RUN_CANCELLED', audit_id: '', risk: definition.risk };
    }

    const auditId = crypto.randomUUID();
    const startedAt = now();
    this.databaseInsertAudit(context, auditId, definition, input, startedAt);

    if (this.needsApproval(definition, policy)) {
      const approvalId = crypto.randomUUID();
      context.database.prepare(`
        INSERT INTO tool_approvals (
          id, project_id, run_id, agent_id, tool_name, input_json, reason, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        approvalId,
        context.project_id,
        context.run_id,
        context.agent_id,
        definition.name,
        JSON.stringify(input),
        `${definition.name} requires approval under policy ${policy.approval_mode}`,
        startedAt,
      );
      context.database.prepare(`
        UPDATE tool_audit_events SET status = 'waiting_approval', result_json = ?, ended_at = ? WHERE id = ?
      `).run(JSON.stringify({ approval_id: approvalId }), now(), auditId);
      return {
        ok: false,
        error: 'TOOL_APPROVAL_REQUIRED',
        approval_required: true,
        approval_id: approvalId,
        audit_id: auditId,
        risk: definition.risk,
      };
    }

    const localContext: LocalToolContext = {
      projectRoot: context.project_root,
      timeoutMs: 30_000,
    };
    const result = await executeLocalTool(definition.name, input, localContext);
    context.database.prepare(`
      UPDATE tool_audit_events
      SET status = ?, result_json = ?, ended_at = ?
      WHERE id = ?
    `).run(result.ok ? 'completed' : 'failed', JSON.stringify(result), now(), auditId);
    return { ...result, audit_id: auditId, risk: definition.risk };
  }

  private databaseInsertAudit(
    context: ToolExecutionContext,
    auditId: string,
    definition: ToolDefinition,
    input: Record<string, unknown>,
    startedAt: string,
  ): void {
    context.database.prepare(`
      INSERT INTO tool_audit_events (
        id, project_id, run_id, agent_id, tool_name, risk, status, input_json, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)
    `).run(
      auditId,
      context.project_id,
      context.run_id,
      context.agent_id,
      definition.name,
      definition.risk,
      JSON.stringify(input),
      startedAt,
    );
  }
}

export const toolRegistry = new ToolRegistry();
