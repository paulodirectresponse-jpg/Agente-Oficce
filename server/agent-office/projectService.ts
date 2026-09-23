import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { WorkspaceService } from './workspaceService.js';
import { TeamService } from './teamService.js';

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function json<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function durationMs(started: string | null | undefined, ended: string | null | undefined): number {
  if (!started) return 0;
  const start = Date.parse(started);
  const end = ended ? Date.parse(ended) : Date.now();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

export type ProjectLifecycle = 'active' | 'paused' | 'completed' | 'archived';

export interface ProjectPatch {
  name?: string;
  objective?: string;
  lifecycle_status?: ProjectLifecycle;
  metadata?: Record<string, unknown>;
}

export class ProjectService {
  constructor(private readonly db: Database) {}

  private projectRow(projectId: string): any {
    const row = this.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) as any;
    if (!row) throw new Error('PROJECT_NOT_FOUND');
    return row;
  }

  private normalizeProject(row: any) {
    return {
      ...row,
      git_enabled: Boolean(row.git_enabled),
      objective: row.objective ?? '',
      lifecycle_status: row.lifecycle_status ?? 'active',
      metadata: json(row.metadata_json, {}),
    };
  }

  private counts(projectId: string) {
    const runCounts = this.db.prepare(`
      SELECT
        COUNT(*) total,
        SUM(CASE WHEN parent_run_id IS NULL THEN 1 ELSE 0 END) root_runs,
        SUM(CASE WHEN status IN ('created','running') THEN 1 ELSE 0 END) active
      FROM chat_runs WHERE project_id=?
    `).get(projectId) as any;
    const planCounts = this.db.prepare(`
      SELECT COUNT(*) total,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
        SUM(CASE WHEN status IN ('validated','running') THEN 1 ELSE 0 END) active,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
      FROM execution_plans WHERE project_id=?
    `).get(projectId) as any;
    const stepCounts = this.db.prepare(`
      SELECT
        COUNT(*) total,
        SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) completed,
        SUM(CASE WHEN s.status='running' THEN 1 ELSE 0 END) running,
        SUM(CASE WHEN s.status='blocked' THEN 1 ELSE 0 END) blocked,
        SUM(CASE WHEN s.status IN ('queued','ready') THEN 1 ELSE 0 END) queued,
        SUM(CASE WHEN s.status='failed' THEN 1 ELSE 0 END) failed
      FROM execution_steps s
      JOIN execution_plans p ON p.id=s.plan_id
      WHERE p.project_id=? AND p.status <> 'superseded'
    `).get(projectId) as any;
    const blockerCounts = this.db.prepare(`
      SELECT COUNT(*) total,
        SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) open
      FROM project_blockers WHERE project_id=?
    `).get(projectId) as any;
    const artifactCount = (this.db.prepare(`
      SELECT COUNT(*) n FROM execution_artifacts a
      JOIN execution_plans p ON p.id=a.plan_id
      WHERE p.project_id=?
    `).get(projectId) as any)?.n ?? 0;
    return {
      runs: { total: Number(runCounts?.total ?? 0), root: Number(runCounts?.root_runs ?? 0), active: Number(runCounts?.active ?? 0) },
      plans: { total: Number(planCounts?.total ?? 0), completed: Number(planCounts?.completed ?? 0), active: Number(planCounts?.active ?? 0), failed: Number(planCounts?.failed ?? 0) },
      steps: {
        total: Number(stepCounts?.total ?? 0),
        completed: Number(stepCounts?.completed ?? 0),
        running: Number(stepCounts?.running ?? 0),
        blocked: Number(stepCounts?.blocked ?? 0),
        queued: Number(stepCounts?.queued ?? 0),
        failed: Number(stepCounts?.failed ?? 0),
      },
      blockers: { total: Number(blockerCounts?.total ?? 0), open: Number(blockerCounts?.open ?? 0) },
      artifacts: Number(artifactCount),
    };
  }

  private operationalState(project: any, counts: any): string {
    if (project.lifecycle_status === 'archived') return 'archived';
    if (project.lifecycle_status === 'completed') return 'completed';
    if (project.lifecycle_status === 'paused') return 'paused';
    const pendingApproval = this.db.prepare("SELECT 1 FROM tool_approvals WHERE project_id=? AND status='pending' LIMIT 1").get(project.id);
    if (pendingApproval) return 'waiting_approval';
    if (counts.steps.blocked > 0 || counts.blockers.open > 0) return 'blocked';
    if (counts.runs.active > 0 || counts.plans.active > 0 || counts.steps.running > 0) return 'running';
    const latestRun = this.db.prepare('SELECT status FROM chat_runs WHERE project_id=? AND parent_run_id IS NULL ORDER BY started_at DESC LIMIT 1').get(project.id) as any;
    if (latestRun?.status === 'failed') return 'failed';
    return 'idle';
  }

  private lastActivityAt(projectId: string, fallback: string): string {
    const candidates = [
      (this.db.prepare('SELECT MAX(created_at) value FROM activity_events WHERE project_id=?').get(projectId) as any)?.value,
      (this.db.prepare('SELECT MAX(created_at) value FROM orchestration_events WHERE project_id=?').get(projectId) as any)?.value,
      (this.db.prepare('SELECT MAX(started_at) value FROM chat_runs WHERE project_id=?').get(projectId) as any)?.value,
      (this.db.prepare('SELECT MAX(updated_at) value FROM execution_plans WHERE project_id=?').get(projectId) as any)?.value,
      (this.db.prepare('SELECT MAX(created_at) value FROM project_decisions WHERE project_id=?').get(projectId) as any)?.value,
      (this.db.prepare('SELECT MAX(opened_at) value FROM project_blockers WHERE project_id=?').get(projectId) as any)?.value,
    ].filter(Boolean) as string[];
    candidates.sort();
    return candidates.length ? candidates[candidates.length - 1] : fallback;
  }

  summary(projectId: string) {
    const row = this.projectRow(projectId);
    const project = this.normalizeProject(row);
    const counts = this.counts(projectId);
    const activeRun = this.db.prepare("SELECT id,status,started_at FROM chat_runs WHERE project_id=? AND parent_run_id IS NULL AND status IN ('created','running') ORDER BY started_at DESC LIMIT 1").get(projectId) ?? null;
    const activePlan = this.db.prepare("SELECT id,status,goal,version,updated_at FROM execution_plans WHERE project_id=? AND status IN ('validated','running') ORDER BY updated_at DESC LIMIT 1").get(projectId) ?? null;
    return {
      project,
      operational_state: this.operationalState(project, counts),
      last_activity_at: this.lastActivityAt(projectId, project.updated_at),
      counts,
      active_run: activeRun,
      active_plan: activePlan,
    };
  }

  listSummaries() {
    const rows = this.db.prepare('SELECT id FROM projects ORDER BY updated_at DESC').all() as Array<{ id: string }>;
    return rows.map(row => this.summary(row.id));
  }

  update(projectId: string, patch: ProjectPatch) {
    const current = this.normalizeProject(this.projectRow(projectId));
    const name = patch.name === undefined ? current.name : String(patch.name).trim();
    if (!name) throw new Error('PROJECT_NAME_REQUIRED');
    const objective = patch.objective === undefined ? current.objective : String(patch.objective).trim();
    const lifecycle = patch.lifecycle_status ?? current.lifecycle_status;
    if (!['active','paused','completed','archived'].includes(lifecycle)) throw new Error('PROJECT_STATUS_INVALID');
    const timestamp = now();
    let completedAt = current.completed_at ?? null;
    let archivedAt = current.archived_at ?? null;
    if (lifecycle === 'completed' && current.lifecycle_status !== 'completed') completedAt = timestamp;
    if (lifecycle !== 'completed' && current.lifecycle_status === 'completed') completedAt = null;
    if (lifecycle === 'archived' && current.lifecycle_status !== 'archived') archivedAt = timestamp;
    if (lifecycle !== 'archived' && current.lifecycle_status === 'archived') archivedAt = null;
    const metadata = patch.metadata ?? current.metadata ?? {};
    this.db.prepare(`
      UPDATE projects
      SET name=?, objective=?, lifecycle_status=?, completed_at=?, archived_at=?, metadata_json=?, updated_at=?
      WHERE id=?
    `).run(name, objective, lifecycle, completedAt, archivedAt, JSON.stringify(metadata), timestamp, projectId);
    return this.summary(projectId);
  }

  private usage(projectId: string) {
    const runs = this.db.prepare('SELECT parent_run_id,input_tokens,output_tokens,started_at,ended_at,status FROM chat_runs WHERE project_id=?').all(projectId) as any[];
    let inputTokens = 0, outputTokens = 0, executionMs = 0;
    for (const run of runs) {
      inputTokens += Number(run.input_tokens ?? 0);
      outputTokens += Number(run.output_tokens ?? 0);
      if (!run.parent_run_id) executionMs += durationMs(run.started_at, run.ended_at);
    }
    const attempts = this.db.prepare(`
      SELECT a.usage_json
      FROM step_attempts a
      JOIN execution_steps s ON s.id=a.step_id
      JOIN execution_plans p ON p.id=s.plan_id
      WHERE p.project_id=?
    `).all(projectId) as any[];
    let costUsd = 0, costKnown = false, toolCalls = 0;
    for (const attempt of attempts) {
      const u = json<any>(attempt.usage_json, {});
      if (u.cost_usd !== undefined && u.cost_usd !== null) { costUsd += Number(u.cost_usd) || 0; costKnown = true; }
      toolCalls += Number(u.tool_calls ?? 0);
    }
    const project = this.projectRow(projectId);
    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      cost_usd: costKnown ? costUsd : null,
      tool_calls: toolCalls,
      execution_ms: executionMs,
      elapsed_ms: durationMs(project.created_at, project.completed_at ?? null),
      cost_complete: costKnown,
    };
  }

  private plans(projectId: string) {
    const rows = this.db.prepare('SELECT * FROM execution_plans WHERE project_id=? ORDER BY created_at DESC').all(projectId) as any[];
    return rows.map(plan => {
      const steps = this.db.prepare('SELECT status,resume_state FROM execution_steps WHERE plan_id=?').all(plan.id) as any[];
      const counts = { total: steps.length, completed: 0, running: 0, blocked: 0, queued: 0, failed: 0, cancelled: 0 };
      for (const step of steps) {
        if (step.status === 'completed') counts.completed++;
        else if (step.status === 'running') counts.running++;
        else if (step.status === 'blocked') counts.blocked++;
        else if (step.status === 'failed') counts.failed++;
        else if (step.status === 'cancelled') counts.cancelled++;
        else counts.queued++;
      }
      return { ...plan, budget: json(plan.budget_json, {}), progress: counts };
    });
  }

  private participants(projectId: string) {
    const agents = new Set<string>();
    const subagents = new Set<string>();
    const teams = new Set<string>();
    for (const row of this.db.prepare('SELECT agent_id FROM chat_runs WHERE project_id=? AND agent_id IS NOT NULL').all(projectId) as any[]) agents.add(row.agent_id);
    for (const row of this.db.prepare(`
      SELECT s.assigned_agent_id agent_id, s.assigned_team_id team_id
      FROM execution_steps s JOIN execution_plans p ON p.id=s.plan_id
      WHERE p.project_id=?
    `).all(projectId) as any[]) {
      if (row.agent_id) agents.add(row.agent_id);
      if (row.team_id && !String(row.team_id).startsWith('dyn-')) teams.add(row.team_id);
    }
    const workforceIds = (this.db.prepare(`
      SELECT id FROM dynamic_team_instances
      WHERE chat_run_id IN (SELECT id FROM chat_runs WHERE project_id=?)
         OR execution_plan_id IN (SELECT id FROM execution_plans WHERE project_id=?)
         OR orchestration_run_id IN (SELECT id FROM orchestration_runs WHERE project_id=?)
    `).all(projectId, projectId, projectId) as any[]).map(row => row.id);
    for (const workforceId of workforceIds) {
      for (const row of this.db.prepare('SELECT agent_id FROM dynamic_team_members WHERE dynamic_team_id=?').all(workforceId) as any[]) agents.add(row.agent_id);
      for (const row of this.db.prepare('SELECT subagent_id FROM workforce_subagent_members WHERE dynamic_team_id=?').all(workforceId) as any[]) subagents.add(row.subagent_id);
      for (const row of this.db.prepare('SELECT team_id FROM workforce_team_members WHERE dynamic_team_id=?').all(workforceId) as any[]) teams.add(row.team_id);
    }
    const agentRows = agents.size ? this.db.prepare(`SELECT id,name,slug,role FROM agents WHERE id IN (${[...agents].map(()=>'?').join(',')}) ORDER BY name`).all(...agents) : [];
    const subagentRows = subagents.size ? this.db.prepare(`SELECT id,name,slug,role,team_id,owner_agent_id FROM subagents WHERE id IN (${[...subagents].map(()=>'?').join(',')}) ORDER BY name`).all(...subagents) : [];
    const teamRows = teams.size ? this.db.prepare(`SELECT id,name,slug,purpose,owner_agent_id FROM teams WHERE id IN (${[...teams].map(()=>'?').join(',')}) ORDER BY name`).all(...teams) : [];
    return { agents: agentRows, subagents: subagentRows, teams: teamRows };
  }

  private workforces(projectId: string) {
    const rows = this.db.prepare(`
      SELECT DISTINCT d.id
      FROM dynamic_team_instances d
      LEFT JOIN chat_runs r ON r.id=d.chat_run_id
      LEFT JOIN execution_plans p ON p.id=d.execution_plan_id
      LEFT JOIN orchestration_runs o ON o.id=d.orchestration_run_id
      WHERE r.project_id=? OR p.project_id=? OR o.project_id=?
      ORDER BY d.created_at DESC
    `).all(projectId, projectId, projectId) as any[];
    const service = new TeamService(this.db);
    return rows.map(row => service.getWorkforce(row.id)).filter(Boolean);
  }

  private artifacts(projectId: string) {
    return (this.db.prepare(`
      SELECT a.* FROM execution_artifacts a
      JOIN execution_plans p ON p.id=a.plan_id
      WHERE p.project_id=?
      ORDER BY a.created_at DESC
    `).all(projectId) as any[]).map(row => ({ ...row, payload: json(row.payload_json, {}) }));
  }

  private timeline(projectId: string) {
    const items: any[] = [];
    for (const row of this.db.prepare('SELECT * FROM activity_events WHERE project_id=? ORDER BY created_at DESC LIMIT 400').all(projectId) as any[]) {
      items.push({ id: row.id, source: 'activity', type: row.type, severity: row.severity, title: row.title, detail: row.detail, created_at: row.created_at, payload: json(row.payload_json, {}) });
    }
    for (const row of this.db.prepare('SELECT * FROM orchestration_events WHERE project_id=? ORDER BY created_at DESC LIMIT 200').all(projectId) as any[]) {
      items.push({ id: row.id, source: 'orchestrator', type: row.event_type, severity: row.severity, title: row.title, detail: row.detail, created_at: row.created_at, payload: json(row.payload_json, {}) });
    }
    for (const row of this.db.prepare('SELECT * FROM project_decisions WHERE project_id=? ORDER BY created_at DESC LIMIT 200').all(projectId) as any[]) {
      items.push({ id: row.id, source: 'decision', type: 'project.decision', severity: 'info', title: row.title || 'Decisão', detail: row.decision, created_at: row.created_at, payload: { rationale: row.rationale, source_type: row.source_type, source_id: row.source_id } });
    }
    for (const row of this.db.prepare('SELECT * FROM project_blockers WHERE project_id=? ORDER BY opened_at DESC LIMIT 200').all(projectId) as any[]) {
      items.push({ id: row.id, source: 'blocker', type: row.status === 'open' ? 'project.blocker.opened' : 'project.blocker.resolved', severity: row.status === 'open' ? 'warning' : 'info', title: row.title, detail: row.detail, created_at: row.opened_at, payload: { status: row.status, resolved_at: row.resolved_at, resolution: row.resolution } });
    }
    return items.sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 500);
  }

  detail(projectId: string) {
    const summary = this.summary(projectId);
    const workspace = new WorkspaceService(this.db).snapshot(projectId);
    const runs = (this.db.prepare('SELECT * FROM chat_runs WHERE project_id=? AND parent_run_id IS NULL ORDER BY started_at DESC LIMIT 100').all(projectId) as any[]).map(row => ({ ...row, metadata: json(row.metadata_json, {}), error: json(row.error_json, null) }));
    const orchestrationRuns = (this.db.prepare('SELECT * FROM orchestration_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 100').all(projectId) as any[]).map(row => ({ ...row, decision: json(row.decision_json, {}), error: json(row.error_json, null) }));
    const decisions = this.db.prepare('SELECT * FROM project_decisions WHERE project_id=? ORDER BY created_at DESC').all(projectId);
    const blockers = this.db.prepare('SELECT * FROM project_blockers WHERE project_id=? ORDER BY CASE status WHEN \'open\' THEN 0 ELSE 1 END, opened_at DESC').all(projectId);
    const resultRow = this.db.prepare('SELECT * FROM project_results WHERE project_id=?').get(projectId) as any;
    const result = resultRow ? {
      ...resultRow,
      metadata: json(resultRow.metadata_json, {}),
      artifacts: this.db.prepare(`
        SELECT l.artifact_id,l.label,a.type,a.uri,a.payload_json,a.created_at
        FROM project_result_artifacts l
        JOIN execution_artifacts a ON a.id=l.artifact_id
        WHERE l.project_id=?
        ORDER BY l.created_at
      `).all(projectId).map((row: any) => ({ ...row, payload: json(row.payload_json, {}) })),
    } : null;
    return {
      ...summary,
      conversation: this.db.prepare('SELECT id,title,created_at,updated_at FROM conversations WHERE project_id=? LIMIT 1').get(projectId) ?? null,
      workspace,
      runs,
      orchestration_runs: orchestrationRuns,
      plans: this.plans(projectId),
      workforces: this.workforces(projectId),
      participants: this.participants(projectId),
      artifacts: this.artifacts(projectId),
      usage: this.usage(projectId),
      decisions,
      blockers,
      result,
      timeline: this.timeline(projectId),
    };
  }

  addDecision(projectId: string, input: any) {
    this.projectRow(projectId);
    const id = uid(), timestamp = now();
    const decision = String(input?.decision ?? '').trim();
    if (!decision) throw new Error('PROJECT_DECISION_REQUIRED');
    this.db.prepare(`
      INSERT INTO project_decisions(id,project_id,chat_run_id,execution_plan_id,execution_step_id,source_type,source_id,title,decision,rationale,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, projectId, input?.chat_run_id ?? null, input?.execution_plan_id ?? null, input?.execution_step_id ?? null, String(input?.source_type ?? 'manual'), input?.source_id ?? null, String(input?.title ?? '').trim(), decision, String(input?.rationale ?? '').trim(), timestamp);
    this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(timestamp, projectId);
    return this.db.prepare('SELECT * FROM project_decisions WHERE id=?').get(id);
  }

  addBlocker(projectId: string, input: any) {
    this.projectRow(projectId);
    const id = uid(), timestamp = now();
    const title = String(input?.title ?? '').trim();
    if (!title) throw new Error('PROJECT_BLOCKER_TITLE_REQUIRED');
    this.db.prepare(`
      INSERT INTO project_blockers(id,project_id,chat_run_id,execution_plan_id,execution_step_id,type,title,detail,status,opened_at)
      VALUES(?,?,?,?,?,?,?,?, 'open', ?)
    `).run(id, projectId, input?.chat_run_id ?? null, input?.execution_plan_id ?? null, input?.execution_step_id ?? null, String(input?.type ?? 'general'), title, String(input?.detail ?? '').trim(), timestamp);
    this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(timestamp, projectId);
    return this.db.prepare('SELECT * FROM project_blockers WHERE id=?').get(id);
  }

  resolveBlocker(projectId: string, blockerId: string, resolution = '') {
    this.projectRow(projectId);
    const timestamp = now();
    const changed = this.db.prepare(`
      UPDATE project_blockers SET status='resolved',resolved_at=?,resolution=?
      WHERE id=? AND project_id=? AND status='open'
    `).run(timestamp, String(resolution ?? '').trim(), blockerId, projectId).changes;
    if (!changed) throw new Error('PROJECT_BLOCKER_NOT_FOUND');
    this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(timestamp, projectId);
    return this.db.prepare('SELECT * FROM project_blockers WHERE id=?').get(blockerId);
  }

  saveResult(projectId: string, input: any) {
    this.projectRow(projectId);
    const timestamp = now();
    const summary = String(input?.summary ?? '').trim();
    const result = String(input?.result ?? '').trim();
    const status = String(input?.status ?? 'final');
    if (!['draft','final'].includes(status)) throw new Error('PROJECT_RESULT_STATUS_INVALID');
    const artifactIds = Array.isArray(input?.artifact_ids) ? [...new Set(input.artifact_ids.map(String))] : [];
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO project_results(project_id,status,summary,result,completed_at,completed_by,metadata_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id) DO UPDATE SET
          status=excluded.status,summary=excluded.summary,result=excluded.result,
          completed_at=excluded.completed_at,completed_by=excluded.completed_by,
          metadata_json=excluded.metadata_json,updated_at=excluded.updated_at
      `).run(projectId, status, summary, result, status === 'final' ? timestamp : null, String(input?.completed_by ?? 'user'), JSON.stringify(input?.metadata ?? {}), timestamp, timestamp);
      this.db.prepare('DELETE FROM project_result_artifacts WHERE project_id=?').run(projectId);
      const insert = this.db.prepare('INSERT INTO project_result_artifacts(project_id,artifact_id,label,created_at) VALUES(?,?,?,?)');
      for (const artifactId of artifactIds) {
        const valid = this.db.prepare(`
          SELECT 1 FROM execution_artifacts a JOIN execution_plans p ON p.id=a.plan_id
          WHERE a.id=? AND p.project_id=?
        `).get(artifactId, projectId);
        if (!valid) throw new Error('PROJECT_RESULT_ARTIFACT_INVALID');
        insert.run(projectId, artifactId, '', timestamp);
      }
      if (status === 'final' && input?.complete_project !== false) {
        this.db.prepare("UPDATE projects SET lifecycle_status='completed',completed_at=COALESCE(completed_at,?),updated_at=? WHERE id=?").run(timestamp, timestamp, projectId);
      } else {
        this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(timestamp, projectId);
      }
    });
    tx();
    return this.detail(projectId).result;
  }

  getActiveSelection() {
    const row = this.db.prepare("SELECT value_json FROM app_settings WHERE key='last_active_project_id'").get() as any;
    const projectId = json<string | null>(row?.value_json, null);
    return { project_id: projectId && this.db.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId) ? projectId : null };
  }

  setActiveSelection(projectId: string | null) {
    if (projectId !== null) this.projectRow(projectId);
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO app_settings(key,value_json,updated_at) VALUES('last_active_project_id',?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at
    `).run(JSON.stringify(projectId), timestamp);
    return { project_id: projectId };
  }
}
