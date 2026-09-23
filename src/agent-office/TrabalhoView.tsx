import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentProfile, ChatRun, ChatStreamEnvelope, Conversation, Project, Team, ToolApproval, WorkspaceSnapshot } from './types.js';
import { api } from './api.js';
import { OfficeView } from './OfficeView.js';
import { Workbench } from './dev-chat/Workbench.js';
import { V2Drawer, V2EmptyState, V2Status, V2Tabs } from './shell/V2Primitives.js';

type ActiveAction='orient'|'enqueue'|'interrupt';
type WorkMode='conversation'|'sala';
const EVENTS=['run.created','worker.state','agent.state','response.delta','response.streaming_fallback','response.completed','handoff.created','usage.updated','tool.started','tool.completed','tool.approval_required','run.oriented','run.completed','run.failed','run.cancelled'];

function terminal(status?:string){return status==='completed'||status==='failed'||status==='cancelled'}
function humanError(value:unknown){const text=value instanceof Error?value.message:String(value||'Falha na execução.');return text.replace(/^CHAT_/,'').replace(/_/g,' ').toLowerCase()}
function workerKey(data:Record<string,unknown>){if(typeof data.subagent_id==='string')return 'subagent:'+data.subagent_id;if(typeof data.agent_id==='string')return 'agent:'+data.agent_id;return 'system'}
function shortTime(value:string){return new Date(value).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
function stateLabel(status?:string){
  if(status==='running')return'Trabalhando';
  if(status==='completed')return'Concluído';
  if(status==='failed')return'Precisa de atenção';
  if(status==='cancelled')return'Cancelado';
  return'Pronto';
}
function eventLabel(event:string){
  const labels:Record<string,string>={
    'run.created':'Execução iniciada','worker.state':'Estado atualizado','agent.state':'Agent atualizado',
    'response.delta':'Resposta em andamento','response.completed':'Resposta concluída','handoff.created':'Trabalho repassado',
    'usage.updated':'Uso atualizado','tool.started':'Ação iniciada','tool.completed':'Ação concluída',
    'tool.approval_required':'Aprovação necessária','run.oriented':'Orientação recebida',
    'run.completed':'Execução concluída','run.failed':'Execução com problema','run.cancelled':'Execução cancelada'
  };
  return labels[event]??'Atividade';
}

export function TrabalhoView({project}:{project:Project|null}){
  const [snapshot,setSnapshot]=useState<WorkspaceSnapshot|null>(null);
  const [conversation,setConversation]=useState<Conversation|null>(null);
  const [runs,setRuns]=useState<ChatRun[]>([]);
  const [agents,setAgents]=useState<AgentProfile[]>([]);
  const [teams,setTeams]=useState<Team[]>([]);
  const [message,setMessage]=useState('');
  const [target,setTarget]=useState('auto');
  const [activeAction,setActiveAction]=useState<ActiveAction>('orient');
  const [liveEvents,setLiveEvents]=useState<ChatStreamEnvelope[]>([]);
  const [streaming,setStreaming]=useState<Record<string,string>>({});
  const [selectedRunId,setSelectedRunId]=useState<string|null>(null);
  const [mode,setMode]=useState<WorkMode>('conversation');
  const [inspectorOpen,setInspectorOpen]=useState(false);
  const [activityOpen,setActivityOpen]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [sending,setSending]=useState(false);
  const [resolvingApproval,setResolvingApproval]=useState<string|null>(null);
  const [jumpVisible,setJumpVisible]=useState(false);
  const sourceRef=useRef<EventSource|null>(null);
  const connectedRunRef=useRef<string|null>(null);
  const lastSequenceRef=useRef<Record<string,number>>({});
  const transcriptRef=useRef<HTMLDivElement|null>(null);
  const dispatchingCommandRef=useRef<string|null>(null);
  const autoOpenedPreviewRef=useRef<string|null>(null);

  const activeRun=snapshot?.active_run??null;
  const latestRun=snapshot?.latest_run??null;
  const isRunning=Boolean(activeRun&&!terminal(activeRun.status));
  const inspectRunId=selectedRunId??activeRun?.id??latestRun?.id??null;
  const workforceResources=snapshot?.workforce?.resources??[];
  const activeSteps=snapshot?.active_plan?.steps??[];
  const completedSteps=activeSteps.filter(step=>step.status==='completed').length;
  const previewUseful=Boolean(snapshot?.preview?.url||snapshot?.preview?.status==='healthy'||snapshot?.git?.files?.length);

  const refresh=useCallback(async()=>{
    if(!project)return;
    try{
      const [s,c,r,a,t]=await Promise.all([
        api.getWorkspaceSnapshotV3(project.id),
        api.getConversation(project.id),
        api.listWorkspaceRunsV3(project.id),
        api.listAgentsV2(),
        api.listTeamsV3(),
      ]);
      setSnapshot(s);setConversation(c);setRuns(r);setAgents(a);setTeams(t);
      setSelectedRunId(cur=>cur&&r.some(x=>x.id===cur)?cur:s.active_run?.id??s.latest_run?.id??r[0]?.id??null);
      setError(null);
    }catch(reason){setError(reason instanceof Error?reason.message:'Falha ao carregar o Trabalho.')}
  },[project?.id]);

  const connect=useCallback(async(runId:string)=>{
    if(!project||connectedRunRef.current===runId)return;
    sourceRef.current?.close();connectedRunRef.current=runId;
    const url=await api.getChatStreamUrl(runId,lastSequenceRef.current[runId]??0);
    const source=new EventSource(url);sourceRef.current=source;
    const handle=(event:MessageEvent)=>{
      let envelope:ChatStreamEnvelope;try{envelope=JSON.parse(event.data)}catch{return}
      lastSequenceRef.current[runId]=Math.max(lastSequenceRef.current[runId]??0,envelope.sequence);
      setLiveEvents(cur=>[envelope,...cur.filter(x=>!(x.run_id===envelope.run_id&&x.sequence===envelope.sequence))].slice(0,240));
      if(envelope.event==='response.delta'){
        const key=workerKey(envelope.data),delta=typeof envelope.data.text==='string'?envelope.data.text:'';
        if(delta)setStreaming(cur=>({...cur,[key]:(cur[key]??'')+delta}));
      }
      if(envelope.event==='response.completed'){
        const key=workerKey(envelope.data);
        setStreaming(cur=>{const next={...cur};delete next[key];return next});
        void api.getConversation(project.id).then(setConversation).catch(()=>undefined);
      }
      if(envelope.event==='run.completed'||envelope.event==='run.failed'||envelope.event==='run.cancelled'){
        source.close();if(sourceRef.current===source)sourceRef.current=null;connectedRunRef.current=null;setStreaming({});
        window.setTimeout(()=>void refresh(),120);
      }
    };
    EVENTS.forEach(name=>source.addEventListener(name,handle as EventListener));
    source.onerror=()=>{void api.getChatRun(runId).then(run=>{if(terminal(run.status)){source.close();connectedRunRef.current=null;void refresh()}}).catch(()=>undefined)};
  },[project?.id,refresh]);

  useEffect(()=>{
    sourceRef.current?.close();connectedRunRef.current=null;lastSequenceRef.current={};
    setLiveEvents([]);setStreaming({});setSnapshot(null);setConversation(null);setRuns([]);setMode('conversation');setInspectorOpen(false);setActivityOpen(false);autoOpenedPreviewRef.current=null;
    void refresh();
    return()=>sourceRef.current?.close();
  },[project?.id,refresh]);

  useEffect(()=>{
    const preview=snapshot?.preview;
    if(mode!=='conversation'||!preview||preview.status!=='healthy'||!preview.url)return;
    const key=preview.id+':'+(preview.updated_at??preview.url);
    if(autoOpenedPreviewRef.current===key)return;
    autoOpenedPreviewRef.current=key;
    setInspectorOpen(true);
  },[mode,snapshot?.preview?.id,snapshot?.preview?.status,snapshot?.preview?.url,snapshot?.preview?.updated_at]);

  useEffect(()=>{if(activeRun?.id)void connect(activeRun.id)},[activeRun?.id,connect]);
  useEffect(()=>{if(!project)return;const timer=window.setInterval(()=>void refresh(),2500);return()=>window.clearInterval(timer)},[project?.id,refresh]);

  useEffect(()=>{
    if(!project||isRunning||sending||!snapshot)return;
    const next=snapshot.pending_commands.find(x=>(x.command_type==='enqueue'||x.command_type==='interrupt')&&x.status==='pending');
    if(!next||dispatchingCommandRef.current===next.id)return;
    dispatchingCommandRef.current=next.id;setSending(true);
    void api.startChatRun({project_id:project.id,conversation_id:conversation?.conversation_id,message:next.message,target:next.target||'auto'})
      .then(async receipt=>{await api.markWorkspaceCommandDispatchedV3(next.id);setSelectedRunId(receipt.run_id);await refresh();await connect(receipt.run_id)})
      .catch(reason=>setError(humanError(reason)))
      .finally(()=>{dispatchingCommandRef.current=null;setSending(false)});
  },[project?.id,isRunning,snapshot?.pending_commands.map(x=>x.id+':'+x.status).join(','),sending,conversation?.conversation_id,refresh,connect]);

  const workerNames=useMemo(()=>{
    const names=new Map<string,string>();
    agents.forEach(agent=>names.set('agent:'+agent.id,agent.name));
    teams.forEach(team=>(team.subagents??[]).forEach(sub=>names.set('subagent:'+sub.id,sub.name)));
    return names;
  },[agents,teams]);

  const nameForMessage=(item:any)=>{
    if(item.role==='user')return'Você';
    const metadata=item.metadata??{};
    if(typeof metadata.subagent_id==='string')return workerNames.get('subagent:'+metadata.subagent_id)??'Especialista';
    if(item.agent_id)return workerNames.get('agent:'+item.agent_id)??item.agent_id;
    return'Agent Office';
  };

  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();if(!project||!message.trim()||sending)return;
    const text=message.trim();setMessage('');setSending(true);setError(null);
    try{
      if(isRunning&&activeRun){
        await api.sendWorkspaceCommandV3(project.id,{command_type:activeAction,message:text,target,chat_run_id:activeRun.id,execution_plan_id:snapshot?.active_plan?.id});
        setConversation(cur=>cur?{...cur,messages:[...cur.messages,{id:'local-'+Date.now(),role:'user',agent_id:null,content:text,created_at:new Date().toISOString(),metadata:{workspace_command:activeAction,pending:true}}]}:cur);
        await refresh();
      }else{
        const receipt=await api.startChatRun({project_id:project.id,conversation_id:conversation?.conversation_id,message:text,target});
        setSelectedRunId(receipt.run_id);
        setConversation(cur=>cur?{...cur,messages:[...cur.messages,{id:'local-'+Date.now(),role:'user',agent_id:null,content:text,created_at:new Date().toISOString()}]}:cur);
        await refresh();await connect(receipt.run_id);
      }
    }catch(reason){setMessage(text);setError(humanError(reason))}
    finally{setSending(false)}
  };

  const resolveApproval=async(approval:ToolApproval,status:'approved'|'denied')=>{
    setResolvingApproval(approval.id);
    try{await api.resolveToolApprovalV2(approval.id,status);await refresh()}
    catch(reason){setError(humanError(reason))}
    finally{setResolvingApproval(null)}
  };

  const onTranscriptScroll=()=>{const element=transcriptRef.current;if(!element)return;setJumpVisible(element.scrollHeight-element.scrollTop-element.clientHeight>180)};
  useEffect(()=>{const element=transcriptRef.current;if(!element||jumpVisible)return;element.scrollTop=element.scrollHeight},[conversation?.messages.length,Object.values(streaming).join('').length,jumpVisible]);

  if(!project)return <div className="work-v2-empty"><V2EmptyState title="Escolha um Project" description="Selecione ou crie um Project para começar a trabalhar."/></div>;

  const statusTone=isRunning?'live':activeRun?.status==='failed'?'danger':activeRun?.status==='completed'?'success':'neutral';

  return <div className={'work-v2-shell '+(inspectorOpen?'inspector-open':'')}>
    <header className="work-v2-header">
      <div className="work-v2-heading">
        <strong>{project.name}</strong>
        <span>{snapshot?.git.branch&&snapshot.git.branch!=='—'?snapshot.git.branch:'Project ativo'}</span>
      </div>
      <V2Tabs<WorkMode> label="Modo de trabalho" items={[{key:'conversation',label:'Conversa'},{key:'sala',label:'Sala'}]} value={mode} onChange={setMode}/>
      <div className="work-v2-header-actions">
        <V2Status tone={statusTone}>{stateLabel(activeRun?.status)}</V2Status>
        <button type="button" className="v2-quiet-button" onClick={()=>setActivityOpen(true)}>Atividade{isRunning?' · ao vivo':''}</button>
        {(previewUseful||inspectRunId)&&<button type="button" className={inspectorOpen?'v2-quiet-button active':'v2-quiet-button'} onClick={()=>setInspectorOpen(value=>!value)}>Inspecionar</button>}
      </div>
    </header>

    {mode==='sala'
      ? <div className="work-v2-sala"><OfficeView project={project} focus="office"/></div>
      : <div className="work-v2-main">
          <section className="work-v2-conversation">
            <div className="work-v2-transcript" ref={transcriptRef} onScroll={onTranscriptScroll}>
              {!conversation?.messages.length&&!Object.keys(streaming).length&&<V2EmptyState title="Pronto para começar" description="Descreva o que você quer criar, corrigir ou investigar."/>}

              {conversation?.messages.map((item:any)=><article key={item.id} className={'work-v2-message '+item.role}>
                <div className="work-v2-avatar" aria-hidden="true">{item.role==='user'?'P':nameForMessage(item).slice(0,1).toUpperCase()}</div>
                <div className="work-v2-message-body">
                  <div className="work-v2-message-meta"><strong>{nameForMessage(item)}</strong><span>{shortTime(item.created_at)}</span></div>
                  <p>{item.content}</p>
                </div>
              </article>)}

              {Object.entries(streaming).map(([key,text])=><article key={key} className="work-v2-message assistant streaming">
                <div className="work-v2-avatar" aria-hidden="true">{(workerNames.get(key)??'A').slice(0,1).toUpperCase()}</div>
                <div className="work-v2-message-body"><div className="work-v2-message-meta"><strong>{workerNames.get(key)??'Agent Office'}</strong><span>ao vivo</span></div><p>{text}<i className="work-v2-caret">▍</i></p></div>
              </article>)}

              {isRunning&&<button type="button" className="work-v2-execution-summary" onClick={()=>setActivityOpen(true)}>
                <span className="work-v2-live-dot" aria-hidden="true"/>
                <div>
                  <strong>Construindo</strong>
                  <span>{workforceResources.length?workforceResources.length+' recursos trabalhando juntos':'Agent Office trabalhando'}{activeSteps.length?' · '+completedSteps+' de '+activeSteps.length+' etapas':''}</span>
                </div>
                <span>Ver execução →</span>
              </button>}

              {snapshot?.pending_approvals.map(approval=><section className="work-v2-approval" key={approval.id}>
                <div><strong>Aprovação necessária</strong><p>{approval.reason||'Esta ação pode alterar algo fora da conversa.'}</p><small>{approval.tool_name}</small></div>
                <div><button type="button" disabled={resolvingApproval===approval.id} onClick={()=>void resolveApproval(approval,'denied')}>Negar</button><button type="button" className="primary" disabled={resolvingApproval===approval.id} onClick={()=>void resolveApproval(approval,'approved')}>Aprovar</button></div>
              </section>)}

              {snapshot?.pending_commands.filter(command=>command.command_type!=='orient').map(command=><section className="work-v2-queued" key={command.id}><div><strong>{command.command_type==='interrupt'?'Nova direção pendente':'Próxima instrução'}</strong><p>{command.message}</p></div><button type="button" onClick={()=>void api.cancelWorkspaceCommandV3(command.id).then(refresh)}>Remover</button></section>)}

              {jumpVisible&&<button type="button" className="work-v2-jump" onClick={()=>{const element=transcriptRef.current;if(element)element.scrollTop=element.scrollHeight;setJumpVisible(false)}}>↓ Mais recente</button>}
            </div>

            <form className="work-v2-composer" onSubmit={submit}>
              {isRunning&&<div className="work-v2-command-mode">
                <button type="button" className={activeAction==='orient'?'active':''} onClick={()=>setActiveAction('orient')}>Orientar</button>
                <button type="button" className={activeAction==='enqueue'?'active':''} onClick={()=>setActiveAction('enqueue')}>Depois</button>
                <button type="button" className={activeAction==='interrupt'?'active danger':''} onClick={()=>setActiveAction('interrupt')}>Mudar agora</button>
              </div>}
              <textarea value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit()}}} placeholder={isRunning?'Dê uma orientação ou peça outra coisa…':'Peça algo ao Agent Office…'} rows={3}/>
              <div className="work-v2-composer-footer">
                <span>{isRunning?'A execução continua enquanto você conversa.':'Pronto para iniciar.'}</span>
                <div><select aria-label="Destino" value={target} onChange={e=>setTarget(e.target.value)}><option value="auto">Auto</option><option value="team">Equipe</option>{agents.filter(agent=>agent.enabled&&agent.provider_id&&agent.model_id).map(agent=><option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><button className="work-v2-send" disabled={sending||!message.trim()} aria-label="Enviar">{sending?'•••':'➤'}</button></div>
              </div>
              {error&&<div className="work-v2-error" role="alert">{error}</div>}
            </form>
          </section>

          {inspectorOpen&&<section className="work-v2-inspector" aria-label="Inspector">
            <div className="work-v2-inspector-head"><div><strong>Inspector</strong><span>{previewUseful?'Resultado e detalhes':'Detalhes da execução'}</span></div><button type="button" onClick={()=>setInspectorOpen(false)} aria-label="Fechar Inspector">×</button></div>
            <Workbench project={project} snapshot={snapshot} runId={inspectRunId} liveEvents={liveEvents} contextual/>
          </section>}
        </div>}

    <V2Drawer open={activityOpen} title="Atividade da execução" onClose={()=>setActivityOpen(false)} className="work-v2-activity-drawer">
      <div className="work-v2-activity-overview">
        <V2Status tone={statusTone}>{stateLabel(activeRun?.status)}</V2Status>
        {activeRun?.started_at&&<span>Iniciada {new Date(activeRun.started_at).toLocaleString('pt-BR')}</span>}
      </div>

      {activeSteps.length>0&&<section className="work-v2-activity-section"><h3>Etapas</h3><div className="work-v2-step-list">{activeSteps.map(step=><div key={step.id} className={'work-v2-step '+step.status}><span>{step.status==='completed'?'✓':step.status==='running'?'●':'○'}</span><div><strong>{step.title||step.key}</strong><small>{step.resume_state}</small></div></div>)}</div></section>}

      {workforceResources.length>0&&<section className="work-v2-activity-section"><h3>Quem está trabalhando</h3><div className="work-v2-worker-list">{workforceResources.map(resource=><div key={resource.worker_kind+':'+resource.worker_id}><span className="work-v2-worker-icon">{resource.worker_kind.slice(0,1).toUpperCase()}</span><div><strong>{workerNames.get(resource.worker_kind+':'+resource.worker_id)??resource.worker_id}</strong><small>{resource.reason||resource.worker_kind}</small></div></div>)}</div></section>}

      <section className="work-v2-activity-section"><h3>Execuções recentes</h3><div className="work-v2-run-list">{runs.slice(0,20).map(run=><button type="button" key={run.id} className={inspectRunId===run.id?'active':''} onClick={()=>{setSelectedRunId(run.id);setInspectorOpen(true)}}><span>{run.status==='completed'?'✓':run.status==='failed'?'!':run.status==='cancelled'?'×':'●'}</span><div><strong>{stateLabel(run.status)}</strong><small>{new Date(run.started_at).toLocaleString('pt-BR')}</small></div></button>)}{!runs.length&&<span className="muted">Nenhuma execução ainda.</span>}</div></section>

      {liveEvents.length>0&&<section className="work-v2-activity-section"><h3>Agora</h3><div className="work-v2-event-list">{liveEvents.slice(0,20).map(event=><div key={event.run_id+':'+event.sequence}><span>{shortTime(event.timestamp)}</span><strong>{eventLabel(event.event)}</strong></div>)}</div></section>}
    </V2Drawer>
  </div>;
}
