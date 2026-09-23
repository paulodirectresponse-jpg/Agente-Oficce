import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SecretStore } from './secretStore.js';
import { openAgentOfficeDatabase } from './database.js';
import { ProviderRepositoryV2, AgentRepositoryV2, ChatRunRepository, ActivityRepository, AgentStateRepository } from './v2DataModel.js';
import { ChatRunnerService } from './chatRunner.js';
import { ChatEventHub } from './chatEventHub.js';
import { MessageRepository } from './conversationRepository.js';
import { AgentToolPolicyRepository } from './toolRegistry.js';

class MemorySecretStore implements SecretStore {
  private values = new Map<string, string>();
  async get(reference: string): Promise<string | null> { return this.values.get(reference) ?? null; }
  async set(reference: string, value: string): Promise<void> { this.values.set(reference, value); }
  async delete(reference: string): Promise<void> { this.values.delete(reference); }
}

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-chat-runner-'));
  const database = openAgentOfficeDatabase({
    dataDir,
    databasePath: path.join(dataDir, 'office.sqlite'),
    logLevel: 'silent',
  });
  const timestamp = new Date().toISOString();
  const projectRoot = path.join(dataDir, 'project-1');
  fs.mkdirSync(projectRoot, { recursive: true });
  database.connection.prepare(`
    INSERT INTO projects (id, name, root_path, git_enabled, git_branch, created_at, updated_at)
    VALUES ('project-1', 'Project 1', ?, 0, NULL, ?, ?)
  `).run(projectRoot, timestamp, timestamp);
  database.connection.prepare(`
    INSERT INTO project_memory (project_id, summary, architecture, rules, known_issues, updated_at)
    VALUES ('project-1', 'Project memory summary', 'TypeScript app', 'Be concise', '', ?)
  `).run(timestamp);

  return {
    dataDir,
    database,
    providers: new ProviderRepositoryV2(database.connection),
    agents: new AgentRepositoryV2(database.connection),
    hub: new ChatEventHub({ retentionMs: 60_000 }),
    secrets: new MemorySecretStore(),
    cleanup() {
      database.connection.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function sse(chunks: Array<Record<string, unknown>>): Response {
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(''),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function addProviderModelAgent(
  f: ReturnType<typeof fixture>,
  input: { providerId: string; agentId: string; role: string; sort: number; streaming?: boolean; tools?: boolean },
) {
  if (!f.providers.get(input.providerId)) {
    f.providers.create({
      id: input.providerId,
      name: input.providerId,
      protocol_driver: 'openai_chat',
      base_url: `https://${input.providerId}.example`,
      auth_driver: 'none',
    });
  }
  let model = f.providers.listModels(input.providerId).find((item) => item.model_id === 'model');
  if (!model) {
    model = f.providers.createModel(input.providerId, {
      model_id: 'model',
      display_name: 'Model',
      capabilities: { text: true, streaming: input.streaming !== false, tools: input.tools === true },
      is_default: true,
    });
  }
  return f.agents.create({
    id: input.agentId,
    name: input.agentId,
    slug: input.agentId,
    role: input.role,
    description: `${input.role} specialist`,
    provider_id: input.providerId,
    model_id: model.id,
    sort_order: input.sort,
  });
}

describe('ChatRunnerService', () => {
  it('runs a dynamic auto-selected agent with streaming, shared context and no tools', async () => {
    const f = fixture();
    addProviderModelAgent(f, { providerId: 'backend-provider', agentId: 'backend-agent', role: 'Backend Engineer', sort: 1 });

    let requestBody: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return sse([
        { choices: [{ delta: { content: 'Hello ' }, finish_reason: null }] },
        { choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 14, completion_tokens: 4 } },
      ]);
    };

    const service = new ChatRunnerService(f.database.connection, f.secrets, f.hub, fetchImpl);
    const prepared = service.prepare({
      project_id: 'project-1',
      message: 'Create a backend API plan',
      target: 'auto',
    });
    expect(prepared.selected_agents).toEqual(['backend-agent']);
    expect(service.receipt(prepared)).toMatchObject({ status: 'running', tools_enabled: false });

    await service.execute(prepared);

    const run = new ChatRunRepository(f.database.connection).get(prepared.run.id)!;
    expect(run.status).toBe('completed');
    expect(run.input_tokens).toBe(14);
    expect(run.output_tokens).toBe(4);
    expect(run.metadata.tools_enabled).toBe(false);

    const messages = new MessageRepository(f.database.connection).list(prepared.conversation_id);
    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'Create a backend API plan'],
      ['assistant', 'Hello world'],
    ]);
    const assistantMeta = JSON.parse(messages[1].metadata_json);
    expect(assistantMeta).toMatchObject({ final: true, tools_enabled: false });

    const bodyMessages = requestBody.messages as Array<{ role: string; content: string }>;
    expect(bodyMessages[0].role).toBe('system');
    expect(bodyMessages[0].content).toContain('You have no active computer tools for this run');
    expect(requestBody).not.toHaveProperty('tools');

    const events = f.hub.snapshot(prepared.run.id);
    expect(events.some((event) => event.event === 'response.delta')).toBe(true);
    expect(events[events.length - 1]?.event).toBe('run.completed');

    const state = new AgentStateRepository(f.database.connection).listForProject('project-1')[0];
    expect(state).toMatchObject({ agent_id: 'backend-agent', state: 'idle', run_id: null });
    f.cleanup();
  });

  it('uses non-streaming completion when model capabilities disable streaming', async () => {
    const f = fixture();
    addProviderModelAgent(f, { providerId: 'review-provider', agentId: 'reviewer-agent', role: 'Reviewer', sort: 1, streaming: false });

    let streamFlag: unknown;
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      streamFlag = body.stream;
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Reviewed answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const service = new ChatRunnerService(f.database.connection, f.secrets, f.hub, fetchImpl);
    const prepared = service.prepare({
      project_id: 'project-1',
      message: 'Review this text',
      target: '@reviewer-agent',
    });
    await service.execute(prepared);

    expect(streamFlag).toBe(false);
    const messages = new MessageRepository(f.database.connection).list(prepared.conversation_id);
    expect(messages[messages.length - 1].content).toBe('Reviewed answer');
    f.cleanup();
  });

  it('runs planner -> responder -> reviewer in team mode with handoffs and child runs', async () => {
    const f = fixture();
    addProviderModelAgent(f, { providerId: 'team-provider', agentId: 'planner', role: 'Architect Planner', sort: 1 });
    addProviderModelAgent(f, { providerId: 'team-provider', agentId: 'builder', role: 'Backend Engineer', sort: 2 });
    addProviderModelAgent(f, { providerId: 'team-provider', agentId: 'reviewer', role: 'QA Reviewer', sort: 3 });

    const outputs = ['Plan', 'Draft', 'Final answer'];
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      const text = outputs[call++];
      return sse([
        { choices: [{ delta: { content: text }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } },
      ]);
    };

    const service = new ChatRunnerService(f.database.connection, f.secrets, f.hub, fetchImpl);
    const prepared = service.prepare({
      project_id: 'project-1',
      message: 'Design a backend integration',
      target: 'team',
    });

    expect(prepared.selected_agents).toEqual(['planner', 'builder', 'reviewer']);
    await service.execute(prepared);

    const runs = new ChatRunRepository(f.database.connection).listForProject('project-1', 20);
    expect(runs).toHaveLength(4);
    const root = new ChatRunRepository(f.database.connection).get(prepared.run.id)!;
    expect(root.status).toBe('completed');
    expect(root.input_tokens).toBe(9);
    expect(root.output_tokens).toBe(3);
    expect((root.metadata.child_run_ids as string[])).toHaveLength(3);

    const activities = new ActivityRepository(f.database.connection).listForProject('project-1', 100);
    expect(activities.filter((event) => event.type === 'handoff.created')).toHaveLength(2);
    expect(activities.filter((event) => event.type === 'response.completed')).toHaveLength(3);

    const messages = new MessageRepository(f.database.connection).list(prepared.conversation_id);
    expect(messages.map((message) => message.content)).toEqual([
      'Design a backend integration',
      'Plan',
      'Draft',
      'Final answer',
    ]);
    const assistantMetadata = messages.slice(1).map((message) => JSON.parse(message.metadata_json));
    expect(assistantMetadata.map((metadata) => metadata.stage)).toEqual(['planner', 'responder', 'reviewer']);
    expect(assistantMetadata.map((metadata) => metadata.final)).toEqual([false, false, true]);
    f.cleanup();
  });

  it('falls back to non-streaming only when streaming fails before emitting text', async () => {
    const f = fixture();
    addProviderModelAgent(f, { providerId: 'fallback-provider', agentId: 'fallback-agent', role: 'Backend', sort: 1 });

    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('stream unavailable', { status: 501 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Fallback answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const service = new ChatRunnerService(f.database.connection, f.secrets, f.hub, fetchImpl);
    const prepared = service.prepare({
      project_id: 'project-1',
      message: 'Do the thing',
      target: 'fallback-agent',
    });
    await service.execute(prepared);

    expect(calls).toBe(2);
    expect(f.hub.snapshot(prepared.run.id).some((event) => event.event === 'response.streaming_fallback')).toBe(true);
    expect(new ChatRunRepository(f.database.connection).get(prepared.run.id)?.status).toBe('completed');
    f.cleanup();
  });

  it('rejects missing projects, unavailable agents and team model overrides before starting', () => {
    const f = fixture();
    addProviderModelAgent(f, { providerId: 'p', agentId: 'a', role: 'Backend', sort: 1 });
    const service = new ChatRunnerService(f.database.connection, f.secrets, f.hub, async () => {
      throw new Error('not called');
    });

    expect(() => service.prepare({ project_id: 'missing', message: 'hello' })).toThrow('CHAT_PROJECT_NOT_FOUND');
    expect(() => service.prepare({ project_id: 'project-1', message: 'hello', target: 'missing-agent' })).toThrow('CHAT_AGENT_NOT_AVAILABLE');
    expect(() => service.prepare({ project_id: 'project-1', message: 'hello', target: 'team', model_override: 'anything' }))
      .toThrow('CHAT_MODEL_OVERRIDE_TEAM_UNSUPPORTED');
    f.cleanup();
  });

  it('cancels an active chat run and returns the agent to idle', async () => {
    const f = fixture();
    addProviderModelAgent(f, { providerId: 'cancel-provider', agentId: 'cancel-agent', role: 'Backend', sort: 1 });

    const fetchImpl: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });

    const service = new ChatRunnerService(f.database.connection, f.secrets, f.hub, fetchImpl);
    const prepared = service.prepare({
      project_id: 'project-1',
      message: 'Long request',
      target: 'cancel-agent',
    });

    const controller = new AbortController();
    const execution = service.execute(prepared, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await execution;

    const run = new ChatRunRepository(f.database.connection).get(prepared.run.id)!;
    expect(run.status).toBe('cancelled');
    expect(run.error).toBeNull();
    expect(f.hub.snapshot(prepared.run.id).some((event) => event.event === 'run.cancelled')).toBe(true);
    const state = new AgentStateRepository(f.database.connection).listForProject('project-1')[0];
    expect(state).toMatchObject({ state: 'idle', run_id: null });
    f.cleanup();
  });


  it('uses adaptive Auto routing and only adds specialists when the request needs them', () => {
    const f = fixture();
    addProviderModelAgent(f, { providerId: 'route-provider', agentId: 'planner', role: 'Architect Planner', sort: 1 });
    addProviderModelAgent(f, { providerId: 'route-provider', agentId: 'integration', role: 'Integration API Engineer', sort: 2 });
    addProviderModelAgent(f, { providerId: 'route-provider', agentId: 'reviewer', role: 'QA Reviewer', sort: 3 });

    const service = new ChatRunnerService(f.database.connection, f.secrets, f.hub, async () => {
      throw new Error('not called');
    });

    const simple = service.prepare({
      project_id: 'project-1',
      message: 'Integre esta API ao backend.',
      target: 'auto',
    });
    expect(simple.mode).toBe('single');
    expect(simple.selected_agents).toEqual(['integration']);

    const complex = service.prepare({
      project_id: 'project-1',
      message: 'Planeje e implemente uma integração completa da API, valide os casos de erro e revise os testes antes de finalizar.',
      target: 'auto',
    });
    expect(complex.mode).toBe('team');
    expect(complex.selected_agents).toEqual(['planner', 'integration', 'reviewer']);
    f.cleanup();
  });

  it('executes enabled local tools through an OpenAI-compatible agent and audits the work', async () => {
    const f = fixture();
    const agent = addProviderModelAgent(f, {
      providerId: 'tools-provider',
      agentId: 'builder-tools',
      role: 'Backend Engineer',
      sort: 1,
      tools: true,
    });
    new AgentToolPolicyRepository(f.database.connection).save({
      agent_id: agent.id,
      enabled: true,
      allowed_tools: ['write_file', 'read_file'],
      approval_mode: 'safe',
      max_tool_steps: 5,
    });

    let call = 0;
    const bodies: Array<Record<string, any>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call-write',
                type: 'function',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({ path: 'hello.txt', content: 'feito pelo agente' }),
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Arquivo criado e confirmado.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 7, completion_tokens: 4 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const service = new ChatRunnerService(f.database.connection, f.secrets, f.hub, fetchImpl);
    const prepared = service.prepare({
      project_id: 'project-1',
      message: 'Crie hello.txt com a frase feito pelo agente.',
      target: agent.id,
    });
    expect(prepared.tools_enabled).toBe(true);

    await service.execute(prepared);

    expect(fs.readFileSync(path.join(f.dataDir, 'project-1', 'hello.txt'), 'utf8')).toBe('feito pelo agente');
    expect(bodies[0].tools.some((tool: any) => tool.function.name === 'write_file')).toBe(true);
    expect(bodies[1].messages.some((message: any) => message.role === 'tool' && message.tool_call_id === 'call-write')).toBe(true);

    const run = new ChatRunRepository(f.database.connection).get(prepared.run.id)!;
    expect(run.status).toBe('completed');
    expect(run.metadata.tools_enabled).toBe(true);
    const activities = new ActivityRepository(f.database.connection).listForRun(prepared.run.id);
    expect(activities.some((event) => event.type === 'tool.started')).toBe(true);
    expect(activities.some((event) => event.type === 'tool.completed')).toBe(true);

    const audit = f.database.connection.prepare('SELECT tool_name, status FROM tool_audit_events').get() as any;
    expect(audit).toMatchObject({ tool_name: 'write_file', status: 'completed' });
    f.cleanup();
  });

});
