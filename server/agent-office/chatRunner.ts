import type { Database } from 'better-sqlite3';
import type { SecretStore } from './secretStore.js';
import { ConversationRepository, MessageRepository, type AgentOfficeMessage } from './conversationRepository.js';
import { MemoryRepository, estimateTokens } from './memory.js';
import { classifyTask, type TaskCategory } from './router.js';
import { UsageTracker } from './usageTracker.js';
import {
  ActivityRepository,
  AgentRepositoryV2,
  AgentStateRepository,
  ChatRunRepository,
  ProviderRepositoryV2,
  type Agent,
  type ChatRun,
  type Provider,
  type ProviderModel,
} from './v2DataModel.js';
import {
  UniversalProviderEngine,
  type UniversalCompletionInput,
  type UniversalMessage,
  type UniversalUsage,
} from './universalProviderEngine.js';
import { chatEventHub, type ChatEventHub } from './chatEventHub.js';

export type ChatTarget = 'auto' | 'team' | string;

export interface PrepareChatRunInput {
  project_id: string;
  conversation_id?: string;
  message: string;
  target?: ChatTarget;
  model_override?: string;
}

export interface PreparedChatRun {
  run: ChatRun;
  conversation_id: string;
  selected_agents: string[];
  mode: 'single' | 'team';
  model_override?: string;
}

export interface ChatRunReceipt {
  run_id: string;
  conversation_id: string;
  selected_agents: string[];
  mode: 'single' | 'team';
  status: 'running';
  tools_enabled: false;
}

interface AgentBinding {
  agent: Agent;
  provider: Provider;
  model: ProviderModel;
}

interface AgentResult {
  text: string;
  usage?: UniversalUsage;
  message_id: string;
  child_run_id: string;
}

const CHAT_CONTEXT_TOKEN_BUDGET = 24_000;
const RETRIEVED_MEMORY_LIMIT = 6;
const RECENT_MESSAGE_LIMIT = 30;
const HANDOFF_TEXT_LIMIT = 12_000;

const CATEGORY_ROLE_TERMS: Record<TaskCategory, string[]> = {
  ui_visual: ['ui', 'ux', 'visual', 'design', 'frontend'],
  frontend_logic: ['frontend', 'react', 'interface', 'ui'],
  backend: ['backend', 'server', 'api'],
  database: ['database', 'banco', 'sql', 'dados'],
  auth_security: ['security', 'segurança', 'auth', 'arquitet'],
  billing_credits: ['billing', 'pagamento', 'finance', 'arquitet'],
  integration: ['integration', 'integração', 'api', 'provider'],
  testing: ['test', 'qa', 'review', 'revis'],
  code_review: ['review', 'revis', 'qa'],
  architecture: ['architect', 'arquitet', 'plan', 'estrateg'],
  debugging: ['debug', 'diagn', 'backend', 'engineer'],
  documentation: ['document', 'writer', 'review'],
  exploration: ['research', 'pesquis', 'analysis', 'anális', 'plan'],
  devops: ['devops', 'deploy', 'infra', 'release'],
  unknown: [],
};

function asMetadata(message: AgentOfficeMessage): Record<string, unknown> {
  try {
    return JSON.parse(message.metadata_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function trimToChars(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n[truncated]`;
}

function stateForStage(stage: string): string {
  if (stage === 'planner') return 'planning';
  if (stage === 'reviewer') return 'reviewing';
  return 'responding';
}

function stageInstruction(stage: string, previousText: string): string {
  if (stage === 'planner') {
    return [
      'You are the planning stage of a multi-agent response.',
      'Analyze the user request and produce a concise actionable plan for the next agent.',
      'Do not claim to execute tools or change files.',
    ].join('\n');
  }
  if (stage === 'reviewer') {
    return [
      'You are the final reviewer in a multi-agent response.',
      'Review the previous draft for correctness, completeness, clarity and contradictions.',
      'Return the improved final answer that should be shown to the user, not a review report.',
      previousText ? `Previous draft:\n${trimToChars(previousText, HANDOFF_TEXT_LIMIT)}` : '',
    ].filter(Boolean).join('\n\n');
  }
  if (previousText) {
    return [
      'You are the primary responder in a multi-agent response.',
      'Use the previous agent plan as internal guidance and answer the user request directly.',
      `Previous plan/handoff:\n${trimToChars(previousText, HANDOFF_TEXT_LIMIT)}`,
    ].join('\n\n');
  }
  return 'Answer the user request directly, accurately and concisely.';
}

function normalizeTarget(target: ChatTarget | undefined): string {
  const value = typeof target === 'string' ? target.trim() : '';
  if (!value) return 'auto';
  if (value.startsWith('@')) return value.slice(1);
  return value;
}

function messageTextForContext(message: AgentOfficeMessage): UniversalMessage | null {
  if (message.role === 'event') return null;
  const role = message.role === 'system'
    ? 'system'
    : message.role === 'assistant'
      ? 'assistant'
      : 'user';
  return { role, content: message.content };
}

function sumUsage(values: Array<UniversalUsage | undefined>): UniversalUsage {
  let input = 0;
  let output = 0;
  let hasInput = false;
  let hasOutput = false;
  for (const usage of values) {
    if (usage?.input_tokens !== undefined) {
      input += usage.input_tokens;
      hasInput = true;
    }
    if (usage?.output_tokens !== undefined) {
      output += usage.output_tokens;
      hasOutput = true;
    }
  }
  return {
    ...(hasInput ? { input_tokens: input } : {}),
    ...(hasOutput ? { output_tokens: output } : {}),
  };
}

export class ChatRunnerService {
  private readonly conversations: ConversationRepository;
  private readonly messages: MessageRepository;
  private readonly memory: MemoryRepository;
  private readonly providers: ProviderRepositoryV2;
  private readonly agents: AgentRepositoryV2;
  private readonly runs: ChatRunRepository;
  private readonly activity: ActivityRepository;
  private readonly states: AgentStateRepository;
  private readonly usage: UsageTracker;
  private readonly engine: UniversalProviderEngine;

  constructor(
    private readonly database: Database,
    secrets: SecretStore,
    private readonly hub: ChatEventHub = chatEventHub,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.conversations = new ConversationRepository(database);
    this.messages = new MessageRepository(database);
    this.memory = new MemoryRepository(database);
    this.providers = new ProviderRepositoryV2(database);
    this.agents = new AgentRepositoryV2(database);
    this.runs = new ChatRunRepository(database);
    this.activity = new ActivityRepository(database);
    this.states = new AgentStateRepository(database);
    this.usage = new UsageTracker(database);
    this.engine = new UniversalProviderEngine(database, secrets, fetchImpl);
  }

  prepare(input: PrepareChatRunInput): PreparedChatRun {
    const projectId = input.project_id.trim();
    if (!projectId) throw new Error('CHAT_PROJECT_REQUIRED');
    const projectExists = this.database.prepare('SELECT 1 AS ok FROM projects WHERE id = ?').get(projectId);
    if (!projectExists) throw new Error('CHAT_PROJECT_NOT_FOUND');

    const message = input.message.trim();
    if (!message) throw new Error('CHAT_MESSAGE_REQUIRED');

    const conversationId = input.conversation_id
      ? this.requireConversation(input.conversation_id, projectId)
      : this.conversations.ensureForProject(projectId);

    const target = normalizeTarget(input.target);
    const available = this.availableBindings();
    if (!available.length) throw new Error('CHAT_NO_AVAILABLE_AGENTS');

    const selected = target === 'team'
      ? this.selectTeam(available, message)
      : [this.selectSingle(available, message, target)];

    const userMessage = this.messages.create({
      conversation_id: conversationId,
      role: 'user',
      content: message,
      metadata: {
        source: 'chat_v2',
        target,
        tools_enabled: false,
      },
    });

    const mode = target === 'team' ? 'team' : 'single';
    if (mode === 'team' && input.model_override) throw new Error('CHAT_MODEL_OVERRIDE_TEAM_UNSUPPORTED');
    const first = selected[0];
    const run = this.runs.create({
      conversation_id: conversationId,
      project_id: projectId,
      agent_id: mode === 'single' ? first.agent.id : null,
      provider_id: mode === 'single' ? first.provider.id : null,
      model_id: mode === 'single' ? this.resolveModel(first, input.model_override).id : null,
      status: 'running',
      mode,
      metadata: {
        source: 'chat_v2',
        target,
        selected_agents: selected.map((binding) => binding.agent.id),
        user_message_id: userMessage.id,
        tools_enabled: false,
        model_override: input.model_override ?? null,
      },
    });

    this.emit(run, 'run.created', 'Chat iniciado', {
      mode,
      target,
      selected_agents: selected.map((binding) => binding.agent.id),
      tools_enabled: false,
    });

    return {
      run,
      conversation_id: conversationId,
      selected_agents: selected.map((binding) => binding.agent.id),
      mode,
      model_override: input.model_override,
    };
  }

  receipt(prepared: PreparedChatRun): ChatRunReceipt {
    return {
      run_id: prepared.run.id,
      conversation_id: prepared.conversation_id,
      selected_agents: prepared.selected_agents,
      mode: prepared.mode,
      status: 'running',
      tools_enabled: false,
    };
  }

  async execute(prepared: PreparedChatRun): Promise<void> {
    const rootRun = prepared.run;
    const selected = prepared.selected_agents.map((agentId) => this.requireBinding(agentId));
    const stageResults: AgentResult[] = [];

    try {
      for (let index = 0; index < selected.length; index += 1) {
        const binding = selected[index];
        const stage = this.stageFor(prepared.mode, selected, index);
        const previous = stageResults.length ? stageResults[stageResults.length - 1].text : '';
        const model = this.resolveModel(binding, prepared.model_override);

        if (index > 0) {
          const fromAgent = selected[index - 1].agent;
          this.emit(rootRun, 'handoff.created', `Handoff ${fromAgent.name} → ${binding.agent.name}`, {
            from_agent: fromAgent.id,
            to_agent: binding.agent.id,
            from_message_id: stageResults.length ? stageResults[stageResults.length - 1].message_id : null,
            stage,
          });
        }

        const childRun = prepared.mode === 'team'
          ? this.runs.create({
            conversation_id: prepared.conversation_id,
            project_id: rootRun.project_id,
            agent_id: binding.agent.id,
            provider_id: binding.provider.id,
            model_id: model.id,
            status: 'running',
            mode: stage === 'reviewer' ? 'review' : 'single',
            parent_run_id: rootRun.id,
            metadata: { stage, tools_enabled: false },
          })
          : rootRun;

        try {
          const result = await this.runAgent({
            rootRun,
            childRun,
            binding: { ...binding, model },
            stage,
            previousText: previous,
            isFinal: index === selected.length - 1,
          });
          stageResults.push(result);
        } catch (error) {
          if (childRun.id !== rootRun.id) {
            this.runs.update(childRun.id, {
              status: 'failed',
              ended_at: new Date().toISOString(),
              error: { message: error instanceof Error ? error.message : 'CHAT_AGENT_RUN_FAILED' },
            });
          }
          throw error;
        }
      }

      const final = stageResults.length ? stageResults[stageResults.length - 1] : undefined;
      if (!final) throw new Error('CHAT_EMPTY_TEAM');

      const aggregate = sumUsage(stageResults.map((result) => result.usage));
      const finalMetadata = {
        ...rootRun.metadata,
        final_message_id: final.message_id,
        selected_agents: prepared.selected_agents,
        child_run_ids: stageResults.map((result) => result.child_run_id),
        tools_enabled: false,
      };
      this.runs.update(rootRun.id, {
        status: 'completed',
        ended_at: new Date().toISOString(),
        input_tokens: aggregate.input_tokens ?? null,
        output_tokens: aggregate.output_tokens ?? null,
        metadata: finalMetadata,
      });

      for (const binding of selected) {
        this.states.upsert({
          agent_id: binding.agent.id,
          project_id: rootRun.project_id,
          run_id: null,
          state: 'idle',
          activity: '',
          progress: null,
        });
        this.emit(rootRun, 'agent.state', `${binding.agent.name} está disponível`, {
          agent_id: binding.agent.id,
          state: 'idle',
          activity: '',
        });
      }

      this.emit(rootRun, 'run.completed', 'Resposta concluída', {
        final_message_id: final.message_id,
        final_agent_id: selected.length ? selected[selected.length - 1].agent.id : null,
        usage: aggregate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'CHAT_RUN_FAILED';
      this.runs.update(rootRun.id, {
        status: 'failed',
        ended_at: new Date().toISOString(),
        error: { message },
      });
      for (const binding of selected) {
        this.states.upsert({
          agent_id: binding.agent.id,
          project_id: rootRun.project_id,
          run_id: rootRun.id,
          state: 'error',
          activity: message,
          progress: null,
        });
      }
      this.emit(rootRun, 'run.failed', 'Falha na resposta', { message }, 'error');
    }
  }

  private requireConversation(conversationId: string, projectId: string): string {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.project_id !== projectId) throw new Error('CHAT_CONVERSATION_NOT_FOUND');
    return conversation.id;
  }

  private availableBindings(): AgentBinding[] {
    const result: AgentBinding[] = [];
    for (const agent of this.agents.list(false)) {
      if (!agent.provider_id || !agent.model_id) continue;
      const provider = this.providers.get(agent.provider_id);
      const model = this.providers.getModel(agent.model_id);
      if (!provider?.enabled || !model?.enabled || model.provider_id !== provider.id) continue;
      result.push({ agent, provider, model });
    }
    return result;
  }

  private requireBinding(agentId: string): AgentBinding {
    const agent = this.agents.get(agentId) ?? this.agents.getBySlug(agentId);
    if (!agent || !agent.enabled) throw new Error('CHAT_AGENT_NOT_FOUND');
    if (!agent.provider_id || !agent.model_id) throw new Error('CHAT_AGENT_NOT_CONFIGURED');
    const provider = this.providers.get(agent.provider_id);
    const model = this.providers.getModel(agent.model_id);
    if (!provider?.enabled) throw new Error('CHAT_PROVIDER_UNAVAILABLE');
    if (!model?.enabled || model.provider_id !== provider.id) throw new Error('CHAT_MODEL_UNAVAILABLE');
    return { agent, provider, model };
  }

  private resolveModel(binding: AgentBinding, override?: string): ProviderModel {
    if (!override) return binding.model;
    const direct = this.providers.getModel(override);
    if (direct?.enabled && direct.provider_id === binding.provider.id) return direct;
    const byExternalId = this.providers.listModels(binding.provider.id, false)
      .find((model) => model.model_id === override);
    if (byExternalId) return byExternalId;
    throw new Error('CHAT_MODEL_OVERRIDE_INVALID');
  }

  private selectSingle(available: AgentBinding[], message: string, target: string): AgentBinding {
    if (target !== 'auto') {
      const explicit = available.find((binding) => binding.agent.id === target || binding.agent.slug === target);
      if (!explicit) throw new Error('CHAT_AGENT_NOT_AVAILABLE');
      return explicit;
    }

    const category = classifyTask(message, '').category;
    const terms = CATEGORY_ROLE_TERMS[category];
    let best = available[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const binding of available) {
      const haystack = `${binding.agent.name} ${binding.agent.role} ${binding.agent.description}`.toLowerCase();
      const roleScore = terms.reduce((score, term) => score + (haystack.includes(term) ? 10 : 0), 0);
      const defaultBonus = binding.model.is_default ? 2 : 0;
      const orderPenalty = Math.max(0, binding.agent.sort_order) / 1000;
      const score = roleScore + defaultBonus - orderPenalty;
      if (score > bestScore) {
        best = binding;
        bestScore = score;
      }
    }
    return best;
  }

  private selectTeam(available: AgentBinding[], message: string): AgentBinding[] {
    const primary = this.selectSingle(available, message, 'auto');
    const planner = available.find((binding) => {
      const text = `${binding.agent.role} ${binding.agent.description}`.toLowerCase();
      return binding.agent.id !== primary.agent.id && /(plan|architect|arquitet|estrateg)/i.test(text);
    });
    const reviewer = available.find((binding) => {
      const text = `${binding.agent.role} ${binding.agent.description}`.toLowerCase();
      return binding.agent.id !== primary.agent.id && binding.agent.id !== planner?.agent.id && /(review|revis|qa|critic)/i.test(text);
    });

    const selected: AgentBinding[] = [];
    if (planner) selected.push(planner);
    selected.push(primary);
    if (reviewer) selected.push(reviewer);

    if (selected.length < 2 && available.length > 1) {
      const fallback = available.find((binding) => !selected.some((item) => item.agent.id === binding.agent.id));
      if (fallback) selected.push(fallback);
    }

    return selected.slice(0, 3);
  }

  private stageFor(mode: 'single' | 'team', selected: AgentBinding[], index: number): 'planner' | 'responder' | 'reviewer' {
    if (mode === 'single') return 'responder';
    if (selected.length >= 3) {
      if (index === 0) return 'planner';
      if (index === selected.length - 1) return 'reviewer';
      return 'responder';
    }
    if (selected.length === 2) {
      const firstText = `${selected[0].agent.role} ${selected[0].agent.description}`.toLowerCase();
      if (/(plan|architect|arquitet|estrateg)/i.test(firstText)) {
        return index === 0 ? 'planner' : 'responder';
      }
      return index === 0 ? 'responder' : 'reviewer';
    }
    return 'responder';
  }

  private buildMessages(
    projectId: string,
    conversationId: string,
    agent: Agent,
    stage: string,
    previousText: string,
  ): UniversalMessage[] {
    const projectMemory = this.memory.getProjectMemory(projectId);
    const recent = this.messages.list(conversationId, RECENT_MESSAGE_LIMIT);
    const currentUser = [...recent].reverse().find((message) => message.role === 'user')?.content ?? '';
    const retrieved = currentUser
      ? this.memory.search(projectId, currentUser, undefined, RETRIEVED_MEMORY_LIMIT)
      : [];

    const systemParts = [
      'You are an AI agent inside Agent Office.',
      'This is the API-only phase: you have no computer, filesystem, shell, browser, Git, deployment or external action tools.',
      'Never claim that you changed files, ran commands, published a site, or performed an external action.',
      'You may reason, plan, draft, review and answer in text.',
      agent.system_prompt.trim(),
      projectMemory?.summary ? `Project summary: ${projectMemory.summary}` : '',
      projectMemory?.architecture ? `Project architecture: ${projectMemory.architecture}` : '',
      projectMemory?.rules ? `Project rules: ${projectMemory.rules}` : '',
      projectMemory?.known_issues ? `Known issues: ${projectMemory.known_issues}` : '',
      retrieved.length
        ? `Relevant project memory:\n${retrieved.map((chunk) => `- [${chunk.kind}] ${chunk.text}`).join('\n')}`
        : '',
      stageInstruction(stage, previousText),
    ].filter(Boolean);

    const result: UniversalMessage[] = [{ role: 'system', content: systemParts.join('\n\n') }];
    for (const message of recent) {
      const normalized = messageTextForContext(message);
      if (normalized) result.push(normalized);
    }

    return this.trimMessages(result, CHAT_CONTEXT_TOKEN_BUDGET);
  }

  private trimMessages(messages: UniversalMessage[], budget: number): UniversalMessage[] {
    if (!messages.length) return [];
    const system = messages[0].role === 'system' ? messages[0] : null;
    const rest = system ? messages.slice(1) : messages.slice();
    const result: UniversalMessage[] = system ? [system] : [];
    let used = system ? estimateTokens(system.content) : 0;
    const kept: UniversalMessage[] = [];

    for (let index = rest.length - 1; index >= 0; index -= 1) {
      const tokens = estimateTokens(rest[index].content) + 8;
      if (used + tokens > budget && kept.length) break;
      if (used + tokens > budget) {
        const remainingChars = Math.max(200, (budget - used) * 4);
        kept.unshift({ ...rest[index], content: trimToChars(rest[index].content, remainingChars) });
        break;
      }
      kept.unshift(rest[index]);
      used += tokens;
    }

    result.push(...kept);
    return result;
  }

  private async runAgent(input: {
    rootRun: ChatRun;
    childRun: ChatRun;
    binding: AgentBinding;
    stage: 'planner' | 'responder' | 'reviewer';
    previousText: string;
    isFinal: boolean;
  }): Promise<AgentResult> {
    const { rootRun, childRun, binding, stage, previousText, isFinal } = input;
    const state = stateForStage(stage);
    this.states.upsert({
      agent_id: binding.agent.id,
      project_id: rootRun.project_id,
      run_id: rootRun.id,
      state: 'thinking',
      activity: 'Preparando contexto',
      progress: 0.05,
    });
    this.emit(rootRun, 'agent.state', `${binding.agent.name} está pensando`, {
      agent_id: binding.agent.id,
      state: 'thinking',
      activity: 'Preparando contexto',
      stage,
    });

    const messages = this.buildMessages(
      rootRun.project_id,
      rootRun.conversation_id,
      binding.agent,
      stage,
      previousText,
    );

    const completionInput: UniversalCompletionInput = {
      model: binding.model.model_id,
      messages,
      max_output_tokens: binding.model.max_output_tokens ?? undefined,
      metadata: {
        run_id: childRun.id,
        agent_id: binding.agent.id,
        tools_enabled: false,
      },
    };

    this.states.upsert({
      agent_id: binding.agent.id,
      project_id: rootRun.project_id,
      run_id: rootRun.id,
      state,
      activity: stage === 'reviewer' ? 'Revisando resposta' : stage === 'planner' ? 'Planejando resposta' : 'Respondendo',
      progress: 0.2,
    });
    this.emit(rootRun, 'agent.state', stage === 'reviewer'
      ? `${binding.agent.name} está revisando`
      : stage === 'planner'
        ? `${binding.agent.name} está planejando`
        : `${binding.agent.name} está respondendo`, {
      agent_id: binding.agent.id,
      state,
      stage,
      provider_id: binding.provider.id,
      model_id: binding.model.id,
      model: binding.model.model_id,
    });

    const startedAt = Date.now();
    let text = '';
    let usage: UniversalUsage | undefined;
    let finishReason: string | undefined;
    let deltaCount = 0;

    const streamingSupported = binding.model.capabilities.streaming !== false;
    if (streamingSupported) {
      try {
        for await (const event of this.engine.stream(binding.provider.id, completionInput)) {
          if (event.type === 'text_delta') {
            text += event.text;
            deltaCount += 1;
            this.hub.publish(rootRun.id, 'response.delta', {
              agent_id: binding.agent.id,
              child_run_id: childRun.id,
              stage,
              text: event.text,
            });
          } else if (event.type === 'usage') {
            usage = { ...usage, ...event.usage };
          } else if (event.type === 'completed') {
            finishReason = event.finish_reason;
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      } catch (error) {
        if (deltaCount > 0) throw error;
        this.emit(rootRun, 'response.streaming_fallback', `${binding.agent.name}: fallback sem streaming`, {
          agent_id: binding.agent.id,
          stage,
          reason: error instanceof Error ? error.message : 'stream_failed',
        }, 'warning');
        const result = await this.engine.complete(binding.provider.id, completionInput);
        text = result.text;
        usage = result.usage;
        finishReason = result.finish_reason;
        if (text) {
          this.hub.publish(rootRun.id, 'response.delta', {
            agent_id: binding.agent.id,
            child_run_id: childRun.id,
            stage,
            text,
            fallback: true,
          });
        }
      }
    } else {
      const result = await this.engine.complete(binding.provider.id, completionInput);
      text = result.text;
      usage = result.usage;
      finishReason = result.finish_reason;
      if (text) {
        this.hub.publish(rootRun.id, 'response.delta', {
          agent_id: binding.agent.id,
          child_run_id: childRun.id,
          stage,
          text,
          streaming: false,
        });
      }
    }

    const assistantMessage = this.messages.create({
      conversation_id: rootRun.conversation_id,
      role: 'assistant',
      agent_id: binding.agent.id,
      content: text,
      metadata: {
        source: 'chat_v2',
        root_run_id: rootRun.id,
        child_run_id: childRun.id,
        stage,
        provider_id: binding.provider.id,
        model_id: binding.model.id,
        model: binding.model.model_id,
        finish_reason: finishReason ?? null,
        final: isFinal,
        tools_enabled: false,
      },
    });

    const duration = Date.now() - startedAt;
    this.runs.update(childRun.id, {
      status: 'completed',
      ended_at: new Date().toISOString(),
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      metadata: {
        ...childRun.metadata,
        message_id: assistantMessage.id,
        finish_reason: finishReason ?? null,
        duration_ms: duration,
      },
    });

    this.usage.recordRunUsage(binding.agent.id, binding.provider.id, {
      input_tokens: usage?.input_tokens,
      output_tokens: usage?.output_tokens,
      request_count: 1,
      duration_ms: duration,
    });

    if (usage) {
      this.emit(rootRun, 'usage.updated', `Uso atualizado: ${binding.agent.name}`, {
        agent_id: binding.agent.id,
        provider_id: binding.provider.id,
        model_id: binding.model.id,
        usage,
        duration_ms: duration,
      });
    }

    this.emit(rootRun, 'response.completed', `${binding.agent.name} concluiu a resposta`, {
      agent_id: binding.agent.id,
      child_run_id: childRun.id,
      message_id: assistantMessage.id,
      stage,
      finish_reason: finishReason ?? null,
      usage: usage ?? null,
      final: isFinal,
    });

    return {
      text,
      usage,
      message_id: assistantMessage.id,
      child_run_id: childRun.id,
    };
  }

  private emit(
    run: ChatRun,
    event: string,
    title: string,
    payload: Record<string, unknown>,
    severity: 'debug' | 'info' | 'warning' | 'error' = 'info',
  ): void {
    this.activity.append({
      project_id: run.project_id,
      conversation_id: run.conversation_id,
      run_id: run.id,
      agent_id: typeof payload.agent_id === 'string' ? payload.agent_id : null,
      type: event,
      severity,
      title,
      detail: typeof payload.message === 'string' ? payload.message : '',
      payload,
    });
    this.hub.publish(run.id, event, payload);
  }
}
