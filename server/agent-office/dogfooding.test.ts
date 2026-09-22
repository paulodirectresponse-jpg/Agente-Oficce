import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase, closeAgentOfficeDatabase, type AgentOfficeDatabase } from './database.js';
import { TaskRunManager, type Task } from './taskRunManager.js';
import { TaskOrchestrator } from './orchestrator.js';
import { ContextPackBuilder, MemoryRepository } from './memory.js';
import { TaskRouter } from './router.js';
import { executeLocalTool } from './localTools.js';
import type { AgentAdapter, AgentEvent, AgentRunInput } from './adapterFramework.js';
import type { ToolRequest } from './providerProtocol.js';

// Modelo determinístico que executa as FERRAMENTAS LOCAIS REAIS.
function toolExecutingAdapter(id: 'kimi' | 'claude', root: string, script: (turn: number) => { tools?: Array<{ name: string; input: Record<string, unknown> }>; text?: string }): AgentAdapter {
  let turn = 0;
  return {
    id,
    async healthCheck() { return { status: 'healthy' as const }; },
    getCapabilities() { return { streaming: true, resume: false, tools: [] }; },
    async *startRun(_input: AgentRunInput): AsyncIterable<AgentEvent> {
      const step = script(turn);
      turn += 1;
      const stamp = () => new Date().toISOString();
      if (step.tools) {
        for (const tool of step.tools) {
          const request: ToolRequest = { id: `tu_${turn}_${tool.name}`, name: tool.name, input: tool.input };
          yield { type: 'tool_start', timestamp: stamp(), payload: { id: request.id, name: tool.name, input: tool.input } };
          const result = await executeLocalTool(tool.name as never, tool.input, { projectRoot: root });
          yield { type: 'tool_end', timestamp: stamp(), payload: { id: request.id, name: tool.name, ok: result.ok, ...(result.ok ? {} : { error: result.error }) } };
          yield { type: 'delta', timestamp: stamp(), payload: { text: `${tool.name}:${result.ok ? 'ok' : result.error}` } };
        }
        return;
      }
      yield { type: 'delta', timestamp: stamp(), payload: { text: step.text ?? 'done' } };
      yield { type: 'complete', timestamp: stamp(), payload: { success: true, usage: { input_tokens: 7, output_tokens: 3 } } };
    },
    async cancel() {},
  };
}

describe('Phase 14 dogfooding - controlled E2E (no external providers)', () => {
  let dataDir: string;
  let root: string;
  let database: AgentOfficeDatabase;
  let manager: TaskRunManager;

  afterEach(async () => {
    closeAgentOfficeDatabase(database);
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  });

  it('executes task, changes files, persists, hands off between agents, recovers from orphan run', async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-dog-data-'));
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-dog-root-'));
    await fs.writeFile(path.join(root, 'counter.js'), 'module.exports = 0;');
    await fs.writeFile(
      path.join(root, 'dog-write.mjs'),
      'import fs from "node:fs"; fs.writeFileSync("out.txt", "ran");',
    );
    database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    database.connection.prepare(`INSERT INTO projects (id, name, root_path, git_enabled, created_at, updated_at) VALUES ('p1', 'Dog', ?, 0, 't', 't')`).run(root);
    database.connection.prepare(`INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES ('c1', 'p1', 'C', 't', 't')`).run();

    const kimi = toolExecutingAdapter('kimi', root, turn =>
      turn === 0
        ? { tools: [
            { name: 'write_file', input: { path: 'solution.txt', content: 'kimi implementation' } },
            { name: 'node_script', input: { path: 'dog-write.mjs' } },
          ] }
        : { text: 'Kimi implemented and verified' },
    );
    const claude = toolExecutingAdapter('claude', root, turn =>
      turn === 0
        ? { tools: [{ name: 'read_file', input: { path: 'solution.txt' } }] }
        : { text: 'Claude reviewed the handoff and file' },
    );
    const codexStub: AgentAdapter = { id: 'codex', async healthCheck() { return { status: 'healthy' }; }, getCapabilities() { return { streaming: true, resume: false, tools: [] }; }, async *startRun() { yield { type: 'complete', timestamp: '', payload: {} }; }, async cancel() {} };
    const registry = new Map<string, AgentAdapter>([['kimi', kimi], ['claude', claude], ['codex', codexStub]]);
    manager = new TaskRunManager({ database: database.connection, adapterRegistry: registry, maxAutoAttempts: 3, maxAgentSwitches: 3 });

    // 1) Roteamento real: UI -> kimi; auth high-risk -> claude (codex ausente do registry)
    const router = new TaskRouter(registry);
    const d1 = router.decide({ title: 'Ajustar layout do botão', description: 'css layout' });
    expect(d1.agent).toBe('kimi');
    const d2 = router.decide({ title: 'Corrigir falha de segurança no login', description: 'auth token session' });
    expect(d2.agent).toBe('codex');
    expect(d2.protectedMode).toBe('unknown');
    const protectedRouter = new TaskRouter(registry, { reserveWeeklyPercent: 25, weeklyUsedPercent: 92 });
    expect(protectedRouter.decide({ title: 'auth fix', description: 'auth' }, 'codex').agent).toBe('codex');
    expect(protectedRouter.codexRestriction()).toBe('manual_only');

    // 2) Task executada por kimi com ferramentas reais (arquivo + comando)
    database.connection.prepare(`INSERT INTO tasks (id, project_id, conversation_id, title, description, category, risk, status, created_at, updated_at) VALUES ('t1', 'p1', 'c1', 'Implementar contador', 'criar solution.txt', 'ui_visual', 'low', 'queued', 't', 't')`).run();
    const packs: string[] = [];
    const orchestrator = new TaskOrchestrator({
      database: database.connection, manager, projectRoot: root,
      buildContextPack: (task, attempt, err) => {
        const pack = new ContextPackBuilder(database.connection).build({ projectId: 'p1', taskId: task.id, conversationId: 'c1', extraInstructions: err });
        packs.push(pack.text);
        return pack.text;
      },
    });
    const outcome1 = await orchestrator.executeTask('t1', 'kimi');
    expect(outcome1).toBe('completed');
    expect(await fs.readFile(path.join(root, 'solution.txt'), 'utf8')).toBe('kimi implementation');
    expect(await fs.readFile(path.join(root, 'out.txt'), 'utf8')).toBe('ran');

    // 3) Handoff kimi -> claude e injeção no contexto do próximo agente
    database.connection.prepare(`INSERT INTO tasks (id, project_id, conversation_id, title, description, category, risk, status, created_at, updated_at) VALUES ('t2', 'p1', 'c1', 'Revisar implementação', 'revisar solution', 'code_review', 'medium', 'queued', 't', 't')`).run();
    new MemoryRepository(database.connection).createHandoff({ taskId: 't2', fromAgent: 'kimi', toAgent: 'claude', summary: 'Contador implementado em solution.txt', files: ['solution.txt'] });
    const outcome2 = await orchestrator.executeTask('t2', 'claude');
    expect(outcome2).toBe('completed');
    expect(packs.some(pack => pack.includes('# LAST HANDOFF') && pack.includes('Contador implementado'))).toBe(true);

    // 4) Persistência: task, runs, eventos e memória no SQLite
    expect(manager.getTask('t1')?.status).toBe('completed');
    expect((database.connection.prepare('SELECT COUNT(*) AS c FROM runs').get() as { c: number }).c).toBe(4); // 2 runs por task (1º turno de tools, retry completou)
    expect((database.connection.prepare("SELECT COUNT(*) AS c FROM agent_office_events WHERE event_type = 'tool_end'").get() as { c: number }).c).toBeGreaterThanOrEqual(3);
    expect((database.connection.prepare("SELECT COUNT(*) AS c FROM memory_chunks WHERE kind = 'task_summary'").get() as { c: number }).c).toBe(2);
    expect((database.connection.prepare('SELECT COUNT(*) AS c FROM usage_snapshots').get() as { c: number }).c).toBe(2);

    // 5) Restart/retomada: novo manager sobre o mesmo banco + run órfão recuperado
    database.connection.prepare(`INSERT INTO tasks (id, project_id, conversation_id, title, description, category, risk, status, created_at, updated_at) VALUES ('t3', 'p1', 'c1', 'Task interrompida', 'crash', 'backend', 'medium', 'running', 't', 't')`).run();
    database.connection.prepare(`INSERT INTO runs (id, task_id, agent_id, status, started_at, input_summary) VALUES ('r-orphan', 't3', 'kimi', 'running', 't', 'crash')`).run();
    database.connection.prepare(`UPDATE tasks SET writer_lock = 'r-orphan' WHERE id = 't3'`).run();
    const restarted = new TaskRunManager({ database: database.connection, adapterRegistry: registry, maxAutoAttempts: 3, maxAgentSwitches: 3 });
    const { recoveredTasks } = await restarted.resumeAfterCrash();
    expect(recoveredTasks.map(task => task.id)).toEqual(['t3']);
    expect(restarted.getTask('t3')?.status).toBe('blocked');
    expect(restarted.getTask('t3')?.writer_lock).toBeNull();
    // task concluída sobrevive ao restart intacta
    expect(restarted.getTask('t1')?.status).toBe('completed');
  }, 30000);
});
