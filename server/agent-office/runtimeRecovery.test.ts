import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from './database.js';
import { recoverInterruptedChatRuns } from './runtimeRecovery.js';
import { AgentRepositoryV2, AgentStateRepository, ChatRunRepository, ProviderRepositoryV2, ActivityRepository } from './v2DataModel.js';
import { ConversationRepository } from './conversationRepository.js';

describe('runtime recovery', () => {
  it('marks interrupted chat runs failed and returns stale agents to idle', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-recovery-'));
    const database = openAgentOfficeDatabase({
      dataDir,
      databasePath: path.join(dataDir, 'office.sqlite'),
      logLevel: 'silent',
    });
    try {
      const now = new Date().toISOString();
      database.connection.prepare(
        'INSERT INTO projects (id, name, root_path, git_enabled, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      ).run('p1', 'Project', path.join(dataDir, 'project'), now, now);
      const conversationId = new ConversationRepository(database.connection).ensureForProject('p1');

      const providers = new ProviderRepositoryV2(database.connection);
      providers.create({ id: 'provider', name: 'Provider', protocol_driver: 'openai_chat', auth_driver: 'none' });
      const model = providers.createModel('provider', { model_id: 'model', is_default: true });
      const agent = new AgentRepositoryV2(database.connection).create({
        id: 'agent', name: 'Agent', slug: 'agent', provider_id: 'provider', model_id: model.id,
      });
      const run = new ChatRunRepository(database.connection).create({
        conversation_id: conversationId,
        project_id: 'p1',
        agent_id: agent.id,
        provider_id: 'provider',
        model_id: model.id,
        status: 'running',
      });
      new AgentStateRepository(database.connection).upsert({
        agent_id: agent.id,
        project_id: 'p1',
        run_id: run.id,
        state: 'responding',
        activity: 'streaming',
        progress: 0.4,
      });

      const result = recoverInterruptedChatRuns(database.connection);
      expect(result).toEqual({ recovered_runs: 1, recovered_agents: 1 });

      const recovered = new ChatRunRepository(database.connection).get(run.id)!;
      expect(recovered.status).toBe('failed');
      expect(recovered.error).toMatchObject({ code: 'RUN_INTERRUPTED_BY_RESTART' });
      expect(recovered.metadata.recovered_after_restart).toBe(true);

      const state = new AgentStateRepository(database.connection).listForProject('p1')[0];
      expect(state).toMatchObject({ state: 'idle', run_id: null, progress: null });
      expect(new ActivityRepository(database.connection).listForRun(run.id)[0].type).toBe('run.recovered');

      expect(recoverInterruptedChatRuns(database.connection).recovered_runs).toBe(0);
    } finally {
      database.connection.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
