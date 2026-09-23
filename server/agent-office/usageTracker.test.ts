import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase, closeAgentOfficeDatabase, type AgentOfficeDatabase } from './database.js';
import { UsageTracker } from './usageTracker.js';

describe('usage tracker', () => {
  let dataDir: string;
  let database: AgentOfficeDatabase;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-usage-'));
    database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
  });

  afterEach(async () => {
    closeAgentOfficeDatabase(database);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('aggregates recorded run usage per agent', () => {
    const tracker = new UsageTracker(database.connection);
    tracker.recordRunUsage('kimi', 'kimi', { input_tokens: 100, output_tokens: 50 });
    tracker.recordRunUsage('kimi', 'kimi', { input_tokens: 40, output_tokens: 10 });
    tracker.recordRunUsage('claude', 'claude', { input_tokens: 500, output_tokens: 300 });
    const kimi = tracker.summarize('kimi');
    expect(kimi.input_tokens).toBe(140);
    expect(kimi.output_tokens).toBe(60);
    expect(kimi.has_data).toBe(true);
    const all = tracker.summarizeAll();
    expect(all.map(summary => summary.agent_id).sort()).toEqual(['claude', 'kimi']);
  });

  it('reports empty state without fabricating values', () => {
    const tracker = new UsageTracker(database.connection);
    const summary = tracker.summarize('codex');
    expect(summary.has_data).toBe(false);
    expect(summary.input_tokens).toBe(0);
    expect(summary.runs).toBe(0);
  });

  it('persists project, run, model and cost provenance for run usage', () => {
    const tracker = new UsageTracker(database.connection);
    const now = new Date().toISOString();
    const dataRoot = path.join(dataDir, 'trace-project');
    return fs.mkdir(dataRoot, { recursive: true }).then(() => {
      database.connection.prepare("INSERT INTO projects(id,name,root_path,created_at,updated_at) VALUES('p-trace','Trace',?,?,?)").run(dataRoot, now, now);
      database.connection.prepare("INSERT INTO conversations(id,project_id,title,created_at,updated_at) VALUES('c-trace','p-trace','Main',?,?)").run(now, now);
      database.connection.prepare("INSERT INTO chat_runs(id,conversation_id,project_id,status,mode,started_at,metadata_json) VALUES('r-trace','c-trace','p-trace','completed','single',?,'{}')").run(now);
      tracker.recordRunUsage('kimi','kimi',{ input_tokens: 10, output_tokens: 5, cost_usd: 0.01 }, { projectId: 'p-trace', runId: 'r-trace', costKind: 'estimated' });
      const row = database.connection.prepare("SELECT project_id,run_id,cost_kind FROM usage_snapshots WHERE run_id='r-trace'").get();
      expect(row).toEqual({ project_id: 'p-trace', run_id: 'r-trace', cost_kind: 'estimated' });
    });
  });

  it('keeps provider raw payloads alongside normalized values', () => {
    const tracker = new UsageTracker(database.connection);
    tracker.record({ agentId: 'claude', provider: 'claude-gateway', source: 'provider', raw: { quota_percent: 77 }, normalized: { input_tokens: 10 } });
    const row = database.connection.prepare('SELECT raw_json, normalized_json FROM usage_snapshots').get() as { raw_json: string; normalized_json: string };
    expect(JSON.parse(row.raw_json)).toEqual({ quota_percent: 77 });
    expect(JSON.parse(row.normalized_json)).toEqual({ input_tokens: 10 });
  });
});
