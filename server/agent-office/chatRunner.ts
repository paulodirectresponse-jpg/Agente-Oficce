import crypto from 'node:crypto';
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
import { ChatRunCancelledError } from './runtimeControls.js';
import { AgentToolPolicyRepository, toolRegistry } from './toolRegistry.js';
import { AgentOperationsService } from './agentOperations.js';
import { SubagentService } from './subagentService.js';
import { ResourceService } from './resourceService.js';

export type ChatTarget = 'auto' | 'team' | string;

export interface PrepareChatRunInput {
  project_id: string;
  conversation_id?: string;
  message: string;
  target?: ChatTarget;
  model_override?: string;
  selected_agent_ids?: string[];
  selected_subagent_ids?: string[];
  orchestration_run_id?: string;
  routing_level?: string;
  routing_decision?: Record<string, unknown>;
  attachment_ids?: string[];
}

export interface PreparedChatRun {
  run: ChatRun;
  conversation_id: string;
  selected_agents: string[];
  selected_subagents: string[];
  selected_workers: Array<{ kind: 'agent' | 'subagent'; id: string }>;
  mode: 'single' | 'team';
  model_override?: string;
  tools_enabled: boolean;
}

export interface ChatRunReceipt {
  run_id: string;
  conversation_id: string;
  selected_agents: string[];
  selected_subagents?: string[];
  mode: 'single' | 'team';
  status: 'running';
  tools_enabled: boolean;
}

interface AgentBinding {
  worker_kind: 'agent' | 'subagent';
  agent: Agent;
  provider: Provider;
  model: ProviderModel;
  owner_agent_id?: string;
  team_id?: string;
  subagent_id?: string;
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

function estimateCostUsd(model: ProviderModel, usage: UniversalUsage | undefined): number | undefined {
  if (!usage) return undefined;
  const pricing = model.pricing ?? {};
  const inputRate = typeof pricing.input_per_million === 'number'
    ? pricing.input_per_million
    : typeof pricing.input_per_1m === 'number'
      ? pricing.input_per_1m
      : undefined;
  const outputRate = typeof pricing.output_per_million === 'number'
    ? pricing.output_per_million
    : typeof pricing.output_per_1m === 'number'
      ? pricing.output_per_1m
      : undefined;
  if (inputRate === undefined && outputRate === undefined) return undefined;
  return ((usage.input_tokens ?? 0) / 1_000_000) * (inputRate ?? 0)
    + ((usage.output_tokens ?? 0) / 1_000_000) * (outputRate ?? 0);
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
  private readonly toolPolicies: AgentToolPolicyRepository;
  private readonly agentOps: AgentOperationsService;
  private readonly subagents: SubagentService;

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
    this.toolPolicies = new AgentToolPolicyRepository(database);
    this.agentOps = new AgentOperationsService(database);
    this.subagents = new SubagentService(database);
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

    const explicitAgents = (input.selected_agent_ids ?? []).map((agentId) => {
      const binding = available.find((item) => item.agent.id === agentId || item.agent.slug === agentId);
      if (!binding) throw new Error('CHAT_AGENT_NOT_AVAILABLE');
      return binding;
    });
    const explicitSubagents = (input.selected_subagent_ids ?? []).map((subagentId) => this.requireSubagentBinding(subagentId));
    const selected = explicitAgents.length || explicitSubagents.length
      ? [...explicitAgents, ...explicitSubagents]
      : target === 'team'
        ? this.selectTeam(available, message)
        : target === 'auto'
          ? this.selectAdaptive(available, message)
          : [this.selectSingle(available, message, target)];

    const toolsEnabled = selected.some((binding) => this.toolsAvailable(binding));

    const attachmentIds=(input.attachment_ids??[]).filter(Boolean);
    const resources=new ResourceService(this.database);
    const userMessage = this.messages.create({
      conversation_id: conversationId,
      role: 'user',
      content: message,
      metadata: {
        source: 'chat_v2',
        target,
        tools_enabled: toolsEnabled,
        attachment_ids: attachmentIds,
      },
    });
    resources.linkMessage(userMessage.id,attachmentIds);

    const mode = target === 'team' || selected.length > 1 ? 'team' : 'single';
    if (mode === 'team' && input.model_override) throw new Error('CHAT_MODEL_OVERRIDE_TEAM_UNSUPPORTED');
    const first = selected[0];
    const run = this.runs.create({
      conversation_id: conversationId,
      project_id: projectId,
      agent_id: mode === 'single' && first.worker_kind === 'agent' ? first.agent.id : null,
      provider_id: mode === 'single' ? first.provider.id : null,
      model_id: mode === 'single' ? this.resolveModel(first, input.model_override).id : null,
      status: 'running',
      mode,
      metadata: {
        source: 'chat_v2',
        target,
        selected_agents: selected.filter((binding) => binding.worker_kind === 'agent').map((binding) => binding.agent.id),
        selected_subagents: selected.filter((binding) => binding.worker_kind === 'subagent').map((binding) => binding.subagent_id!),
        selected_workers: selected.map((binding) => ({ kind: binding.worker_kind, id: binding.worker_kind === 'agent' ? binding.agent.id : binding.subagent_id! })),
        user_message_id: userMessage.id,
        tools_enabled: toolsEnabled,
        routing: target === 'auto' ? 'adaptive' : target,
        model_override: input.model_override ?? null,
        orchestration_run_id: input.orchestration_run_id ?? null,
        routing_level: input.routing_level ?? null,
        routing_decision: input.routing_decision ?? null,
      },
    });

    this.emit(run, 'run.created', 'Chat iniciado', {
      mode,
      target,
      selected_agents: selected.filter((binding) => binding.worker_kind === 'agent').map((binding) => binding.agent.id),
      selected_subagents: selected.filter((binding) => binding.worker_kind === 'subagent').map((binding) => binding.subagent_id!),
      tools_enabled: toolsEnabled,
    });

    return {
      run,
      conversation_id: conversationId,
      selected_agents: selected.filter((binding) => binding.worker_kind === 'agent').map((binding) => binding.agent.id),
      selected_subagents: selected.filter((binding) => binding.worker_kind === 'subagent').map((binding) => binding.subagent_id!),
      selected_workers: selected.map((binding) => ({ kind: binding.worker_kind, id: binding.worker_kind === 'agent' ? binding.agent.id : binding.subagent_id! })),
      mode,
      model_override: input.model_override,
      tools_enabled: toolsEnabled,
    };
  }

  receipt(prepared: PreparedChatRun): ChatRunReceipt {
    return {
      run_id: prepared.run.id,
      conversation_id: prepared.conversation_id,
      selected_agents: prepared.selected_agents,
      selected_subagents: prepared.selected_subagents,
      mode: prepared.mode,
      status: 'running',
      tools_enabled: prepared.tools_enabled,
    };
  }

  async execute(prepared: PreparedChatRun, signal?: AbortSignal): Promise<void> {
    const rootRun = prepared.run;
    const selected = prepared.selected_workers.map((worker) => worker.kind === 'agent' ? this.requireBinding(worker.id) : this.requireSubagentBinding(worker.id));
    const stageResults: AgentResult[] = [];

    try {
      for (let index = 0; index < selected.length; index += 1) {
        if (signal?.aborted) throw new ChatRunCancelledError();
        const binding = selected[index];
        const stage = this.stageFor(prepared.mode, selected, index);
        const previous = stageResults.length ? stageResults[stageResults.length - 1].text : '';
        const model = this.resolveModel(binding, prepared.model_override);

        if (index > 0) {
          const fromAgent = selected[index - 1].agent;
          this.emit(rootRun, 'handoff.created', `Handoff ${fromAgent.name} → ${binding.agent.name}`, {
            from_agent: selected[index - 1].worker_kind === 'agent' ? fromAgent.id : null,
            from_subagent: selected[index - 1].worker_kind === 'subagent' ? selected[index - 1].subagent_id : null,
            to_agent: binding.worker_kind === 'agent' ? binding.agent.id : null,
            to_subagent: binding.worker_kind === 'subagent' ? binding.subagent_id : null,
            from_message_id: stageResults.length ? stageResults[stageResults.length - 1].message_id : null,
            stage,
          });
        }

        const childRun = prepared.mode === 'team'
          ? this.runs.create({
            conversation_id: prepared.conversation_id,
            project_id: rootRun.project_id,
            agent_id: binding.worker_kind === 'agent' ? binding.agent.id : null,
            provider_id: binding.provider.id,
            model_id: model.id,
            status: 'running',
            mode: stage === 'reviewer' ? 'review' : 'single',
            parent_run_id: rootRun.id,
            metadata: {
              stage,
              tools_enabled: this.toolsAvailable({ ...binding, model }),
              worker_kind: binding.worker_kind,
              subagent_id: binding.subagent_id ?? null,
              owner_agent_id: binding.owner_agent_id ?? null,
              team_id: binding.team_id ?? null,
            },
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
            signal,
          });
          stageResults.push(result);
          this.recordWorkerPerformance(binding, childRun.id, rootRun.project_id, 'execution_success', 'Worker execution completed successfully.');
        } catch (error) {
          const cancelledStage = signal?.aborted
            || error instanceof ChatRunCancelledError
            || (error instanceof Error && error.message === 'CHAT_RUN_CANCELLED');
          this.recordWorkerPerformance(
            binding,
            childRun.id,
            rootRun.project_id,
            cancelledStage ? 'cancelled' : 'operational_failure',
            error instanceof Error ? error.message : 'CHAT_WORKER_RUN_FAILED',
          );
          if (childRun.id !== rootRun.id) {
            const cancelled = signal?.aborted
              || error instanceof ChatRunCancelledError
              || (error instanceof Error && error.message === 'CHAT_RUN_CANCELLED');
            this.runs.update(childRun.id, {
              status: cancelled ? 'cancelled' : 'failed',
              ended_at: new Date().toISOString(),
              error: cancelled ? null : { message: error instanceof Error ? error.message : 'CHAT_AGENT_RUN_FAILED' },
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
        selected_subagents: prepared.selected_subagents,
        child_run_ids: stageResults.map((result) => result.child_run_id),
        tools_enabled: prepared.tools_enabled,
      };
      this.runs.update(rootRun.id, {
        status: 'completed',
        ended_at: new Date().toISOString(),
        input_tokens: aggregate.input_tokens ?? null,
        output_tokens: aggregate.output_tokens ?? null,
        metadata: finalMetadata,
      });

      for (const binding of selected) {
        this.setWorkerState(binding, rootRun.project_id, null, 'idle', '', null);
        this.emit(rootRun, 'worker.state', `${binding.agent.name} está disponível`, {
          agent_id: binding.worker_kind === 'agent' ? binding.agent.id : null,
          subagent_id: binding.worker_kind === 'subagent' ? binding.subagent_id : null,
          worker_kind: binding.worker_kind,
          state: 'idle',
          activity: '',
        });
      }

      this.emit(rootRun, 'run.completed', 'Resposta concluída', {
        final_message_id: final.message_id,
        final_agent_id: selected.length && selected[selected.length - 1].worker_kind === 'agent' ? selected[selected.length - 1].agent.id : null,
        final_subagent_id: selected.length && selected[selected.length - 1].worker_kind === 'subagent' ? selected[selected.length - 1].subagent_id : null,
        usage: aggregate,
      });
    } catch (error) {
      const cancelled = signal?.aborted
        || error instanceof ChatRunCancelledError
        || (error instanceof Error && (error.message === 'CHAT_RUN_CANCELLED' || error.message === 'Provider request was cancelled.'));
      const message = cancelled
        ? 'CHAT_RUN_CANCELLED'
        : error instanceof Error ? error.message : 'CHAT_RUN_FAILED';

      this.runs.update(rootRun.id, {
        status: cancelled ? 'cancelled' : 'failed',
        ended_at: new Date().toISOString(),
        error: cancelled ? null : { message },
      });
      for (const binding of selected) {
        this.setWorkerState(binding, rootRun.project_id, null, cancelled ? 'idle' : 'error', cancelled ? '' : message, null);
      }
      this.emit(
        rootRun,
        cancelled ? 'run.cancelled' : 'run.failed',
        cancelled ? 'Execução cancelada' : 'Falha na resposta',
        { message },
        cancelled ? 'warning' : 'error',
      );
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
      if (agent.paused || !this.agentOps.isEligible(agent.id)) continue;
      if (!agent.provider_id || !agent.model_id) continue;
      const provider = this.providers.get(agent.provider_id);
      const model = this.providers.getModel(agent.model_id);
      if (!provider?.enabled || !model?.enabled || model.provider_id !== provider.id) continue;
      result.push({ worker_kind: 'agent', agent, provider, model });
    }
    return result;
  }

  private requireBinding(agentId: string): AgentBinding {
    const agent = this.agents.get(agentId) ?? this.agents.getBySlug(agentId);
    if (!agent || !agent.enabled) throw new Error('CHAT_AGENT_NOT_FOUND');
    if (agent.paused) throw new Error('CHAT_AGENT_PAUSED');
    if (!this.agentOps.isEligible(agent.id)) throw new Error('CHAT_AGENT_NOT_AVAILABLE');
    if (!agent.provider_id || !agent.model_id) throw new Error('CHAT_AGENT_NOT_CONFIGURED');
    const provider = this.providers.get(agent.provider_id);
    const model = this.providers.getModel(agent.model_id);
    if (!provider?.enabled) throw new Error('CHAT_PROVIDER_UNAVAILABLE');
    if (!model?.enabled || model.provider_id !== provider.id) throw new Error('CHAT_MODEL_UNAVAILABLE');
    return { worker_kind: 'agent', agent, provider, model };
  }

  private requireSubagentBinding(subagentId: string): AgentBinding {
    const subagent = this.subagents.get(subagentId);
    if (!subagent) throw new Error('CHAT_SUBAGENT_NOT_FOUND');
    if (!this.subagents.isEligible(subagent.id)) throw new Error('CHAT_SUBAGENT_NOT_AVAILABLE');
    if (!subagent.provider_id || !subagent.model_id) throw new Error('CHAT_SUBAGENT_NOT_CONFIGURED');
    const provider = this.providers.get(subagent.provider_id);
    const model = this.providers.getModel(subagent.model_id);
    if (!provider?.enabled) throw new Error('CHAT_PROVIDER_UNAVAILABLE');
    if (!model?.enabled || model.provider_id !== provider.id) throw new Error('CHAT_MODEL_UNAVAILABLE');
    const syntheticAgent: Agent = {
      id: subagent.id,
      name: subagent.name,
      slug: subagent.slug,
      role: subagent.role,
      description: subagent.description,
      avatar_key: subagent.avatar_key,
      provider_id: subagent.provider_id,
      model_id: subagent.model_id,
      system_prompt: subagent.system_prompt,
      enabled: subagent.enabled,
      paused: subagent.paused,
      sort_order: subagent.sort_order,
      idle_after_seconds: 300,
      metadata: { ...subagent.metadata, worker_kind: 'subagent', team_id: subagent.team_id, owner_agent_id: subagent.owner_agent_id },
      created_at: subagent.created_at,
      updated_at: subagent.updated_at,
    };
    return {
      worker_kind: 'subagent',
      agent: syntheticAgent,
      provider,
      model,
      owner_agent_id: subagent.owner_agent_id,
      team_id: subagent.team_id,
      subagent_id: subagent.id,
    };
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

  private selectAdaptive(available: AgentBinding[], message: string): AgentBinding[] {
    const primary = this.selectSingle(available, message, 'auto');
    const normalized = message.toLowerCase();
    const category = classifyTask(message, '').category;
    const complexSignal = message.length > 700
      || /\b(arquitet|planej|refator|migra|integra|deploy|release|sistema completo|end[- ]to[- ]end|do zero)\b/i.test(normalized);
    const reviewSignal = /\b(test|teste|revis|review|qa|valid|bug|corrig|seguran|security|release)\b/i.test(normalized);
    const planSignal = complexSignal || ['architecture', 'devops', 'auth_security'].includes(category);

    const selected: AgentBinding[] = [];
    if (planSignal) {
      const planner = available.find((binding) => {
        const text = `${binding.agent.role} ${binding.agent.description}`.toLowerCase();
        return binding.agent.id !== primary.agent.id && /(plan|architect|arquitet|estrateg)/i.test(text);
      });
      if (planner) selected.push(planner);
    }

    selected.push(primary);

    if (reviewSignal || (complexSignal && selected.length < 3)) {
      const reviewer = available.find((binding) => {
        const text = `${binding.agent.role} ${binding.agent.description}`.toLowerCase();
        return !selected.some((item) => item.agent.id === binding.agent.id)
          && /(review|revis|qa|critic|test|security|seguran)/i.test(text);
      });
      if (reviewer) selected.push(reviewer);
    }

    return selected.slice(0, 3);
  }

  private toolsAvailable(binding: AgentBinding): boolean {
    const policy = this.toolPolicies.get(this.auditAgentId(binding));
    return policy.enabled
      && binding.provider.protocol_driver === 'openai_chat'
      && binding.model.capabilities.tools !== false
      && toolRegistry.definitionsForPolicy(policy).length > 0;
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
    binding: AgentBinding,
    stage: string,
    previousText: string,
    toolsEnabled = false,
  ): UniversalMessage[] {
    const agent = binding.agent;
    const projectMemory = this.memory.getProjectMemory(projectId);
    const teamRoomContext = this.teamRoomContextForWorker(binding);
    const recent = this.messages.list(conversationId, RECENT_MESSAGE_LIMIT);
    const currentUser = [...recent].reverse().find((message) => message.role === 'user')?.content ?? '';
    const currentUserMessage=[...recent].reverse().find((message)=>message.role==='user');
    const currentMeta=currentUserMessage?asMetadata(currentUserMessage):{};
    const attachmentIds=Array.isArray(currentMeta.attachment_ids)?currentMeta.attachment_ids.filter((value):value is string=>typeof value==='string'):[];
    const resourceService=new ResourceService(this.database);
    const resourceContext=resourceService.context({projectId,agentId:binding.agent.id,subagentId:binding.subagent_id,query:currentUser,attachmentIds});
    const multimodalAttachments=resourceService.multimodalAttachments(attachmentIds);
    const retrieved = currentUser
      ? this.memory.search(projectId, currentUser, undefined, RETRIEVED_MEMORY_LIMIT)
      : [];

    const systemParts = [
      'You are an AI agent inside Agent Office.',
      toolsEnabled
        ? 'You are in Agent Office Full Access tool mode. Use the provided tools whenever execution is required, and never claim success without inspecting the returned result.'
        : 'You have no active computer tools for this run because the selected model/provider does not expose tool calling. Do not claim that you changed files, ran commands, published or performed external actions.',
      toolsEnabled
        ? 'You may work across the local computer, repositories, browser and deployment tools within the permissions of the Agent Office process. Avoid catastrophic system-level deletion. Prefer the minimum reliable set of actions and verify outcomes.'
        : 'You may reason, plan, draft, review and answer in text.',
      agent.system_prompt.trim(),
      teamRoomContext ? `Permanent Agent Team context:\n${teamRoomContext}` : '',
      projectMemory?.summary ? `Project summary: ${projectMemory.summary}` : '',
      projectMemory?.architecture ? `Project architecture: ${projectMemory.architecture}` : '',
      projectMemory?.rules ? `Project rules: ${projectMemory.rules}` : '',
      projectMemory?.known_issues ? `Known issues: ${projectMemory.known_issues}` : '',
      resourceContext ? `Knowledge, Skills and attached files:\n${resourceContext}` : '',
      retrieved.length
        ? `Relevant project memory:\n${retrieved.map((chunk) => `- [${chunk.kind}] ${chunk.text}`).join('\n')}`
        : '',
      stageInstruction(stage, previousText),
    ].filter(Boolean);

    const result: UniversalMessage[] = [{ role: 'system', content: systemParts.join('\n\n') }];
    for (const message of recent) {
      const normalized = messageTextForContext(message);
      if (normalized) {
        if(currentUserMessage&&message.id===currentUserMessage.id&&multimodalAttachments.length) normalized.attachments=multimodalAttachments;
        result.push(normalized);
      }
    }

    return this.trimMessages(result, CHAT_CONTEXT_TOKEN_BUDGET);
  }

  private teamRoomContextForWorker(binding: AgentBinding): string {
    const team = binding.worker_kind === 'subagent'
      ? this.database.prepare('SELECT id,name FROM teams WHERE id=? AND enabled=1').get(binding.team_id) as {id:string;name:string}|undefined
      : this.database.prepare(`SELECT id,name FROM teams WHERE owner_agent_id=? AND enabled=1 ORDER BY created_at LIMIT 1`).get(binding.agent.id) as {id:string;name:string}|undefined;
    if(!team)return '';
    const room=this.database.prepare('SELECT instructions,shared_context_json,memory_json FROM team_rooms WHERE team_id=?').get(team.id) as any;
    if(!room)return `Team: ${team.name}`;
    const read=(value:string)=>{try{const parsed=JSON.parse(value||'{}');return typeof parsed?.text==='string'?parsed.text:JSON.stringify(parsed)}catch{return ''}};
    return [
      `Team: ${team.name}`,
      binding.worker_kind === 'subagent' ? `You are a Subagent inside this Team. You support the owner Agent; you are not an independent Agent.` : 'You are the owner Agent of this Team.',
      room.instructions ? `Team instructions: ${room.instructions}` : '',
      read(room.shared_context_json) ? `Shared context: ${read(room.shared_context_json)}` : '',
      read(room.memory_json) ? `Team memory: ${read(room.memory_json)}` : '',
    ].filter(Boolean).join('\n');
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

  private auditAgentId(binding: AgentBinding): string {
    return binding.worker_kind === 'agent' ? binding.agent.id : binding.owner_agent_id!;
  }

  private workerPayload(binding: AgentBinding): Record<string, unknown> {
    return {
      worker_kind: binding.worker_kind,
      agent_id: binding.worker_kind === 'agent' ? binding.agent.id : null,
      subagent_id: binding.worker_kind === 'subagent' ? binding.subagent_id : null,
      owner_agent_id: binding.owner_agent_id ?? null,
      team_id: binding.team_id ?? null,
    };
  }

  private setWorkerState(
    binding: AgentBinding,
    projectId: string,
    runId: string | null,
    state: string,
    activity: string,
    progress: number | null,
  ): void {
    if (binding.worker_kind === 'agent') {
      this.states.upsert({
        agent_id: binding.agent.id,
        project_id: projectId,
        run_id: runId,
        state,
        activity,
        progress,
      });
      return;
    }
    const timestamp = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO subagent_states(subagent_id,project_id,run_id,state,activity,progress,updated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(subagent_id,project_id) DO UPDATE SET
        run_id=excluded.run_id,state=excluded.state,activity=excluded.activity,progress=excluded.progress,updated_at=excluded.updated_at
    `).run(binding.subagent_id, projectId, runId, state, activity, progress, timestamp);
  }

  private recordWorkerPerformance(
    binding: AgentBinding,
    runId: string,
    projectId: string,
    eventType: string,
    detail: string,
  ): void {
    if (binding.worker_kind === 'agent') {
      this.agentOps.recordPerformance({
        agent_id: binding.agent.id,
        run_id: runId,
        project_id: projectId,
        event_type: eventType,
        source: 'system',
        detail,
      });
      return;
    }
    const duplicate = this.database.prepare(
      'SELECT 1 FROM subagent_performance_events WHERE subagent_id=? AND run_id=? AND source=? AND event_type=? LIMIT 1'
    ).get(binding.subagent_id, runId, 'system', eventType);
    if (duplicate) return;
    this.database.prepare(`
      INSERT INTO subagent_performance_events(id,subagent_id,run_id,project_id,event_type,score,source,detail,metadata_json,created_at)
      VALUES(?,?,?,?,?,NULL,'system',?,'{}',?)
    `).run(
      crypto.randomUUID(),
      binding.subagent_id,
      runId,
      projectId,
      eventType,
      detail,
      new Date().toISOString(),
    );
  }

  private recordWorkerUsage(
    binding: AgentBinding,
    providerId: string,
    usage: UniversalUsage | undefined,
    costUsd: number | undefined,
    requestCount: number,
    durationMs: number,
    trace: { projectId: string; runId: string; modelId: string },
  ): void {
    if (binding.worker_kind === 'agent') {
      this.usage.recordRunUsage(binding.agent.id, providerId, {
        input_tokens: usage?.input_tokens,
        output_tokens: usage?.output_tokens,
        cost_usd: costUsd,
        request_count: requestCount,
        duration_ms: durationMs,
      }, {
        projectId: trace.projectId,
        runId: trace.runId,
        modelId: trace.modelId,
        costKind: costUsd == null ? 'unknown' : 'estimated',
      });
      return;
    }
    this.database.prepare(`
      INSERT INTO subagent_usage_snapshots(
        id,subagent_id,provider_id,input_tokens,output_tokens,cost_usd,request_count,duration_ms,created_at,
        project_id,run_id,model_id,cost_kind
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      crypto.randomUUID(),
      binding.subagent_id,
      providerId,
      usage?.input_tokens ?? 0,
      usage?.output_tokens ?? 0,
      costUsd ?? null,
      requestCount,
      durationMs,
      new Date().toISOString(),
      trace.projectId,
      trace.runId,
      trace.modelId,
      costUsd == null ? 'unknown' : 'estimated',
    );
  }

  private projectRoot(projectId: string): string {
    const row = this.database.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId) as { root_path: string } | undefined;
    if (!row?.root_path) throw new Error('CHAT_PROJECT_ROOT_NOT_FOUND');
    return row.root_path;
  }

  private mergeUsage(current: UniversalUsage | undefined, next: UniversalUsage | undefined): UniversalUsage | undefined {
    if (!current && !next) return undefined;
    return {
      input_tokens: (current?.input_tokens ?? 0) + (next?.input_tokens ?? 0),
      output_tokens: (current?.output_tokens ?? 0) + (next?.output_tokens ?? 0),
    };
  }

  private async waitForToolApproval(
    approvalId: string,
    signal?: AbortSignal,
    timeoutMs = 5 * 60_000,
  ): Promise<'approved' | 'denied'> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) throw new ChatRunCancelledError();
      const row = this.database.prepare('SELECT status FROM tool_approvals WHERE id = ?').get(approvalId) as { status: string } | undefined;
      if (!row) throw new Error('TOOL_APPROVAL_NOT_FOUND');
      if (row.status === 'approved' || row.status === 'denied') return row.status;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, 500);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new ChatRunCancelledError());
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    throw new Error('TOOL_APPROVAL_TIMEOUT');
  }

  private consumeWorkspaceOrientations(runId: string): string[] {
    const rows = this.database.prepare(
      "SELECT id,message FROM workspace_run_commands WHERE chat_run_id=? AND command_type='orient' AND status='pending' ORDER BY created_at"
    ).all(runId) as Array<{id:string;message:string}>;
    if (!rows.length) return [];
    const timestamp = new Date().toISOString();
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    this.database.prepare(`UPDATE workspace_run_commands SET status='applied',applied_at=? WHERE id IN (${placeholders})`).run(timestamp, ...ids);
    return rows.map((row) => row.message);
  }

  private async runToolAwareCompletion(input: {
    rootRun: ChatRun;
    childRun: ChatRun;
    binding: AgentBinding;
    stage: 'planner' | 'responder' | 'reviewer';
    messages: UniversalMessage[];
    signal?: AbortSignal;
  }): Promise<{ text: string; usage?: UniversalUsage; finish_reason?: string; request_count: number; tool_steps: number; effective_provider: string; effective_model: string }> {
    const { rootRun, childRun, binding, stage, signal } = input;
    const policy = this.toolPolicies.get(this.auditAgentId(binding));
    const definitions = toolRegistry.definitionsForPolicy(policy);
    const messages = input.messages.slice();
    let usage: UniversalUsage | undefined;
    let requestCount = 0;
    let toolSteps = 0;
    let effectiveProvider = binding.provider.id;
    let effectiveModel = binding.model.model_id;

    for (let step = 0; step <= policy.max_tool_steps; step += 1) {
      if (signal?.aborted) throw new ChatRunCancelledError();
      const orientations = this.consumeWorkspaceOrientations(rootRun.id);
      if (orientations.length) {
        messages.push({ role: 'system', content: 'User orientation received during execution:\n' + orientations.map((item) => '- ' + item).join('\n') });
        this.hub.publish(rootRun.id, 'run.oriented', { messages: orientations });
      }
      const result = await this.engine.complete(binding.provider.id, {
        model: binding.model.model_id,
        messages,
        max_output_tokens: binding.model.max_output_tokens ?? undefined,
        tools: definitions.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema,
        })),
        metadata: {
          run_id: childRun.id,
          ...this.workerPayload(binding),
          tools_enabled: true,
          tool_step: step,
        },
      }, { signal });

      requestCount += 1;
      usage = this.mergeUsage(usage, result.usage);
      effectiveProvider = result.provider_id ?? effectiveProvider;
      effectiveModel = result.model_id ?? effectiveModel;

      if (!result.tool_calls?.length) {
        if (result.text) {
          this.hub.publish(rootRun.id, 'response.delta', {
            ...this.workerPayload(binding),
            child_run_id: childRun.id,
            stage,
            text: result.text,
            tools_enabled: true,
          });
        }
        return {
          text: result.text,
          usage,
          finish_reason: result.finish_reason,
          request_count: requestCount,
          tool_steps: toolSteps,
          effective_provider: effectiveProvider,
          effective_model: effectiveModel,
        };
      }

      messages.push({
        role: 'assistant',
        content: result.text || '',
        tool_calls: result.tool_calls,
      });

      for (const call of result.tool_calls) {
        toolSteps += 1;
        if (toolSteps > policy.max_tool_steps) throw new Error('CHAT_MAX_TOOL_STEPS');

        const executionState = call.name === 'run_tests' ? 'testing' : 'coding';
        this.setWorkerState(
          binding,
          rootRun.project_id,
          rootRun.id,
          executionState,
          `Usando ${call.name}`,
          Math.min(0.85, 0.25 + (toolSteps / Math.max(1, policy.max_tool_steps)) * 0.5),
        );
        this.emit(rootRun, 'tool.started', `${binding.agent.name} iniciou ${call.name}`, {
          ...this.workerPayload(binding),
          child_run_id: childRun.id,
          tool_name: call.name,
          tool_call_id: call.id,
          step: toolSteps,
        });

        const toolContext = {
          database: this.database,
          project_id: rootRun.project_id,
          project_root: this.projectRoot(rootRun.project_id),
          run_id: childRun.id,
          agent_id: this.auditAgentId(binding),
          signal,
          idempotency_key: call.id,
        };
        let toolResult = await toolRegistry.execute(
          call.name,
          call.arguments,
          policy,
          toolContext,
        );

        if (toolResult.approval_required && toolResult.approval_id) {
          this.setWorkerState(
            binding,
            rootRun.project_id,
            rootRun.id,
            'waiting',
            `Aguardando aprovação para ${call.name}`,
            null,
          );
          this.emit(rootRun, 'tool.approval_required', `${call.name} precisa de aprovação`, {
            ...this.workerPayload(binding),
            child_run_id: childRun.id,
            tool_name: call.name,
            tool_call_id: call.id,
            approval_id: toolResult.approval_id,
            audit_id: toolResult.audit_id,
          }, 'warning');

          const approvalStatus = await this.waitForToolApproval(toolResult.approval_id, signal);
          if (approvalStatus === 'approved') {
            this.emit(rootRun, 'tool.approved', `${call.name} foi aprovado`, {
              ...this.workerPayload(binding),
              child_run_id: childRun.id,
              tool_name: call.name,
              approval_id: toolResult.approval_id,
            });
          } else {
            this.emit(rootRun, 'tool.denied', `${call.name} foi negado`, {
              ...this.workerPayload(binding),
              child_run_id: childRun.id,
              tool_name: call.name,
              approval_id: toolResult.approval_id,
            }, 'warning');
          }

          toolResult = await toolRegistry.executeApproved(
            call.name,
            call.arguments,
            policy,
            toolContext,
            toolResult.approval_id,
            toolResult.audit_id,
          );
        }

        this.emit(
          rootRun,
          'tool.completed',
          toolResult.ok
            ? `${binding.agent.name} concluiu ${call.name}`
            : `${call.name} não foi executado`,
          {
            ...this.workerPayload(binding),
            child_run_id: childRun.id,
            tool_name: call.name,
            tool_call_id: call.id,
            ok: toolResult.ok,
            error: toolResult.error ?? null,
            audit_id: toolResult.audit_id,
          },
          toolResult.ok ? 'info' : 'warning',
        );

        messages.push({
          role: 'tool',
          name: call.name,
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: toolResult.ok,
            data: toolResult.data ?? null,
            error: toolResult.error ?? null,
          }),
        });
      }
    }

    throw new Error('CHAT_MAX_TOOL_STEPS');
  }

  private async runAgent(input: {
    rootRun: ChatRun;
    childRun: ChatRun;
    binding: AgentBinding;
    stage: 'planner' | 'responder' | 'reviewer';
    previousText: string;
    isFinal: boolean;
    signal?: AbortSignal;
  }): Promise<AgentResult> {
    const { rootRun, childRun, binding, stage, previousText, isFinal, signal } = input;
    if (signal?.aborted) throw new ChatRunCancelledError();
    const state = stateForStage(stage);
    this.setWorkerState(binding, rootRun.project_id, rootRun.id, 'thinking', 'Preparando contexto', 0.05);
    this.emit(rootRun, 'worker.state', `${binding.agent.name} está pensando`, {
      ...this.workerPayload(binding),
      state: 'thinking',
      activity: 'Preparando contexto',
      stage,
    });

    const toolsEnabled = stage === 'responder' && this.toolsAvailable(binding);
    const messages = this.buildMessages(
      rootRun.project_id,
      rootRun.conversation_id,
      binding,
      stage,
      previousText,
      toolsEnabled,
    );

    const orientations = this.consumeWorkspaceOrientations(rootRun.id);
    if (orientations.length) {
      messages.push({ role: 'system', content: 'User orientation received during execution:\n' + orientations.map((item) => '- ' + item).join('\n') });
      this.hub.publish(rootRun.id, 'run.oriented', { messages: orientations });
    }

    const completionInput: UniversalCompletionInput = {
      model: binding.model.model_id,
      messages,
      max_output_tokens: binding.model.max_output_tokens ?? undefined,
      metadata: {
        run_id: childRun.id,
        ...this.workerPayload(binding),
        tools_enabled: toolsEnabled,
      },
    };

    this.setWorkerState(
      binding,
      rootRun.project_id,
      rootRun.id,
      state,
      stage === 'reviewer' ? 'Revisando resposta' : stage === 'planner' ? 'Planejando resposta' : 'Respondendo',
      0.2,
    );
    this.emit(rootRun, 'worker.state', stage === 'reviewer'
      ? `${binding.agent.name} está revisando`
      : stage === 'planner'
        ? `${binding.agent.name} está planejando`
        : `${binding.agent.name} está respondendo`, {
      ...this.workerPayload(binding),
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
    let requestCount = 1;
    let toolSteps = 0;
    let effectiveProvider = binding.provider.id;
    let effectiveModel = binding.model.model_id;

    if (toolsEnabled) {
      const toolResult = await this.runToolAwareCompletion({
        rootRun,
        childRun,
        binding,
        stage,
        messages,
        signal,
      });
      text = toolResult.text;
      usage = toolResult.usage;
      finishReason = toolResult.finish_reason;
      requestCount = toolResult.request_count;
      toolSteps = toolResult.tool_steps;
      effectiveProvider = toolResult.effective_provider;
      effectiveModel = toolResult.effective_model;
    } else {
    const streamingSupported = binding.model.capabilities.streaming !== false;
    if (streamingSupported) {
      try {
        for await (const event of this.engine.stream(binding.provider.id, completionInput, {
          signal,
          onResolvedModel: (providerId, modelId) => {
            effectiveProvider = providerId;
            effectiveModel = modelId;
          },
        })) {
          if (event.type === 'text_delta') {
            text += event.text;
            deltaCount += 1;
            this.hub.publish(rootRun.id, 'response.delta', {
              ...this.workerPayload(binding),
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
          ...this.workerPayload(binding),
          stage,
          reason: error instanceof Error ? error.message : 'stream_failed',
        }, 'warning');
        const result = await this.engine.complete(binding.provider.id, completionInput, { signal });
        text = result.text;
        usage = result.usage;
        finishReason = result.finish_reason;
        effectiveProvider = result.provider_id ?? effectiveProvider;
        effectiveModel = result.model_id ?? effectiveModel;
        if (text) {
          this.hub.publish(rootRun.id, 'response.delta', {
            ...this.workerPayload(binding),
            child_run_id: childRun.id,
            stage,
            text,
            fallback: true,
          });
        }
      }
    } else {
      const result = await this.engine.complete(binding.provider.id, completionInput, { signal });
      text = result.text;
      usage = result.usage;
      finishReason = result.finish_reason;
      effectiveProvider = result.provider_id ?? effectiveProvider;
      effectiveModel = result.model_id ?? effectiveModel;
      if (text) {
        this.hub.publish(rootRun.id, 'response.delta', {
          ...this.workerPayload(binding),
          child_run_id: childRun.id,
          stage,
          text,
          streaming: false,
        });
      }
    }
    }

    const assistantMessage = this.messages.create({
      conversation_id: rootRun.conversation_id,
      role: 'assistant',
      agent_id: binding.worker_kind === 'agent' ? binding.agent.id : null,
      content: text,
      metadata: {
        source: 'chat_v2',
        ...this.workerPayload(binding),
        root_run_id: rootRun.id,
        child_run_id: childRun.id,
        stage,
        provider_id: binding.provider.id,
        model_id: binding.model.id,
        model: binding.model.model_id,
        effective_provider: effectiveProvider,
        effective_model: effectiveModel,
        finish_reason: finishReason ?? null,
        final: isFinal,
        tools_enabled: toolsEnabled,
        tool_steps: toolSteps,
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
        ...this.workerPayload(binding),
        message_id: assistantMessage.id,
        finish_reason: finishReason ?? null,
        duration_ms: duration,
        tools_enabled: toolsEnabled,
        tool_steps: toolSteps,
        effective_provider: effectiveProvider,
        effective_model: effectiveModel,
      },
    });

    const effectivePricingModel = this.providers.listModels(effectiveProvider, true)
      .find((candidate) => candidate.model_id === effectiveModel) ?? binding.model;
    this.recordWorkerUsage(
      binding,
      effectiveProvider,
      usage,
      estimateCostUsd(effectivePricingModel, usage),
      requestCount,
      duration,
      { projectId: rootRun.project_id, runId: childRun.id, modelId: effectivePricingModel.id },
    );

    if (usage) {
      this.emit(rootRun, 'usage.updated', `Uso atualizado: ${binding.agent.name}`, {
        ...this.workerPayload(binding),
        provider_id: binding.provider.id,
        model_id: binding.model.id,
        usage,
        duration_ms: duration,
        request_count: requestCount,
        tool_steps: toolSteps,
      });
    }

    this.emit(rootRun, 'response.completed', `${binding.agent.name} concluiu a resposta`, {
      ...this.workerPayload(binding),
      child_run_id: childRun.id,
      message_id: assistantMessage.id,
      stage,
      finish_reason: finishReason ?? null,
      usage: usage ?? null,
      final: isFinal,
      tools_enabled: toolsEnabled,
      tool_steps: toolSteps,
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
