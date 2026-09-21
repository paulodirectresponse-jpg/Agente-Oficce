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

  it('keeps provider raw payloads alongside normalized values', () => {
    const tracker = new UsageTracker(database.connection);
    tracker.record({ agentId: 'claude', provider: 'claude-gateway', source: 'provider', raw: { quota_percent: 77 }, normalized: { input_tokens: 10 } });
    const row = database.connection.prepare('SELECT raw_json, normalized_json FROM usage_snapshots').get() as { raw_json: string; normalized_json: string };
    expect(JSON.parse(row.raw_json)).toEqual({ quota_percent: 77 });
    expect(JSON.parse(row.normalized_json)).toEqual({ input_tokens: 10 });
  });
});
