import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActivityEventV2,
  AgentProfile,
  AgentState,
  ChatRunReceipt,
  ChatStreamEnvelope,
  Conversation,
  Project,
  ResourceFile,
  ToolApproval,
  UniversalProvider,
} from './types.js';
import { api } from './api.js';
import { MessageContent } from './conversation/MessageContent.js';
import { PendingAttachmentCard, StoredAttachmentCard } from './conversation/ResourcePreview.js';
import { VoiceInputButton } from './conversation/VoiceInputButton.js';
import { OfficeMap } from './room/OfficeMap.js';

type OfficeFocus = 'office' | 'chat';
type VisualState =
  | 'offline'
  | 'idle'
  | 'resting'
  | 'thinking'
  | 'planning'
  | 'responding'
  | 'coding'
  | 'testing'
  | 'reviewing'
  | 'waiting'
  | 'blocked'
  | 'error';

interface OfficeViewProps {
  project: Project | null;
  focus?: OfficeFocus;
}

const STREAM_EVENTS = [
  'run.created',
  'agent.state',
  'response.delta',
  'response.streaming_fallback',
  'response.completed',
  'handoff.created',
  'usage.updated',
  'tool.started',
  'tool.completed',
  'tool.approval_required',
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
    value === 'coding' ||
    value === 'testing' ||
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
  if (type === 'tool.started') return '⚙';
  if (type === 'tool.completed') return '✓';
  if (type === 'tool.approval_required') return '◇';
  return '•';
}

function humanizeChatFailure(message: string): string {
  const raw = message.trim();
  if (/HTTP 502|service_unavailable|PROVIDER_HTTP_ERROR/i.test(raw)) {
    return 'O Orquestrador concluiu o roteamento, mas o provider do agente ficou temporariamente indisponível (HTTP 502). Tente novamente ou configure um fallback em Providers. Detalhe: ' + raw;
  }
  if (/PROVIDER_CIRCUIT_OPEN|PROVIDER_COOLDOWN|rate.?limit|HTTP 429/i.test(raw)) {
    return 'O provider do agente está temporariamente limitado ou em cooldown. O Office aguardará/usará fallback quando configurado. Detalhe: ' + raw;
  }
  return raw || 'A execução falhou antes de produzir uma resposta.';
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [target, setTarget] = useState('auto');
  const [sending, setSending] = useState(false);
  const [currentRun, setCurrentRun] = useState<ChatRunReceipt | null>(null);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'completed' | 'failed' | 'cancelled'>('idle');
  const [streamingByAgent, setStreamingByAgent] = useState<Record<string, string>>({});
  const [liveStates, setLiveStates] = useState<Record<string, { state: string; activity: string; updated_at: string }>>({});
  const [liveEvents, setLiveEvents] = useState<ChatStreamEnvelope[]>([]);
  const [lastHandoff, setLastHandoff] = useState<{ from: string; to: string } | null>(null);
  const [approvals, setApprovals] = useState<ToolApproval[]>([]);
  const [resolvingApproval, setResolvingApproval] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const loadSnapshot = useCallback(async () => {
    if (!project) return;
    try {
      const [nextAgents, nextProviders, nextStates, nextConversation, nextActivity, nextApprovals] = await Promise.all([
        api.listAgentsV2(),
        api.listProvidersV2(),
        api.listAgentStatesV2(project.id),
        api.getConversation(project.id),
        api.listActivityV2(project.id),
        api.listToolApprovalsV2(project.id),
      ]);
      setAgents(nextAgents.filter((agent) => agent.enabled).sort((a, b) => a.sort_order - b.sort_order));
      setProviders(nextProviders);
      setStates(nextStates);
      setConversation(nextConversation);
      setActivity(nextActivity);
      setApprovals(nextApprovals);
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
    setApprovals([]);
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    void loadSnapshot();

    if (!project) return;
    const timer = window.setInterval(() => {
      void Promise.all([
        api.listAgentStatesV2(project.id).then(setStates),
        api.listActivityV2(project.id).then(setActivity),
        api.getConversation(project.id).then(setConversation),
        api.listToolApprovalsV2(project.id).then(setApprovals),
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

  useEffect(() => {
    if (!project || !currentRun || !sending) return;

    let active = true;
    const reconcile = async () => {
      try {
        const run = await api.getChatRun(currentRun.run_id);
        if (!active) return;
        if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
          setSending(false);
          setRunStatus(run.status);
          if (run.status === 'failed') {
            const message = run.error && typeof run.error.message === 'string' ? run.error.message : 'CHAT_RUN_FAILED';
            setError(humanizeChatFailure(message));
          }
          eventSourceRef.current?.close();
          eventSourceRef.current = null;
          setStreamingByAgent({});
          setLiveStates({});
          const nextConversation = await api.getConversation(project.id);
          if (active) setConversation(nextConversation);
        }
      } catch {
        // SSE remains the primary channel; reconciliation is best-effort.
      }
    };

    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 1800);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [project, currentRun?.run_id, sending]);


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
    if (agent.paused) return false;
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
        if (envelope.event === 'run.failed') {
          const failureMessage = typeof envelope.data.message === 'string' ? envelope.data.message : 'CHAT_RUN_FAILED';
          setError(humanizeChatFailure(failureMessage));
        }
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
      void api.getChatRun(receipt.run_id)
        .then((run) => {
          if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
            setRunStatus(run.status);
            setSending(false);
            if (run.status === 'failed') {
              const message = run.error && typeof run.error.message === 'string' ? run.error.message : 'CHAT_RUN_FAILED';
              setError(humanizeChatFailure(message));
            }
            source.close();
            if (eventSourceRef.current === source) eventSourceRef.current = null;
            if (project) {
              void api.getConversation(project.id).then(setConversation).catch(() => undefined);
            }
            return;
          }
          setError('A conexão ao stream foi interrompida. O Agent Office continuará sincronizando esta execução.');
        })
        .catch(() => {
          setError('A conexão ao stream foi interrompida. O Agent Office continuará tentando recuperar o estado.');
        });
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

  const resolveApproval = async (approvalId: string, status: 'approved' | 'denied') => {
    setResolvingApproval(approvalId);
    setError(null);
    try {
      await api.resolveToolApprovalV2(approvalId, status);
      if (project) setApprovals(await api.listToolApprovalsV2(project.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao resolver aprovação.');
    } finally {
      setResolvingApproval(null);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project || (!message.trim() && !pendingFiles.length) || sending) return;

    const text = message.trim() || 'Analise os arquivos anexados.';
    const files = pendingFiles.slice();
    const optimisticId=`optimistic-${Date.now()}`;
    setMessage('');
    setPendingFiles([]);
    setSending(true);
    setRunStatus('running');
    setError(null);
    setStreamingByAgent({});
    setLiveEvents([]);
    setLastHandoff(null);
    setConversation((current) => current ? {
      ...current,
      messages:[...current.messages,{id:optimisticId,role:'user',agent_id:null,content:text,created_at:new Date().toISOString(),metadata:{pending:true,pending_file_names:files.map(file=>file.name)}}],
    }:current);

    try {
      const uploaded: ResourceFile[] = files.length ? await Promise.all(files.map((file) => api.uploadResource(project.id, file, 'chat'))) : [];
      setConversation(current=>current?{...current,messages:current.messages.map(item=>item.id===optimisticId?{...item,metadata:{...item.metadata,pending:false,attachments:uploaded,attachment_ids:uploaded.map(file=>file.id)}}:item)}:current);
      const receipt = await api.startChatRun({
        project_id: project.id,
        conversation_id: conversation?.conversation_id,
        message: text,
        target,
        attachment_ids: uploaded.map((file) => file.id),
      });
      setCurrentRun(receipt);
      await connectRunStream(receipt);
    } catch (reason) {
      setConversation(current=>current?{...current,messages:current.messages.filter(item=>item.id!==optimisticId)}:current);
      setSending(false);
      setRunStatus('failed');
      setError(reason instanceof Error ? reason.message : 'Falha ao iniciar o chat.');
      setMessage(text);
      setPendingFiles(files);
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
            <span className="api-only-pill">{currentRun?.tools_enabled ? 'Tools ativos' : 'Texto/API'}</span>
            <span className="agent-count-pill">{activeCount}/{visibleAgents.length || 0} ativos</span>
          </div>
        </header>

        <OfficeMap agents={visibleAgents} providers={providers} states={states} liveStates={liveStates} target={target} onTarget={setTarget} lastHandoff={lastHandoff}/>

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
                    <MessageContent content={item.content}/>
                    {Array.isArray((item as any).metadata?.attachments)&&<div className="work-v2-attachments">{(item as any).metadata.attachments.map((file:ResourceFile)=><StoredAttachmentCard key={file.id} file={file}/>)}</div>}
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
                    <MessageContent content={text} streaming/>
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>

          <form className="chat-composer" onSubmit={submit} onDragOver={(event)=>{event.preventDefault();event.dataTransfer.dropEffect='copy'}} onDrop={(event)=>{event.preventDefault();setPendingFiles(cur=>[...cur,...Array.from(event.dataTransfer.files??[])].slice(0,12))}}>
            {pendingFiles.length>0&&<div className="work-v2-pending-files">{pendingFiles.map((file,index)=><PendingAttachmentCard key={file.name+'-'+index} file={file} onRemove={()=>setPendingFiles(cur=>cur.filter((_,i)=>i!==index))}/>)}</div>}
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
                <label className="work-v2-file-button" title="Anexar arquivos">+<input type="file" multiple onChange={event=>{setPendingFiles(cur=>[...cur,...Array.from(event.target.files??[])].slice(0,12));event.currentTarget.value=''}}/></label>
                <VoiceInputButton disabled={sending} onTranscript={text=>setMessage(current=>current.trim()?current.trimEnd()+' '+text:text)}/>
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
                <button type="submit" className="send-button" disabled={sending || (!message.trim()&&!pendingFiles.length)}>
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

        {approvals.some((item) => item.status === 'pending') && (
          <div className="approval-stack">
            {approvals.filter((item) => item.status === 'pending').slice(0, 3).map((approval) => {
              const agent = approval.agent_id ? agents.find((candidate) => candidate.id === approval.agent_id) : null;
              return (
                <div key={approval.id} className="approval-card">
                  <div>
                    <span className="office-kicker">Aprovação necessária</span>
                    <strong>{agent?.name || 'Agente'} quer usar {approval.tool_name}</strong>
                    <small>{approval.reason || 'Esta ação exige sua confirmação.'}</small>
                  </div>
                  <div className="approval-actions">
                    <button
                      type="button"
                      className="approval-deny"
                      disabled={resolvingApproval === approval.id}
                      onClick={() => void resolveApproval(approval.id, 'denied')}
                    >
                      Negar
                    </button>
                    <button
                      type="button"
                      className="approval-allow"
                      disabled={resolvingApproval === approval.id}
                      onClick={() => void resolveApproval(approval.id, 'approved')}
                    >
                      Aprovar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

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
            <strong>{currentRun?.tools_enabled ? 'Ativas nesta execução' : 'Não usadas'}</strong>
          </div>
        </div>
      </aside>
    </div>
  );
}
