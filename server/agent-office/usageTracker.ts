import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';

export interface NormalizedUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_tokens?: number;
  cost_usd?: number;
  request_count?: number;
  duration_ms?: number;
}

export interface UsageSummary {
  agent_id: string;
  input_tokens: number;
  output_tokens: number;
  runs: number;
  cost_usd: number | null;
  average_duration_ms: number | null;
  window_days: number;
  has_data: boolean;
}

export class UsageTracker {
  constructor(private readonly database: Database) {}

  record(input: {
    agentId: string;
    provider: string;
    source: 'provider' | 'local' | 'run';
    raw?: Record<string, unknown>;
    normalized?: NormalizedUsage;
    projectId?: string | null;
    runId?: string | null;
    modelId?: string | null;
    costKind?: 'reported' | 'estimated' | 'unknown';
  }): void {
    this.database.prepare(`
      INSERT INTO usage_snapshots (
        id, agent_id, provider, source, raw_json, normalized_json, created_at,
        project_id, run_id, model_id, cost_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), input.agentId, input.provider, input.source,
      JSON.stringify(input.raw ?? {}), JSON.stringify(input.normalized ?? {}), new Date().toISOString(),
      input.projectId ?? null, input.runId ?? null, input.modelId ?? null, input.costKind ?? (input.normalized?.cost_usd == null ? 'unknown' : 'estimated'),
    );
  }

  recordRunUsage(
    agentId: string,
    provider: string,
    normalized: NormalizedUsage,
    trace: { projectId?: string | null; runId?: string | null; modelId?: string | null; costKind?: 'reported' | 'estimated' | 'unknown' } = {},
  ): void {
    this.record({ agentId, provider, source: 'run', normalized, ...trace });
  }

  summarize(agentId: string, windowDays = 30): UsageSummary {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.database.prepare(`
      SELECT normalized_json FROM usage_snapshots
      WHERE agent_id = ? AND source = 'run' AND created_at >= ?
    `).all(agentId, since) as Array<{ normalized_json: string }>;
    let inputTokens = 0;
    let outputTokens = 0;
    let runs = 0;
    let costUsd = 0;
    let hasCost = false;
    let durationMs = 0;
    let durationCount = 0;
    let hasData = false;
    for (const row of rows) {
      try {
        const usage = JSON.parse(row.normalized_json) as NormalizedUsage;
        if (Object.keys(usage).length) hasData = true;
        inputTokens += usage.input_tokens ?? 0;
        outputTokens += usage.output_tokens ?? 0;
        if (usage.request_count !== undefined || usage.duration_ms !== undefined) runs += usage.request_count ?? 1;
        if (usage.cost_usd !== undefined) {
          costUsd += usage.cost_usd;
          hasCost = true;
        }
        if (usage.duration_ms !== undefined) {
          durationMs += usage.duration_ms;
          durationCount += 1;
        }
      } catch {
        continue;
      }
    }
    return {
      agent_id: agentId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      runs,
      cost_usd: hasCost ? costUsd : null,
      average_duration_ms: durationCount ? Math.round(durationMs / durationCount) : null,
      window_days: windowDays,
      has_data: hasData,
    };
  }

  summarizeAll(windowDays = 30): UsageSummary[] {
    const agents = this.database.prepare('SELECT DISTINCT agent_id FROM usage_snapshots WHERE source = 'run'').all() as Array<{ agent_id: string }>;
    return agents.map(row => this.summarize(row.agent_id, windowDays));
  }
}
