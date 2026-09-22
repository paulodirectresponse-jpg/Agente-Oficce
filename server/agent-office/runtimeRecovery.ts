import type { Database } from 'better-sqlite3';
import { ActivityRepository, AgentStateRepository, ChatRunRepository } from './v2DataModel.js';

export interface RecoveryResult {
  recovered_runs: number;
  recovered_agents: number;
}

export function recoverInterruptedChatRuns(database: Database): RecoveryResult {
  const rows = database.prepare(
    "SELECT id FROM chat_runs WHERE status IN ('running', 'created') ORDER BY started_at ASC",
  ).all() as Array<{ id: string }>;

  const runs = new ChatRunRepository(database);
  const activity = new ActivityRepository(database);
  const states = new AgentStateRepository(database);
  let recoveredAgents = 0;
  const recoveredAt = new Date().toISOString();

  const transaction = database.transaction(() => {
    for (const row of rows) {
      const run = runs.get(row.id);
      if (!run) continue;
      runs.update(run.id, {
        status: 'failed',
        ended_at: recoveredAt,
        error: {
          code: 'RUN_INTERRUPTED_BY_RESTART',
          message: 'The Agent Office runtime restarted before this run finished.',
        },
        metadata: {
          ...run.metadata,
          recovered_after_restart: true,
          recovered_at: recoveredAt,
        },
      });
      const staleApprovals = database.prepare(`
        UPDATE tool_approvals
        SET status = 'denied', resolved_at = ?
        WHERE run_id = ? AND status IN ('pending', 'approved')
      `).run(recoveredAt, run.id);

      database.prepare(`
        UPDATE tool_audit_events
        SET status = 'failed',
            result_json = '{"ok":false,"error":"RUN_INTERRUPTED_BY_RESTART"}',
            ended_at = ?
        WHERE run_id = ? AND status IN ('running', 'waiting_approval')
      `).run(recoveredAt, run.id);

      activity.append({
        project_id: run.project_id,
        conversation_id: run.conversation_id,
        run_id: run.id,
        agent_id: run.agent_id,
        type: 'run.recovered',
        severity: 'warning',
        title: 'Execução recuperada após reinício',
        detail: 'A execução anterior foi encerrada como falha porque o runtime reiniciou.',
        payload: { recovered_at: recoveredAt, invalidated_tool_approvals: staleApprovals.changes },
      });
    }

    database.prepare(`
      DELETE FROM project_run_locks
      WHERE run_id IN (
        SELECT id FROM chat_runs WHERE status NOT IN ('created', 'running')
      )
      OR NOT EXISTS (
        SELECT 1 FROM runs WHERE runs.id = project_run_locks.run_id AND runs.status IN ('started', 'running')
      )
    `).run();

    const activeStates = database.prepare(
      "SELECT agent_id, project_id FROM agent_states WHERE run_id IS NOT NULL OR state NOT IN ('idle', 'offline', 'resting')",
    ).all() as Array<{ agent_id: string; project_id: string | null }>;

    const seen = new Set<string>();
    for (const state of activeStates) {
      const key = `${state.agent_id}:${state.project_id ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      states.upsert({
        agent_id: state.agent_id,
        project_id: state.project_id,
        run_id: null,
        state: 'idle',
        activity: '',
        progress: null,
      });
      recoveredAgents += 1;
    }
  });
  transaction();

  return { recovered_runs: rows.length, recovered_agents: recoveredAgents };
}
