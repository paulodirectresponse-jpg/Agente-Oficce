import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActivityEventV2,
  AgentProfile,
  AgentState,
  ChatRunReceipt,
  ChatStreamEnvelope,
  Conversation,
  Project,
  UniversalProvider,
} from './types.js';
import { api } from './api.js';

type OfficeFocus = 'office' | 'chat';
type VisualState =
  | 'offline'
  | 'idle'
  | 'resting'
  | 'thinking'
  | 'planning'
  | 'responding'
  | 'reviewing'
  | 'waiting'
  | 'blocked'
  | 'error';

interface OfficeViewProps {
  project: Project | null;
  focus?: OfficeFocus;
}

const STATE_LABELS: Record<VisualState, string> = {
  offline: 'Offline',
  idle: 'Disponível',
  resting: 'Descansando',
  thinking: 'Pensando',
  planning: 'Planejando',
  responding: 'Respondendo',
  reviewing: 'Revisando',
  waiting: 'Aguardando',
  blocked: 'Bloqueado',
  error: 'Erro',
};

const STREAM_EVENTS = [
  'run.created',
  'agent.state',
  'response.delta',
  'response.streaming_fallback',
  'response.completed',
  'handoff.created',
  'usage.updated',
  'run.completed',
  'run.failed',
  'run.cancelled',
];

function normalizeState(value: string): VisualState {
  if (
    value === 'offline' ||
    value === 'idle' ||
    value === 'resting' ||
    value === 'thinking' ||
    value === 'planning' ||
    value === 'responding' ||
    value === 'reviewing' ||
    value === 'waiting' ||
    value === 'blocked' ||
    value === 'error'
  ) return value;
  if (value === 'running' || value === 'working') return 'responding';
  return 'idle';
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function activitySummary(event: ActivityEventV2): string {
  if (event.detail) return event.detail;
  const payload = event.payload;
  if (event.type === 'handoff.created') {
    const from = typeof payload.from_agent === 'string' ? payload.from_agent : 'agente';
    const to = typeof payload.to_agent === 'string' ? payload.to_agent : 'agente';
    return `${from} → ${to}`;
  }
  if (event.type === 'agent.state') {
    const state = typeof payload.state === 'string' ? payload.state : '';
    const activity = typeof payload.activity === 'string' ? payload.activity : '';
    return [state, activity].filter(Boolean).join(' · ');
  }
  if (event.type === 'usage.updated') {
    const usage = payload.usage && typeof payload.usage === 'object'
      ? payload.usage as Record<string, unknown>
      : {};
    const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
    const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
    return `${(input + output).toLocaleString('pt-BR')} tokens`;
  }
  return '';
}

function eventIcon(type: string): string {
  if (type === 'handoff.created') return '↗';
  if (type === 'response.completed') return '✓';
  if (type === 'run.completed') return '✓';
  if (type === 'run.failed') return '!';
  if (type === 'agent.state') return '●';
  if (type === 'usage.updated') return '↯';
  return '•';
}

function providerState(agent: AgentProfile, providers: UniversalProvider[]): 'online' | 'offline' | 'unknown' {
  if (!agent.provider_id) return 'offline';
  const provider = providers.find((item) => item.id === agent.provider_id);
  if (!provider || !provider.enabled || provider.health_status === 'unavailable') return 'offline';
  if (provider.health_status === 'healthy') return 'online';
  return 'unknown';
}

function deriveVisualState(
  agent: AgentProfile,
  persisted: AgentState | undefined,
  live: { state: string; updated_at: string } | undefined,
  providers: UniversalProvider[],
): VisualState {
  const provider = providerState(agent, providers);
  if (provider === 'offline') return 'offline';
  const state = normalizeState(live?.state ?? persisted?.state ?? 'idle');
  if (state !== 'idle') return state;

  const updatedAt = live?.updated_at ?? persisted?.updated_at;
  if (updatedAt) {
    const ageMs = Date.now() - new Date(updatedAt).getTime();
    if (ageMs > agent.idle_after_seconds * 1000) return 'resting';
  }
  return 'idle';
}

export function OfficeView({ project, focus = 'office' }: OfficeViewProps) {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [providers, setProviders] = useState<UniversalProvider[]>([]);
  const [states, setStates] = useState<AgentState[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [activity, setActivity] = useState<ActivityEventV2[]>([]);
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState('auto');
  const [sending, setSending] = useState(false);
  const [currentRun, setCurrentRun] = useState<ChatRunReceipt | null>(null);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'completed' | 'failed' | 'cancelled'>('idle');
  const [streamingByAgent, setStreamingByAgent] = useState<Record<string, string>>({});
  const [liveStates, setLiveStates] = useState<Record<string, { state: string; activity: string; updated_at: string }>>({});
  const [liveEvents, setLiveEvents] = useState<ChatStreamEnvelope[]>([]);
  const [lastHandoff, setLastHandoff] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const loadSnapshot = useCallback(async () => {
    if (!project) return;
    try {
      const [nextAgents, nextProviders, nextStates, nextConversation, nextActivity] = await Promise.all([
        api.listAgentsV2(),
        api.listProvidersV2(),
        api.listAgentStatesV2(project.id),
        api.getConversation(project.id),
        api.listActivityV2(project.id),
      ]);
      setAgents(nextAgents.filter((agent) => agent.enabled).sort((a, b) => a.sort_order - b.sort_order));
      setProviders(nextProviders);
      setStates(nextStates);
      setConversation(nextConversation);
      setActivity(nextActivity);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar o escritório.');
    }
  }, [project]);

  useEffect(() => {
    setCurrentRun(null);
    setRunStatus('idle');
    setStreamingByAgent({});
    setLiveStates({});
    setLiveEvents([]);
    setLastHandoff(null);
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    void loadSnapshot();

    if (!project) return;
    const timer = window.setInterval(() => {
      void Promise.all([
        api.listAgentStatesV2(project.id).then(setStates),
        api.listActivityV2(project.id).then(setActivity),
        api.getConversation(project.id).then(setConversation),
      ]).catch(() => undefined);
    }, 3500);

    return () => {
      window.clearInterval(timer);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [project, loadSnapshot]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [conversation?.messages.length, streamingByAgent]);

  const visibleAgents = useMemo(
    () => agents
      .slice()
      .sort((a, b) => {
        const aConfigured = a.provider_id && a.model_id ? 1 : 0;
        const bConfigured = b.provider_id && b.model_id ? 1 : 0;
        return bConfigured - aConfigured || a.sort_order - b.sort_order;
      }),
    [agents],
  );
  const stateByAgent = useMemo(
    () => new Map(states.map((state) => [state.agent_id, state])),
    [states],
  );

  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );

  const latestActivities = useMemo(() => {
    const live: ActivityEventV2[] = liveEvents
      .filter((event) => event.event !== 'response.delta')
      .map((event) => ({
        id: `live-${event.run_id}-${event.sequence}`,
        project_id: project?.id ?? null,
        conversation_id: currentRun?.conversation_id ?? null,
        run_id: event.run_id,
        agent_id: typeof event.data.agent_id === 'string' ? event.data.agent_id : null,
        type: event.event,
        severity: event.event === 'run.failed' ? 'error' : 'info',
        title: typeof event.data.title === 'string' ? event.data.title : event.event,
        detail: typeof event.data.message === 'string' ? event.data.message : '',
        payload: event.data,
        created_at: event.timestamp,
      }));

    const persistedIds = new Set(activity.map((item) => `${item.run_id ?? ''}:${item.type}:${item.created_at}`));
    const uniqueLive = live.filter((item) => !persistedIds.has(`${item.run_id ?? ''}:${item.type}:${item.created_at}`));
    return [...uniqueLive, ...activity]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 18);
  }, [activity, liveEvents, currentRun, project]);

  const activeCount = visibleAgents.filter((agent) => {
    const visual = deriveVisualState(agent, stateByAgent.get(agent.id), liveStates[agent.id], providers);
    return visual !== 'offline' && visual !== 'resting';
  }).length;

  const connectRunStream = useCallback(async (receipt: ChatRunReceipt) => {
    eventSourceRef.current?.close();
    const url = await api.getChatStreamUrl(receipt.run_id);
    const source = new EventSource(url);
    eventSourceRef.current = source;

    const handle = (event: MessageEvent) => {
      let envelope: ChatStreamEnvelope;
      try {
        envelope = JSON.parse(event.data) as ChatStreamEnvelope;
      } catch {
        return;
      }

      setLiveEvents((current) => [
        envelope,
        ...current.filter((item) => !(item.run_id === envelope.run_id && item.sequence === envelope.sequence)),
      ].slice(0, 50));

      if (envelope.event === 'agent.state') {
        const agentId = typeof envelope.data.agent_id === 'string' ? envelope.data.agent_id : '';
        const state = typeof envelope.data.state === 'string' ? envelope.data.state : 'idle';
        const activityText = typeof envelope.data.activity === 'string' ? envelope.data.activity : '';
        if (agentId) {
          setLiveStates((current) => ({
            ...current,
            [agentId]: {
              state,
              activity: activityText,
              updated_at: envelope.timestamp,
            },
          }));
        }
      }

      if (envelope.event === 'response.delta') {
        const agentId = typeof envelope.data.agent_id === 'string' ? envelope.data.agent_id : 'agent';
        const delta = typeof envelope.data.text === 'string' ? envelope.data.text : '';
        if (delta) {
          setStreamingByAgent((current) => ({
            ...current,
            [agentId]: `${current[agentId] ?? ''}${delta}`,
          }));
        }
      }

      if (envelope.event === 'handoff.created') {
        const from = typeof envelope.data.from_agent === 'string' ? envelope.data.from_agent : '';
        const to = typeof envelope.data.to_agent === 'string' ? envelope.data.to_agent : '';
        if (from && to) setLastHandoff({ from, to });
      }

      if (envelope.event === 'response.completed') {
        const agentId = typeof envelope.data.agent_id === 'string' ? envelope.data.agent_id : '';
        if (!project) return;
        void api.getConversation(project.id)
          .then((next) => {
            setConversation(next);
            if (agentId) {
              setStreamingByAgent((current) => {
                const nextState = { ...current };
                delete nextState[agentId];
                return nextState;
              });
            }
          })
          .catch(() => undefined);
      }

      if (envelope.event === 'run.completed' || envelope.event === 'run.failed' || envelope.event === 'run.cancelled') {
        setRunStatus(
          envelope.event === 'run.completed'
            ? 'completed'
            : envelope.event === 'run.cancelled'
              ? 'cancelled'
              : 'failed',
        );
        setSending(false);
        source.close();
        if (eventSourceRef.current === source) eventSourceRef.current = null;
        window.setTimeout(() => {
          void loadSnapshot();
          setLiveStates({});
          setStreamingByAgent({});
        }, 200);
      }
    };

    for (const eventName of STREAM_EVENTS) {
      source.addEventListener(eventName, handle as EventListener);
    }

    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) return;
      setError('A conexão ao stream foi interrompida. O histórico continuará sendo sincronizado.');
    };
  }, [loadSnapshot, project]);

  const cancelCurrentRun = async () => {
    if (!currentRun || runStatus !== 'running') return;
    setError(null);
    try {
      await api.cancelChatRun(currentRun.run_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao cancelar a execução.');
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project || !message.trim() || sending) return;

    const text = message.trim();
    setMessage('');
    setSending(true);
    setRunStatus('running');
    setError(null);
    setStreamingByAgent({});
    setLiveEvents([]);
    setLastHandoff(null);

    try {
      const receipt = await api.startChatRun({
        project_id: project.id,
        conversation_id: conversation?.conversation_id,
        message: text,
        target,
      });
      setCurrentRun(receipt);
      setConversation((current) => current
        ? {
          ...current,
          messages: [
            ...current.messages,
            {
              id: `optimistic-${Date.now()}`,
              role: 'user',
              agent_id: null,
              content: text,
              created_at: new Date().toISOString(),
            },
          ],
        }
        : current);
      await connectRunStream(receipt);
    } catch (reason) {
      setSending(false);
      setRunStatus('failed');
      setError(reason instanceof Error ? reason.message : 'Falha ao iniciar o chat.');
      setMessage(text);
    }
  };

  if (!project) {
    return (
      <div className="office-empty-shell">
        <div className="office-empty-icon">⌂</div>
        <h2>Escolha um projeto</h2>
        <p>O escritório ganha vida quando um projeto está ativo.</p>
      </div>
    );
  }

  return (
    <div className={`experience-grid ${focus === 'chat' ? 'chat-emphasis' : ''}`}>
      <section className="experience-center">
        <header className="office-topbar">
          <div>
            <div className="office-kicker">Projeto ativo</div>
            <h1>{project.name}</h1>
            <p>{focus === 'chat'
              ? 'Conversa completa com a equipe e respostas em tempo real.'
              : 'Veja todos os agentes ativos trabalhando no mesmo projeto.'}</p>
          </div>
          <div className="office-topbar-actions">
            <span className={`run-pill ${runStatus}`}>
              <span className="status-dot" />
              {runStatus === 'running'
                ? 'Em execução'
                : runStatus === 'completed'
                  ? 'Concluído'
                  : runStatus === 'cancelled'
                    ? 'Cancelado'
                    : runStatus === 'failed'
                      ? 'Falhou'
                      : 'Pronto'}
            </span>
            {runStatus === 'running' && currentRun && (
              <button type="button" className="cancel-run-button" onClick={cancelCurrentRun}>Cancelar</button>
            )}
            <span className="api-only-pill">API only</span>
            <span className="agent-count-pill">{activeCount}/{visibleAgents.length || 0} ativos</span>
          </div>
        </header>

        <div className="office-scene-card">
          <div className="office-back-wall">
            <div className="wall-poster left">GOOD<br />AGENTS<br />GREAT<br />THINGS</div>
            <div className="office-sign">
              <strong>Agent Office</strong>
              <span>LOCAL IDEAS. REAL PROGRESS.</span>
            </div>
            <div className="wall-poster right">PLAN<br />DELEGATE<br />ITERATE<br />SHIP</div>
          </div>

          <div className="office-room">
            <div className="office-plant plant-a">✦</div>
            <div className="office-plant plant-b">✦</div>
            <div className="office-plant plant-c">✦</div>

            <div className={`agent-stations agent-count-${Math.min(visibleAgents.length, 10)}`}>
              {visibleAgents.map((agent, index) => {
                const persisted = stateByAgent.get(agent.id);
                const visualState = deriveVisualState(agent, persisted, liveStates[agent.id], providers);
                const provider = agent.provider_id ? providerById.get(agent.provider_id) : undefined;
                const activityText = liveStates[agent.id]?.activity || persisted?.activity || STATE_LABELS[visualState];
                const selected = target === agent.id || target === agent.slug;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    className={`agent-station state-${visualState} ${selected ? 'selected' : ''}`}
                    onClick={() => setTarget(selected ? 'auto' : agent.id)}
                    title={visualState === 'offline'
                      ? `${agent.name} precisa de provider/modelo disponível`
                      : `Enviar a próxima mensagem diretamente para ${agent.name}`}
                    disabled={visualState === 'offline'}
                  >
                    <div className="agent-floating-card">
                      <div className="agent-floating-title">
                        <span className="agent-state-dot" />
                        <strong>{agent.name}</strong>
                      </div>
                      <span>{activityText || STATE_LABELS[visualState]}</span>
                      <div className="agent-progress-track">
                        <span style={{ width: persisted?.progress != null ? `${Math.max(8, persisted.progress * 100)}%` : visualState === 'idle' || visualState === 'resting' ? '18%' : '62%' }} />
                      </div>
                    </div>

                    <div className="desk-illustration">
                      <div className="desk-monitor monitor-left"><span /></div>
                      <div className="desk-monitor monitor-main"><span /></div>
                      <div className={`agent-character character-${index % 3}`}>
                        <div className="character-head">
                          <span className="character-hair" />
                          <span className="character-face" />
                          <span className="character-headset" />
                        </div>
                        <div className="character-body" />
                      </div>
                      <div className="desk-surface">
                        <span className="keyboard" />
                        <span className="desk-mug">•</span>
                        <span className="desk-plant">✦</span>
                      </div>
                      <div className="desk-legs left" />
                      <div className="desk-legs right" />
                    </div>

                    <div className="agent-nameplate">
                      <strong>{agent.name}</strong>
                      <span>{agent.role || 'AI Agent'}</span>
                      <small>
                        {provider?.name ?? 'Provider não configurado'} · {STATE_LABELS[visualState]}
                      </small>
                    </div>
                  </button>
                );
              })}

              {visibleAgents.length === 0 && (
                <div className="office-no-agents">
                  <strong>Nenhum agente configurado</strong>
                  <span>Na Fase F você poderá criar e posicionar agentes pelo painel.</span>
                </div>
              )}
            </div>

            <div className="office-handoff-line">
              {lastHandoff ? (
                <>
                  <span className="handoff-node">{lastHandoff.from}</span>
                  <span className="handoff-arrow">────→</span>
                  <span className="handoff-bubble">Handoff</span>
                  <span className="handoff-arrow">────→</span>
                  <span className="handoff-node">{lastHandoff.to}</span>
                </>
              ) : (
                <>
                  <span className="shared-context-dot" />
                  <span>Mesmo contexto · múltiplos agentes · handoffs ao vivo</span>
                </>
              )}
            </div>

            <div className="office-lounge">
              <div className="office-sofa">
                <span /><span /><span />
              </div>
              <div className="office-table"><span>✦</span></div>
              <div className="office-rug">A CALMER<br />MORE CAPABLE<br />YOU</div>
            </div>
          </div>
        </div>

        <section className="office-chat-card" aria-label="Chat">
          <div className="chat-header">
            <div>
              <strong>Chat</strong>
              <span>Uma conversa compartilhada pela equipe.</span>
            </div>
            <div className="chat-header-meta">
              {currentRun?.selected_agents.length ? (
                <span>{currentRun.selected_agents.length} agente{currentRun.selected_agents.length > 1 ? 's' : ''} nesta execução</span>
              ) : (
                <span>{agents.length} agentes disponíveis</span>
              )}
            </div>
          </div>

          <div className="chat-transcript">
            {conversation?.messages.length ? conversation.messages.slice(-16).map((item) => {
              const agent = item.agent_id ? agents.find((candidate) => candidate.id === item.agent_id) : null;
              return (
                <div key={item.id} className={`chat-message ${item.role === 'user' ? 'user' : 'assistant'}`}>
                  <div className="chat-avatar">{item.role === 'user' ? 'P' : (agent?.name?.slice(0, 1).toUpperCase() || 'A')}</div>
                  <div className="chat-message-body">
                    <div className="chat-message-meta">
                      <strong>{item.role === 'user' ? 'Você' : agent?.name || item.agent_id || 'Agente'}</strong>
                      <span>{formatTime(item.created_at)}</span>
                    </div>
                    <p>{item.content}</p>
                  </div>
                </div>
              );
            }) : (
              <div className="chat-placeholder">
                <strong>Converse com o escritório.</strong>
                <span>Use Auto para deixar o sistema escolher, Team para colaboração ou clique em uma mesa.</span>
              </div>
            )}

            {Object.entries(streamingByAgent).map(([agentId, text]) => {
              const agent = agents.find((candidate) => candidate.id === agentId);
              return (
                <div key={`stream-${agentId}`} className="chat-message assistant streaming">
                  <div className="chat-avatar">{agent?.name?.slice(0, 1).toUpperCase() || 'A'}</div>
                  <div className="chat-message-body">
                    <div className="chat-message-meta">
                      <strong>{agent?.name || agentId}</strong>
                      <span className="typing-indicator">respondendo ao vivo</span>
                    </div>
                    <p>{text}<span className="stream-caret">▍</span></p>
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>

          <form className="chat-composer" onSubmit={submit}>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Mensagem para sua equipe..."
              rows={2}
              disabled={sending}
            />
            <div className="composer-row">
              <div className="composer-context">
                <span className="shared-context-dot" />
                <span>{agents.length} agentes</span>
                <span>•</span>
                <span>contexto compartilhado</span>
                <span>•</span>
                <span>local-first</span>
              </div>
              <div className="composer-actions">
                <select value={target} onChange={(event) => setTarget(event.target.value)} disabled={sending}>
                  <option value="auto">Auto</option>
                  <option value="team">Team</option>
                  {agents
                    .filter((agent) => {
                      if (!agent.provider_id || !agent.model_id) return false;
                      const provider = providerById.get(agent.provider_id);
                      return Boolean(provider?.enabled && provider.health_status !== 'unavailable');
                    })
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                </select>
                <button type="submit" className="send-button" disabled={sending || !message.trim()}>
                  {sending ? '•••' : '➤'}
                </button>
              </div>
            </div>
          </form>
          {error && <div className="office-inline-error">{error}</div>}
        </section>
      </section>

      <aside className="activity-rail">
        <div className="activity-rail-header">
          <div>
            <span className="office-kicker">Ao vivo</span>
            <h2>Event Stream</h2>
          </div>
          <span className="live-pill"><span />Live</span>
        </div>

        <div className="activity-list">
          {latestActivities.length ? latestActivities.map((item) => {
            const agent = item.agent_id ? agents.find((candidate) => candidate.id === item.agent_id) : null;
            const label = item.title === item.type ? item.type : item.title;
            return (
              <div key={item.id} className={`activity-item severity-${item.severity}`}>
                <div className="activity-time">{formatTime(item.created_at)}</div>
                <div className="activity-icon">{eventIcon(item.type)}</div>
                <div className="activity-copy">
                  <strong>{agent?.name || (item.agent_id ?? (item.type.startsWith('run.') ? 'Sistema' : label))}</strong>
                  <span>{label}</span>
                  {activitySummary(item) && <small>{activitySummary(item)}</small>}
                </div>
              </div>
            );
          }) : (
            <div className="activity-empty">
              <strong>Sem eventos ainda.</strong>
              <span>Quando os agentes trabalharem, tudo aparecerá aqui.</span>
            </div>
          )}
        </div>

        <div className="activity-summary-card">
          <span className="summary-icon">↯</span>
          <div>
            <strong>Multiple agents. One mind.</strong>
            <p>Os agentes compartilham a mesma conversa e podem transferir contexto entre si.</p>
          </div>
        </div>

        <div className="activity-status-card">
          <div className="status-card-row">
            <span>Execução</span>
            <strong>{runStatus === 'running' ? 'Em andamento' : runStatus === 'completed' ? 'Concluída' : runStatus === 'cancelled' ? 'Cancelada' : runStatus === 'failed' ? 'Falhou' : 'Aguardando'}</strong>
          </div>
          <div className="status-card-row">
            <span>Modo</span>
            <strong>{target === 'team' ? 'Team' : target === 'auto' ? 'Auto' : 'Agent'}</strong>
          </div>
          <div className="status-card-row">
            <span>Tools</span>
            <strong>Desligadas</strong>
          </div>
        </div>
      </aside>
    </div>
  );
}
