import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentProfile, ChatRun, ChatStreamEnvelope, Conversation, KnowledgeItem, Project, ResourceFile, Team, ToolApproval, WorkspaceSnapshot } from './types.js';
import { api } from './api.js';
import { OfficeView } from './OfficeView.js';
import { Workbench } from './dev-chat/Workbench.js';
import { V2Drawer, V2EmptyState, V2Status, V2Tabs } from './shell/V2Primitives.js';
import { MessageContent } from './conversation/MessageContent.js';
import { PendingAttachmentCard, StoredAttachmentCard } from './conversation/ResourcePreview.js';
import { VoiceInputButton } from './conversation/VoiceInputButton.js';
import { applyComposerSuggestion, composerSuggestions, parseComposerInput } from './conversation/ComposerDirectives.js';

type ActiveAction='orient'|'enqueue'|'interrupt';
type WorkMode='conversation'|'sala';
const EVENTS=['run.created','worker.state','agent.state','response.delta','response.streaming_fallback','response.completed','handoff.created','usage.updated','tool.started','tool.completed','tool.approval_required','run.oriented','execution.step.started','execution.step.telemetry','execution.step.completed','execution.step.failed','run.completed','run.failed','run.cancelled'];

function terminal(status?:string){return status==='completed'||status==='failed'||status==='cancelled'}
function humanError(value:unknown){const text=value instanceof Error?value.message:String(value||'Falha na execução.');return text.replace(/^CHAT_/,'').replace(/_/g,' ').toLowerCase()}
function workerKey(data:Record<string,unknown>){if(typeof data.subagent_id==='string')return 'subagent:'+data.subagent_id;if(typeof data.agent_id==='string')return 'agent:'+data.agent_id;return 'system'}
function shortTime(value:string){return new Date(value).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
function formatElapsed(ms:number){
  const total=Math.max(0,Math.floor(ms/1000)),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),sec=total%60;
  return h>0?`${h}h ${String(m).padStart(2,'0')}m`:m>0?`${m}m ${String(sec).padStart(2,'0')}s`:`${sec}s`;
}
function telemetrySummary(event:ChatStreamEnvelope){
  const data=event.data,operation=typeof data.operation==='string'?data.operation:'',target=typeof data.target==='string'?data.target:'',command=typeof data.command==='string'?data.command:'',tool=typeof data.tool_name==='string'?data.tool_name:'';
  if(event.event==='execution.step.started')return 'Etapa iniciada';
  if(event.event==='execution.step.completed')return 'Etapa validada';
  if(event.event==='execution.step.failed')return typeof data.message==='string'?data.message:'Etapa precisa de correção';
  if(event.event==='execution.step.telemetry')return typeof data.message==='string'?data.message:operation||'Validação';
  if(event.event==='tool.started')return operation+(target?' · '+target:command?' · '+command:'');
  if(event.event==='tool.completed')return (operation||('Concluiu '+tool))+(target?' · '+target:command?' · '+command:'');
  if(event.event==='handoff.created')return 'Handoff entre recursos';
  if(event.event==='worker.state')return typeof data.activity==='string'?data.activity:'Estado atualizado';
  return eventLabel(event.event);
}
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
  const [pendingFiles,setPendingFiles]=useState<File[]>([]);
  const [uploading,setUploading]=useState(false);
  const [target,setTarget]=useState('auto');
  const [activeAction,setActiveAction]=useState<ActiveAction>('orient');
  const [liveEvents,setLiveEvents]=useState<ChatStreamEnvelope[]>([]);
  const [streaming,setStreaming]=useState<Record<string,string>>({});
  const [selectedRunId,setSelectedRunId]=useState<string|null>(null);
  const [mode,setMode]=useState<WorkMode>('conversation');
  const [inspectorOpen,setInspectorOpen]=useState(false);
  const [activityOpen,setActivityOpen]=useState(false);
  const [knowledgeOpen,setKnowledgeOpen]=useState(false);
  const [projectKnowledge,setProjectKnowledge]=useState<KnowledgeItem[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [sending,setSending]=useState(false);
  const [resolvingApproval,setResolvingApproval]=useState<string|null>(null);
  const [jumpVisible,setJumpVisible]=useState(false);
  const [planExpanded,setPlanExpanded]=useState(false);
  const [clock,setClock]=useState(Date.now());
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
  const telemetryEvents=useMemo(()=>liveEvents.filter(event=>['tool.started','tool.completed','execution.step.started','execution.step.telemetry','execution.step.completed','execution.step.failed','handoff.created','worker.state'].includes(event.event)),[liveEvents]);
  const toolCount=liveEvents.filter(event=>event.event==='tool.completed'&&event.data.ok!==false).length;
  const touchedTargets=useMemo(()=>[...new Set(liveEvents.map(event=>typeof event.data.target==='string'?event.data.target:'').filter(Boolean))],[liveEvents]);
  const runElapsed=activeRun?.started_at?formatElapsed(clock-new Date(activeRun.started_at).getTime()):'0s';

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
    setLiveEvents([]);setStreaming({});setSnapshot(null);setConversation(null);setRuns([]);setMode('conversation');setInspectorOpen(false);setActivityOpen(false);setPlanExpanded(false);autoOpenedPreviewRef.current=null;
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
  useEffect(()=>{if(!isRunning)return;setClock(Date.now());const timer=window.setInterval(()=>setClock(Date.now()),1000);return()=>window.clearInterval(timer)},[isRunning,activeRun?.id]);
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

  const commandHints=useMemo(()=>composerSuggestions(message,agents),[message,agents]);
  const addPendingFiles=(incoming:File[])=>setPendingFiles(cur=>[...cur,...incoming].filter((file,index,all)=>all.findIndex(x=>x.name===file.name&&x.size===file.size&&x.lastModified===file.lastModified)===index).slice(0,12));
  const refreshProjectKnowledge=useCallback(async()=>{if(!project)return;try{setProjectKnowledge(await api.listKnowledge('project',project.id))}catch{}},[project?.id]);
  useEffect(()=>{void refreshProjectKnowledge()},[refreshProjectKnowledge]);

  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();if(!project||(!message.trim()&&!pendingFiles.length)||sending)return;
    const parsed=parseComposerInput(message,agents);const text=parsed.message||'Analise os arquivos anexados.';const actualTarget=parsed.target??target;const files=pendingFiles.slice();const optimisticId='local-'+Date.now();
    setMessage('');setPendingFiles([]);setSending(true);setUploading(Boolean(files.length));setError(null);
    setConversation(cur=>cur?{...cur,messages:[...cur.messages,{id:optimisticId,role:'user',agent_id:null,content:text,created_at:new Date().toISOString(),metadata:{pending:true,pending_file_names:files.map(file=>file.name)}}]}:cur);
    let uploaded:ResourceFile[]=[];
    try{
      if(files.length)uploaded=await Promise.all(files.map(file=>api.uploadResource(project.id,file,'chat')));
      setConversation(cur=>cur?{...cur,messages:cur.messages.map(item=>item.id===optimisticId?{...item,metadata:{...item.metadata,pending:false,attachments:uploaded,attachment_ids:uploaded.map(file=>file.id)}}:item)}:cur);
      if(isRunning&&activeRun){
        await api.sendWorkspaceCommandV3(project.id,{command_type:activeAction,message:text,target:actualTarget,chat_run_id:activeRun.id,execution_plan_id:snapshot?.active_plan?.id,attachment_ids:uploaded.map(file=>file.id)});
        await refresh();
      }else{
        const receipt=await api.startChatRun({project_id:project.id,conversation_id:conversation?.conversation_id,message:text,target:actualTarget,attachment_ids:uploaded.map(file=>file.id),execution_policy:parsed.execution_policy,tool_hint:parsed.tool_hint,directives:parsed.directives});
        setSelectedRunId(receipt.run_id);
        await refresh();await connect(receipt.run_id);
      }
    }catch(reason){
      setConversation(cur=>cur?{...cur,messages:cur.messages.filter(item=>item.id!==optimisticId)}:cur);
      setMessage(text);setPendingFiles(files);setError(humanError(reason))
    }
    finally{setSending(false);setUploading(false)}
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
        <button type="button" className="v2-quiet-button" onClick={()=>setKnowledgeOpen(true)}>Conhecimento</button><button type="button" className="v2-quiet-button" onClick={()=>setActivityOpen(true)}>Atividade{isRunning?' · ao vivo':''}</button>
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
                  <MessageContent content={item.content}/>
                  {Array.isArray(item.metadata?.attachments)&&item.metadata.attachments.length>0&&<div className="work-v2-attachments">{item.metadata.attachments.map((file:ResourceFile)=><StoredAttachmentCard key={file.id} file={file}/>)}</div>}
                </div>
              </article>)}

              {Object.entries(streaming).map(([key,text])=><article key={key} className="work-v2-message assistant streaming">
                <div className="work-v2-avatar" aria-hidden="true">{(workerNames.get(key)??'A').slice(0,1).toUpperCase()}</div>
                <div className="work-v2-message-body"><div className="work-v2-message-meta"><strong>{workerNames.get(key)??'Agent Office'}</strong><span>ao vivo</span></div><MessageContent content={text} streaming/></div>
              </article>)}



              {snapshot?.pending_approvals.map(approval=><section className="work-v2-approval" key={approval.id}>
                <div><strong>Aprovação necessária</strong><p>{approval.reason||'Esta ação pode alterar algo fora da conversa.'}</p><small>{approval.tool_name}</small></div>
                <div><button type="button" disabled={resolvingApproval===approval.id} onClick={()=>void resolveApproval(approval,'denied')}>Negar</button><button type="button" className="primary" disabled={resolvingApproval===approval.id} onClick={()=>void resolveApproval(approval,'approved')}>Aprovar</button></div>
              </section>)}

              {snapshot?.pending_commands.filter(command=>command.command_type!=='orient').map(command=><section className="work-v2-queued" key={command.id}><div><strong>{command.command_type==='interrupt'?'Nova direção pendente':'Próxima instrução'}</strong><p>{command.message}</p></div><button type="button" onClick={()=>void api.cancelWorkspaceCommandV3(command.id).then(refresh)}>Remover</button></section>)}

              {jumpVisible&&<button type="button" className="work-v2-jump" onClick={()=>{const element=transcriptRef.current;if(element)element.scrollTop=element.scrollHeight;setJumpVisible(false)}}>↓ Mais recente</button>}
            </div>

            {(activeSteps.length>0||isRunning)&&<section className={'work-v2-goal-dock '+(planExpanded?'expanded':'')}>
              <button type="button" className="work-v2-goal-summary" onClick={()=>setPlanExpanded(value=>!value)}>
                <span className="work-v2-live-dot" aria-hidden="true"/>
                <div className="work-v2-goal-copy">
                  <strong>{snapshot?.active_plan?.goal||'Goal em execução'}</strong>
                  <span>{telemetryEvents[0]?telemetrySummary(telemetryEvents[0]):activeSteps.find(step=>step.status==='running')?.title||activeSteps.find(step=>step.status!=='completed')?.title||(isRunning?'Executando':'Concluído')}</span>
                </div>
                <div className="work-v2-goal-stats"><span>{runElapsed}</span><span>{toolCount} ações</span>{touchedTargets.length>0&&<span>{touchedTargets.length} alvos</span>}</div>
                <span className="work-v2-goal-progress">{completedSteps}/{activeSteps.length||1}</span>
                <span className="work-v2-goal-caret">{planExpanded?'⌃':'⌄'}</span>
              </button>
              {telemetryEvents.length>0&&<div className="work-v2-live-trace">{telemetryEvents.slice(0,4).map(event=><div key={event.run_id+':'+event.sequence} className={'trace-row '+event.event.replace(/\./g,'-')}><span className="trace-dot"/><div><strong>{telemetrySummary(event)}</strong><small>{shortTime(event.timestamp)}{typeof event.data.duration_ms==='number'?' · '+formatElapsed(event.data.duration_ms):''}</small></div></div>)}</div>}
              {planExpanded&&<div className="work-v2-goal-details">
                <div className="work-v2-goal-steps">{activeSteps.map(step=>{
                  const events=liveEvents.filter(event=>event.data.execution_step_id===step.id&&event.event!=='response.delta').slice(0,4);
                  const attempt=(snapshot?.active_plan?.attempts??[]).filter((item:any)=>item.step_id===step.id).at(-1) as any;
                  const elapsed=attempt?.started_at?formatElapsed((attempt.ended_at?new Date(attempt.ended_at).getTime():clock)-new Date(attempt.started_at).getTime()):null;
                  return <div key={step.id} className={'goal-step-card '+step.status}><div className="goal-step"><span>{step.status==='completed'?'✓':step.status==='running'?'●':step.status==='failed'?'!':'○'}</span><div><strong>{step.title||step.key}</strong><small>{step.status==='completed'?'Concluído':step.status==='running'?'Em andamento':step.status==='failed'?'Falhou':'Pendente'}{elapsed?' · '+elapsed:''}</small></div></div>{events.length>0&&<div className="goal-step-events">{events.map(event=><div key={event.run_id+':'+event.sequence}><span>›</span><div><strong>{telemetrySummary(event)}</strong><small>{shortTime(event.timestamp)}{typeof event.data.duration_ms==='number'?' · '+formatElapsed(event.data.duration_ms):''}</small></div></div>)}</div>}</div>
                })}</div>
                <button type="button" className="work-v2-goal-activity" onClick={()=>setActivityOpen(true)}>Abrir atividade detalhada →</button>
              </div>}
            </section>}

            <form className="work-v2-composer" onSubmit={submit} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='copy'}} onDrop={e=>{e.preventDefault();addPendingFiles(Array.from(e.dataTransfer.files??[]))}}>
              {isRunning&&<div className="work-v2-command-mode">
                <button type="button" className={activeAction==='orient'?'active':''} onClick={()=>setActiveAction('orient')}>Orientar</button>
                <button type="button" className={activeAction==='enqueue'?'active':''} onClick={()=>setActiveAction('enqueue')}>Depois</button>
                <button type="button" className={activeAction==='interrupt'?'active danger':''} onClick={()=>setActiveAction('interrupt')}>Mudar agora</button>
              </div>}
              {pendingFiles.length>0&&<div className="work-v2-pending-files">{pendingFiles.map((file,index)=><PendingAttachmentCard key={file.name+'-'+index} file={file} onRemove={()=>setPendingFiles(cur=>cur.filter((_,i)=>i!==index))}/>)}</div>}
              <div className="composer-input-wrap"><textarea value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit()}}} placeholder={isRunning?'Dê uma orientação ou peça outra coisa…':'Peça algo ao Agent Office…'} rows={3}/>
              {commandHints.length>0&&<div className="composer-command-hints">{commandHints.map(item=><button type="button" key={item.token} onMouseDown={e=>e.preventDefault()} onClick={()=>setMessage(current=>applyComposerSuggestion(current,item.token))}><strong>{item.token}</strong><span>{item.label}</span></button>)}</div>}</div>
              <div className="work-v2-composer-footer">
                <span>{isRunning?'A execução continua enquanto você conversa.':'Pronto para iniciar.'}</span>
                <div className="work-v2-composer-actions"><label className="work-v2-file-button" title="Anexar arquivos">+<input type="file" multiple onChange={e=>{const next=Array.from(e.target.files??[]);addPendingFiles(next);e.currentTarget.value=''}}/></label><VoiceInputButton disabled={sending} onTranscript={text=>setMessage(current=>current.trim()?current.trimEnd()+' '+text:text)}/><select aria-label="Destino" value={target} onChange={e=>setTarget(e.target.value)}><option value="auto">Auto</option><option value="team">Equipe</option>{agents.filter(agent=>agent.enabled&&agent.provider_id&&agent.model_id).map(agent=><option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><button className="work-v2-send" disabled={sending||(!message.trim()&&!pendingFiles.length)} aria-label="Enviar">{uploading?'↑':sending?'•••':'➤'}</button></div>
              </div>
              {error&&<div className="work-v2-error" role="alert">{error}</div>}
            </form>
          </section>

          {inspectorOpen&&<section className="work-v2-inspector" aria-label="Inspector">
            <div className="work-v2-inspector-head"><div><strong>Inspector</strong><span>{previewUseful?'Resultado e detalhes':'Detalhes da execução'}</span></div><button type="button" onClick={()=>setInspectorOpen(false)} aria-label="Fechar Inspector">×</button></div>
            <Workbench project={project} snapshot={snapshot} runId={inspectRunId} liveEvents={liveEvents} contextual/>
          </section>}
        </div>}

    <V2Drawer open={knowledgeOpen} title="Conhecimento do Project" onClose={()=>setKnowledgeOpen(false)} className="work-v2-knowledge-drawer">
      <div className="team-v2-callout"><strong>Contexto persistente de {project.name}</strong><p>Arquivos daqui ficam disponíveis para qualquer Agent ou Subagent que trabalhar neste Project.</p></div>
      <label className="knowledge-upload">+ Adicionar arquivo ao Project<input type="file" multiple onChange={async e=>{const files=Array.from(e.target.files??[]);e.currentTarget.value='';if(!files.length)return;setError(null);try{for(const file of files){const resource=await api.uploadResource(project.id,file,'project',project.id);await api.addKnowledge({scope_type:'project',scope_id:project.id,resource_id:resource.id,title:file.name})}await refreshProjectKnowledge()}catch(reason){setError(humanError(reason))}}}/></label>
      <div className="knowledge-list">{projectKnowledge.map(item=><div key={item.id}><div><strong>{item.title}</strong><small>{item.resource?.mime_type||'arquivo'} · {item.resource?.metadata?.text_extracted?'texto extraído':'multimodal/arquivo preservado'}</small></div><button type="button" onClick={()=>void api.deleteKnowledge(item.id).then(refreshProjectKnowledge)}>Remover</button></div>)}{!projectKnowledge.length&&<V2EmptyState title="Nenhum conhecimento do Project" description="Adicione documentos, mídia, código ou referências que todos os workers deste Project devem conhecer."/>}</div>
    </V2Drawer>

    <V2Drawer open={activityOpen} title="Atividade" onClose={()=>setActivityOpen(false)} className="work-v2-activity-drawer">
      <div className="work-v2-activity-overview">
        <div><V2Status tone={statusTone}>{stateLabel(activeRun?.status)}</V2Status>{activeRun?.started_at&&<span>Desde {shortTime(activeRun.started_at)}</span>}</div>
        {inspectRunId&&<button type="button" className="v2-quiet-button" onClick={()=>{setInspectorOpen(true);setActivityOpen(false)}}>Abrir Inspector</button>}
      </div>

      {activeSteps.length>0&&<section className="work-v2-activity-section"><h3>Progresso</h3><div className="work-v2-step-list">{activeSteps.map(step=><div key={step.id} className={'work-v2-step '+step.status}><span>{step.status==='completed'?'✓':step.status==='running'?'●':'○'}</span><div><strong>{step.title||step.key}</strong>{step.status==='running'&&<small>Em andamento</small>}</div></div>)}</div></section>}

      {workforceResources.length>0&&<section className="work-v2-activity-section"><h3>Trabalhando agora</h3><div className="work-v2-worker-list">{workforceResources.map(resource=><div key={resource.worker_kind+':'+resource.worker_id}><span className="work-v2-worker-icon">{resource.worker_kind.slice(0,1).toUpperCase()}</span><div><strong>{workerNames.get(resource.worker_kind+':'+resource.worker_id)??'Recurso'}</strong><small>{resource.reason||'Participando desta execução'}</small></div></div>)}</div></section>}

      {liveEvents.length>0&&<section className="work-v2-activity-section"><h3>Agora</h3><div className="work-v2-event-list human">{liveEvents.filter(event=>event.event!=='response.delta').slice(0,16).map(event=>{
        const name=workerNames.get(workerKey(event.data))??'Agent Office';
        const tool=typeof event.data.tool_name==='string'?event.data.tool_name:'';
        const detail=typeof event.data.message==='string'?event.data.message:typeof event.data.activity==='string'?event.data.activity:'';
        const summary=event.event==='tool.started'?name+' iniciou '+(tool||'uma ferramenta')
          :event.event==='tool.completed'?name+' concluiu '+(tool||'uma ação')
          :event.event==='tool.approval_required'?'Aprovação necessária para '+(tool||'uma ação')
          :event.event==='handoff.created'?'Trabalho repassado entre recursos'
          :event.event==='run.completed'?'Execução concluída'
          :event.event==='run.failed'?'Execução precisa de atenção'
          :event.event==='response.completed'?name+' concluiu uma resposta'
          :detail||eventLabel(event.event);
        return <button type="button" key={event.run_id+':'+event.sequence} onClick={()=>{setSelectedRunId(event.run_id);setInspectorOpen(true);setActivityOpen(false)}}><span className="work-v2-event-dot" aria-hidden="true"/><div><strong>{summary}</strong><small>{shortTime(event.timestamp)} · Ver detalhes</small></div></button>
      })}</div></section>}

      <details className="work-v2-activity-history"><summary>Execuções anteriores</summary><div className="work-v2-run-list">{runs.slice(0,12).map(run=><button type="button" key={run.id} className={inspectRunId===run.id?'active':''} onClick={()=>{setSelectedRunId(run.id);setInspectorOpen(true);setActivityOpen(false)}}><span>{run.status==='completed'?'✓':run.status==='failed'?'!':run.status==='cancelled'?'×':'●'}</span><div><strong>{stateLabel(run.status)}</strong><small>{new Date(run.started_at).toLocaleString('pt-BR')}</small></div></button>)}{!runs.length&&<span className="muted">Nenhuma execução ainda.</span>}</div></details>
    </V2Drawer>
  </div>;
}
