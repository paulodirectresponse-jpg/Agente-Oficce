import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import {
  executeLocalTool,
  type LocalToolContext,
  type LocalToolName,
  type LocalToolResult,
} from './localTools.js';
import { redactSecrets, stableJson } from './securitySanitizer.js';

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
  idempotency_key?: string;
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
    name: 'npm_test',
    description: 'Run the project test suite without a shell.',
    risk: 'execute',
    default_enabled: true,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'npm_build',
    description: 'Run the project build script without a shell.',
    risk: 'execute',
    default_enabled: true,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'npm_install',
    description: 'Install project dependencies. This changes the dependency tree and always requires approval.',
    risk: 'execute',
    default_enabled: false,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'node_script',
    description: 'Run an existing JavaScript entrypoint inside the project root. Inline evaluation is forbidden.',
    risk: 'execute',
    default_enabled: false,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Existing .js/.mjs/.cjs file relative to project root.' },
        args: { type: 'array', items: { type: 'string' } },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_tests',
    description: 'Legacy alias for npm_test.',
    risk: 'execute',
    default_enabled: true,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run_command',
    description: 'Legacy restricted compatibility tool. Only Git status/diff and npm test/build are accepted; generic Node execution is denied.',
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
    const uniqueChildren = [...new Set(childAgentIds)];
    if (uniqueChildren.length !== childAgentIds.length) throw new Error('AGENT_RELATION_DUPLICATE');
    if (uniqueChildren.includes(parentAgentId)) throw new Error('AGENT_RELATION_SELF_CYCLE');

    const parent = this.database.prepare('SELECT id FROM agents WHERE id = ?').get(parentAgentId);
    if (!parent) throw new Error('AGENT_NOT_FOUND');
    for (const childId of uniqueChildren) {
      const child = this.database.prepare('SELECT id FROM agents WHERE id = ?').get(childId);
      if (!child) throw new Error('AGENT_RELATION_CHILD_NOT_FOUND');
    }

    const timestamp = now();
    const transaction = this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT parent_agent_id, child_agent_id
        FROM agent_relations
        WHERE enabled = 1 AND relation_type = 'supervises' AND parent_agent_id <> ?
      `).all(parentAgentId) as Array<{ parent_agent_id: string; child_agent_id: string }>;
      const graph = new Map<string, string[]>();
      for (const edge of existing) graph.set(edge.parent_agent_id, [...(graph.get(edge.parent_agent_id) ?? []), edge.child_agent_id]);
      graph.set(parentAgentId, uniqueChildren);

      const visit = (node: string, path: Set<string>, depth: number): void => {
        if (depth > 12) throw new Error('AGENT_RELATION_MAX_DEPTH');
        if (path.has(node)) throw new Error('AGENT_RELATION_CYCLE');
        const nextPath = new Set(path);
        nextPath.add(node);
        for (const child of graph.get(node) ?? []) visit(child, nextPath, depth + 1);
      };
      for (const node of graph.keys()) visit(node, new Set(), 0);

      this.database.prepare('DELETE FROM agent_relations WHERE parent_agent_id = ?').run(parentAgentId);
      const insert = this.database.prepare(`
        INSERT INTO agent_relations (
          parent_agent_id, child_agent_id, relation_type, enabled, priority, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'supervises', 1, ?, '{}', ?, ?)
      `);
      uniqueChildren.forEach((childId, index) => insert.run(parentAgentId, childId, index, timestamp, timestamp));
    });
    transaction();
  }
}

function auditInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  if (toolName === 'write_file') {
    return {
      path: input.path,
      content_bytes: Buffer.byteLength(String(input.content ?? '')),
    };
  }
  if (toolName === 'apply_patch') {
    return {
      path: input.path,
      old_text_bytes: Buffer.byteLength(String(input.old_text ?? '')),
      new_text_bytes: Buffer.byteLength(String(input.new_text ?? '')),
    };
  }
  return redactSecrets(input) as Record<string, unknown>;
}

function fingerprintInput(input: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(stableJson(input)).digest('hex');
}

function auditResult(toolName: string, result: LocalToolResult): Record<string, unknown> {
  if (!result.ok) return { ok: false, error: result.error ?? 'TOOL_FAILED' };
  const data = result.data ?? {};
  if (toolName === 'read_file') {
    return {
      ok: true,
      path: data.path,
      content_bytes: typeof data.content === 'string' ? Buffer.byteLength(data.content) : 0,
    };
  }
  if (toolName === 'git_diff' || toolName === 'git_status' || toolName === 'run_command' || toolName === 'run_tests' || toolName === 'npm_test' || toolName === 'npm_build' || toolName === 'npm_install' || toolName === 'node_script') {
    const stdout = typeof data.stdout === 'string' ? data.stdout : '';
    const stderr = typeof data.stderr === 'string' ? data.stderr : '';
    return {
      ok: true,
      stdout_bytes: Buffer.byteLength(stdout),
      stderr_bytes: Buffer.byteLength(stderr),
      executable: data.executable,
      args: data.args,
    };
  }
  return { ok: true, ...data };
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
    if (tool.name === 'npm_install' || tool.name === 'node_script' || tool.name === 'run_command') return true;
    if (policy.approval_mode === 'manual') return tool.risk !== 'read';
    if (policy.approval_mode === 'auto') return false;
    return false;
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

    const inputFingerprint = fingerprintInput(input);
    const idempotencyKey = context.idempotency_key?.trim() || null;
    if (idempotencyKey) {
      const existing = context.database.prepare(`
        SELECT id, status, result_json FROM tool_audit_events
        WHERE run_id = ? AND agent_id = ? AND idempotency_key = ?
      `).get(context.run_id, context.agent_id, idempotencyKey) as { id: string; status: string; result_json: string | null } | undefined;
      if (existing) {
        const pending = context.database.prepare(`
          SELECT id FROM tool_approvals
          WHERE run_id = ? AND agent_id = ? AND tool_name = ? AND input_fingerprint = ? AND status = 'pending'
          ORDER BY created_at DESC LIMIT 1
        `).get(context.run_id, context.agent_id, definition.name, inputFingerprint) as { id: string } | undefined;
        if (pending) {
          return { ok: false, error: 'TOOL_APPROVAL_REQUIRED', approval_required: true, approval_id: pending.id, audit_id: existing.id, risk: definition.risk };
        }
        if (existing.status === 'completed') {
          return { ok: true, data: { idempotent_replay: true }, audit_id: existing.id, risk: definition.risk };
        }
        return { ok: false, error: 'TOOL_IDEMPOTENCY_CONFLICT', audit_id: existing.id, risk: definition.risk };
      }
    }

    const auditId = crypto.randomUUID();
    const startedAt = now();
    this.databaseInsertAudit(context, auditId, definition, auditInput(definition.name, input), startedAt, idempotencyKey);

    if (this.needsApproval(definition, policy)) {
      const approvalId = crypto.randomUUID();
      context.database.prepare(`
        INSERT INTO tool_approvals (
          id, project_id, run_id, agent_id, tool_name, input_json, input_fingerprint, reason, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        approvalId,
        context.project_id,
        context.run_id,
        context.agent_id,
        definition.name,
        JSON.stringify(auditInput(definition.name, input)),
        inputFingerprint,
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
      signal: context.signal,
    };
    const result = await executeLocalTool(definition.name, input, localContext);
    context.database.prepare(`
      UPDATE tool_audit_events
      SET status = ?, result_json = ?, ended_at = ?
      WHERE id = ?
    `).run(result.ok ? 'completed' : 'failed', JSON.stringify(auditResult(definition.name, result)), now(), auditId);
    return { ...result, audit_id: auditId, risk: definition.risk };
  }

  async executeApproved(
    toolName: string,
    input: Record<string, unknown>,
    policy: AgentToolPolicy,
    context: ToolExecutionContext,
    approvalId: string,
    auditId: string,
  ): Promise<ToolExecutionResult> {
    const definition = TOOL_DEFINITIONS.find((tool) => tool.name === toolName);
    if (!definition) return { ok: false, error: 'TOOL_NOT_FOUND', audit_id: auditId, risk: 'execute' };
    if (!policy.enabled || !policy.allowed_tools.includes(definition.name)) {
      return { ok: false, error: 'TOOL_NOT_ALLOWED_FOR_AGENT', audit_id: auditId, risk: definition.risk };
    }

    const approval = context.database.prepare(`
      SELECT id, status, tool_name, run_id, agent_id, input_fingerprint
      FROM tool_approvals
      WHERE id = ?
    `).get(approvalId) as {
      id: string;
      status: string;
      tool_name: string;
      run_id: string | null;
      agent_id: string | null;
      input_fingerprint: string | null;
    } | undefined;

    if (!approval
      || approval.tool_name !== definition.name
      || approval.run_id !== context.run_id
      || approval.agent_id !== context.agent_id
      || approval.input_fingerprint !== fingerprintInput(input)) {
      return { ok: false, error: 'TOOL_APPROVAL_INVALID', audit_id: auditId, risk: definition.risk };
    }

    const run = context.database.prepare('SELECT status FROM chat_runs WHERE id = ?').get(context.run_id) as { status: string } | undefined;
    if (!run || !['created', 'running'].includes(run.status)) {
      return { ok: false, error: 'TOOL_RUN_NOT_ACTIVE', audit_id: auditId, risk: definition.risk };
    }

    const audit = context.database.prepare(`
      SELECT run_id, agent_id, tool_name, status FROM tool_audit_events WHERE id = ?
    `).get(auditId) as { run_id: string | null; agent_id: string | null; tool_name: string; status: string } | undefined;
    if (!audit || audit.run_id !== context.run_id || audit.agent_id !== context.agent_id || audit.tool_name !== definition.name) {
      return { ok: false, error: 'TOOL_AUDIT_INVALID', audit_id: auditId, risk: definition.risk };
    }
    if (audit.status === 'completed') {
      return { ok: true, data: { idempotent_replay: true }, audit_id: auditId, risk: definition.risk };
    }

    if (approval.status === 'denied') {
      context.database.prepare(`
        UPDATE tool_audit_events SET status = 'denied', result_json = ?, ended_at = ? WHERE id = ?
      `).run(JSON.stringify({ ok: false, error: 'TOOL_APPROVAL_DENIED' }), now(), auditId);
      return { ok: false, error: 'TOOL_APPROVAL_DENIED', audit_id: auditId, risk: definition.risk };
    }
    if (approval.status !== 'approved') {
      return {
        ok: false,
        error: 'TOOL_APPROVAL_REQUIRED',
        approval_required: true,
        approval_id: approvalId,
        audit_id: auditId,
        risk: definition.risk,
      };
    }
    if (context.signal?.aborted) {
      return { ok: false, error: 'TOOL_RUN_CANCELLED', audit_id: auditId, risk: definition.risk };
    }

    context.database.prepare(`
      UPDATE tool_audit_events SET status = 'running', result_json = NULL, ended_at = NULL WHERE id = ?
    `).run(auditId);

    const localContext: LocalToolContext = {
      projectRoot: context.project_root,
      timeoutMs: 30_000,
      signal: context.signal,
    };
    const result = await executeLocalTool(definition.name, input, localContext);
    context.database.prepare(`
      UPDATE tool_audit_events
      SET status = ?, result_json = ?, ended_at = ?
      WHERE id = ?
    `).run(result.ok ? 'completed' : 'failed', JSON.stringify(auditResult(definition.name, result)), now(), auditId);
    return { ...result, audit_id: auditId, risk: definition.risk };
  }

  private databaseInsertAudit(
    context: ToolExecutionContext,
    auditId: string,
    definition: ToolDefinition,
    input: Record<string, unknown>,
    startedAt: string,
    idempotencyKey: string | null,
  ): void {
    context.database.prepare(`
      INSERT INTO tool_audit_events (
        id, project_id, run_id, agent_id, tool_name, risk, status, input_json, started_at, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
    `).run(
      auditId,
      context.project_id,
      context.run_id,
      context.agent_id,
      definition.name,
      definition.risk,
      JSON.stringify(redactSecrets(input)),
      startedAt,
      idempotencyKey,
    );
  }
}

export const toolRegistry = new ToolRegistry();
