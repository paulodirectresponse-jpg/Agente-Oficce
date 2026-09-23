import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentProfile, ChatRun, ChatStreamEnvelope, Conversation, Project, Team, ToolApproval, WorkspaceSnapshot } from './types.js';
import { api } from './api.js';
import { Workbench } from './dev-chat/Workbench.js';

type ActiveAction='orient'|'enqueue'|'interrupt';
const EVENTS=['run.created','worker.state','agent.state','response.delta','response.streaming_fallback','response.completed','handoff.created','usage.updated','tool.started','tool.completed','tool.approval_required','run.oriented','run.completed','run.failed','run.cancelled'];

function time(value:string){return new Date(value).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
function terminal(status?:string){return status==='completed'||status==='failed'||status==='cancelled'}
function humanError(value:unknown){const text=value instanceof Error?value.message:String(value||'Falha na execução.');return text.replace(/^CHAT_/,'').replace(/_/g,' ').toLowerCase()}
function workerKey(data:Record<string,unknown>){if(typeof data.subagent_id==='string')return 'subagent:'+data.subagent_id;if(typeof data.agent_id==='string')return 'agent:'+data.agent_id;return 'system'}

export function DevChatView({project}:{project:Project|null}){
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
  const [error,setError]=useState<string|null>(null);
  const [sending,setSending]=useState(false);
  const [workbenchOpen,setWorkbenchOpen]=useState(true);
  const [leftOpen,setLeftOpen]=useState(true);
  const [resolvingApproval,setResolvingApproval]=useState<string|null>(null);
  const [jumpVisible,setJumpVisible]=useState(false);
  const sourceRef=useRef<EventSource|null>(null);
  const connectedRunRef=useRef<string|null>(null);
  const lastSequenceRef=useRef<Record<string,number>>({});
  const transcriptRef=useRef<HTMLDivElement|null>(null);
  const dispatchingCommandRef=useRef<string|null>(null);

  const activeRun=snapshot?.active_run??null;
  const isRunning=Boolean(activeRun&&!terminal(activeRun.status));
  const workbenchRunId=selectedRunId??activeRun?.id??snapshot?.latest_run?.id??null;

  const refresh=useCallback(async()=>{
    if(!project)return;
    try{
      const [s,c,r,a,t]=await Promise.all([
        api.getWorkspaceSnapshotV3(project.id),api.getConversation(project.id),api.listWorkspaceRunsV3(project.id),api.listAgentsV2(),api.listTeamsV3()
      ]);
      setSnapshot(s);setConversation(c);setRuns(r);setAgents(a);setTeams(t);
      setSelectedRunId(cur=>cur&&r.some(x=>x.id===cur)?cur:s.active_run?.id??s.latest_run?.id??r[0]?.id??null);
      setError(null);
    }catch(e){setError(e instanceof Error?e.message:'Falha ao carregar Workspace.')}
  },[project?.id]);

  const connect=useCallback(async(runId:string)=>{
    if(!project||connectedRunRef.current===runId)return;
    sourceRef.current?.close();connectedRunRef.current=runId;
    const url=await api.getChatStreamUrl(runId,lastSequenceRef.current[runId]??0);
    const source=new EventSource(url);sourceRef.current=source;
    const handle=(ev:MessageEvent)=>{
      let e:ChatStreamEnvelope;try{e=JSON.parse(ev.data)}catch{return}
      lastSequenceRef.current[runId]=Math.max(lastSequenceRef.current[runId]??0,e.sequence);
      setLiveEvents(cur=>[e,...cur.filter(x=>!(x.run_id===e.run_id&&x.sequence===e.sequence))].slice(0,240));
      if(e.event==='response.delta'){
        const key=workerKey(e.data),delta=typeof e.data.text==='string'?e.data.text:'';
        if(delta)setStreaming(cur=>({...cur,[key]:(cur[key]??'')+delta}));
      }
      if(e.event==='response.completed'){
        const key=workerKey(e.data);setStreaming(cur=>{const n={...cur};delete n[key];return n});
        void api.getConversation(project.id).then(setConversation).catch(()=>undefined);
      }
      if(e.event==='run.completed'||e.event==='run.failed'||e.event==='run.cancelled'){
        source.close();if(sourceRef.current===source)sourceRef.current=null;connectedRunRef.current=null;setStreaming({});
        window.setTimeout(()=>void refresh(),120);
      }
    };
    EVENTS.forEach(name=>source.addEventListener(name,handle as EventListener));
    source.onerror=()=>{void api.getChatRun(runId).then(run=>{if(terminal(run.status)){source.close();connectedRunRef.current=null;void refresh()}}).catch(()=>undefined)};
  },[project?.id,refresh]);

  useEffect(()=>{sourceRef.current?.close();connectedRunRef.current=null;lastSequenceRef.current={};setLiveEvents([]);setStreaming({});setSnapshot(null);setConversation(null);setRuns([]);void refresh();return()=>sourceRef.current?.close()},[project?.id,refresh]);
  useEffect(()=>{if(activeRun?.id)void connect(activeRun.id)},[activeRun?.id,connect]);
  useEffect(()=>{if(!project)return;const timer=window.setInterval(()=>void refresh(),2500);return()=>window.clearInterval(timer)},[project?.id,refresh]);

  // Persistent queue: when the active run terminates, dispatch the oldest queued/interrupt message once.
  useEffect(()=>{
    if(!project||isRunning||sending||!snapshot)return;
    const next=snapshot.pending_commands.find(x=>(x.command_type==='enqueue'||x.command_type==='interrupt')&&x.status==='pending');
    if(!next||dispatchingCommandRef.current===next.id)return;
    dispatchingCommandRef.current=next.id;
    setSending(true);
    void api.startChatRun({project_id:project.id,conversation_id:conversation?.conversation_id,message:next.message,target:next.target||'auto'})
      .then(async receipt=>{await api.markWorkspaceCommandDispatchedV3(next.id);setSelectedRunId(receipt.run_id);await refresh();await connect(receipt.run_id)})
      .catch(e=>setError(e instanceof Error?e.message:'Falha ao despachar mensagem da fila.'))
      .finally(()=>{dispatchingCommandRef.current=null;setSending(false)});
  },[project?.id,isRunning,snapshot?.pending_commands.map(x=>x.id+':'+x.status).join(','),sending,conversation?.conversation_id,refresh,connect]);

  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();if(!project||!message.trim()||sending)return;
    const text=message.trim();setMessage('');setSending(true);setError(null);
    try{
      if(isRunning&&activeRun){
        await api.sendWorkspaceCommandV3(project.id,{command_type:activeAction,message:text,target,chat_run_id:activeRun.id,execution_plan_id:snapshot?.active_plan?.id});
        setConversation(cur=>cur?{...cur,messages:[...cur.messages,{id:'local-'+Date.now(),role:'user',agent_id:null,content:text,created_at:new Date().toISOString(),metadata:{workspace_command:activeAction,pending:true}}]}:cur);
        await refresh();
      }else{
        const receipt=await api.startChatRun({project_id:project.id,conversation_id:conversation?.conversation_id,message:text,target});
        setSelectedRunId(receipt.run_id);setConversation(cur=>cur?{...cur,messages:[...cur.messages,{id:'local-'+Date.now(),role:'user',agent_id:null,content:text,created_at:new Date().toISOString()}]}:cur);
        await refresh();await connect(receipt.run_id);
      }
    }catch(reason){setMessage(text);setError(humanError(reason))}finally{setSending(false)}
  };

  const resolveApproval=async(a:ToolApproval,status:'approved'|'denied')=>{setResolvingApproval(a.id);try{await api.resolveToolApprovalV2(a.id,status);await refresh()}catch(e){setError(humanError(e))}finally{setResolvingApproval(null)}};

  const workerNames=useMemo(()=>{
    const m=new Map<string,string>();agents.forEach(a=>m.set('agent:'+a.id,a.name));teams.forEach(t=>(t.subagents??[]).forEach(s=>m.set('subagent:'+s.id,s.name)));return m
  },[agents,teams]);
  const nameForMessage=(m:any)=>{if(m.role==='user')return'Você';const md=m.metadata??{};if(typeof md.subagent_id==='string')return workerNames.get('subagent:'+md.subagent_id)??'Subagent';if(m.agent_id)return workerNames.get('agent:'+m.agent_id)??m.agent_id;return'Orquestrador'};
  const currentDecision=(activeRun??snapshot?.latest_run)?.metadata?.routing_decision as Record<string,unknown>|undefined;
  const workforceResources=snapshot?.workforce?.resources??[];

  const onTranscriptScroll=()=>{const el=transcriptRef.current;if(!el)return;setJumpVisible(el.scrollHeight-el.scrollTop-el.clientHeight>180)};
  useEffect(()=>{const el=transcriptRef.current;if(!el||jumpVisible)return;el.scrollTop=el.scrollHeight},[conversation?.messages.length,Object.values(streaming).join('').length,jumpVisible]);

  if(!project)return <div className="dev-chat-empty"><strong>Escolha um projeto</strong><span>O Chat Workspace precisa de um projeto ativo.</span></div>;

  return <div className={'dev-chat-shell '+(!workbenchOpen?'workbench-closed ':'')+(!leftOpen?'runbar-closed':'')}>
    <header className="dev-chat-topbar">
      <button className="dev-icon-button" onClick={()=>setLeftOpen(x=>!x)}>☷</button>
      <div className="dev-project-title"><strong>{project.name}</strong><span>{snapshot?.git.branch??'sem branch'}</span></div>
      <div className="dev-top-meta">
        <span className={'dev-run-status '+(activeRun?.status??'idle')}>{activeRun?.status??'idle'}</span>
        <span>Orchestrator · {String(currentDecision?.complexity??'—')}</span>
        <span>Workforce · {workforceResources.length||0}</span>
        <span>{(snapshot?.usage?.input_tokens??0)+(snapshot?.usage?.output_tokens??0)} tokens</span>
        <span className={'preview-mini '+(snapshot?.preview?.status??'stopped')}>Preview {snapshot?.preview?.status??'off'}</span>
      </div>
      <button className="dev-icon-button" onClick={()=>setWorkbenchOpen(x=>!x)}>{workbenchOpen?'›':'‹'}</button>
    </header>

    <aside className="dev-run-sidebar">
      <div className="dev-sidebar-section"><span className="office-kicker">Current Run</span>
        {activeRun?<div className="dev-current-run"><strong>{activeRun.id.slice(0,12)}</strong><span>{activeRun.status}</span><small>{activeRun.started_at?new Date(activeRun.started_at).toLocaleString('pt-BR'):''}</small></div>:<div className="dev-muted-card">Nenhum run ativo.</div>}
      </div>
      <div className="dev-sidebar-section"><span className="office-kicker">Plan</span>
        <div className="dev-plan-list">{snapshot?.active_plan?.steps?.map(s=><div key={s.id} className={'dev-plan-step '+s.status}><span>{s.status==='completed'?'✓':s.status==='running'?'●':'○'}</span><div><strong>{s.title||s.key}</strong><small>{s.resume_state}</small></div></div>)}{!snapshot?.active_plan?.steps?.length&&<small className="muted">Sem plano ativo.</small>}</div>
      </div>
      <div className="dev-sidebar-section"><span className="office-kicker">Workforce</span>
        <div className="dev-worker-list">{workforceResources.map(r=><div key={r.worker_kind+':'+r.worker_id}><span className={'worker-kind '+r.worker_kind}>{r.worker_kind[0].toUpperCase()}</span><div><strong>{workerNames.get(r.worker_kind+':'+r.worker_id)??r.worker_id}</strong><small>{r.reason||r.worker_kind}</small></div></div>)}{!workforceResources.length&&<small className="muted">Sem Workforce temporária.</small>}</div>
      </div>
      <div className="dev-sidebar-section grow"><span className="office-kicker">History</span><div className="dev-run-history">{runs.map(r=><button key={r.id} className={selectedRunId===r.id?'active':''} onClick={()=>setSelectedRunId(r.id)}><span>{r.status==='completed'?'✓':r.status==='failed'?'!':r.status==='cancelled'?'×':'●'}</span><div><strong>{r.id.slice(0,8)}</strong><small>{new Date(r.started_at).toLocaleString('pt-BR')}</small></div></button>)}</div></div>
    </aside>

    <main className="dev-chat-center">
      <div className="dev-transcript" ref={transcriptRef} onScroll={onTranscriptScroll}>
        {currentDecision&&<div className="dev-orchestrator-summary"><span>◆</span><div><strong>Orquestrador</strong><p>{String(currentDecision.explanation??currentDecision.normalized_goal??'Roteamento preparado.')}</p>{workforceResources.length>0&&<small>{workforceResources.length} recurso(s) selecionado(s) para esta execução.</small>}</div></div>}
        {conversation?.messages.map((m:any)=><div key={m.id} className={'dev-message '+m.role}>
          <div className="dev-message-avatar">{m.role==='user'?'P':nameForMessage(m).slice(0,1).toUpperCase()}</div><div className="dev-message-content"><div><strong>{nameForMessage(m)}</strong><span>{time(m.created_at)}</span>{m.metadata?.worker_kind&&<em>{String(m.metadata.worker_kind)}</em>}{m.metadata?.workspace_command&&<em>{String(m.metadata.workspace_command)}</em>}</div><p>{m.content}</p></div>
        </div>)}
        {Object.entries(streaming).map(([key,text])=><div key={key} className="dev-message assistant streaming"><div className="dev-message-avatar">{(workerNames.get(key)??'A').slice(0,1)}</div><div className="dev-message-content"><div><strong>{workerNames.get(key)??key}</strong><span>ao vivo</span></div><p>{text}<i className="dev-caret">▍</i></p></div></div>)}
        {snapshot?.pending_approvals.map(a=><div className="dev-approval-card" key={a.id}><span>◇</span><div><strong>Aprovação necessária</strong><p>{a.tool_name} · {a.reason||'Esta ação requer confirmação.'}</p></div><button disabled={resolvingApproval===a.id} onClick={()=>void resolveApproval(a,'denied')}>Negar</button><button className="primary" disabled={resolvingApproval===a.id} onClick={()=>void resolveApproval(a,'approved')}>Aprovar</button></div>)}
        {snapshot?.pending_commands.filter(c=>c.command_type!=='orient').map(c=><div className="dev-queue-card" key={c.id}><span>↳</span><div><strong>{c.command_type==='interrupt'?'Interromper e enviar':'Na fila'}</strong><p>{c.message}</p></div><button onClick={()=>void api.cancelWorkspaceCommandV3(c.id).then(refresh)}>×</button></div>)}
        {jumpVisible&&<button className="dev-jump-latest" onClick={()=>{const el=transcriptRef.current;if(el)el.scrollTop=el.scrollHeight;setJumpVisible(false)}}>↓ Ir para o mais recente</button>}
      </div>

      <form className="dev-composer" onSubmit={submit}>
        {isRunning&&<div className="dev-active-actions"><button type="button" className={activeAction==='orient'?'active':''} onClick={()=>setActiveAction('orient')}>Orientar execução</button><button type="button" className={activeAction==='enqueue'?'active':''} onClick={()=>setActiveAction('enqueue')}>Adicionar à fila</button><button type="button" className={activeAction==='interrupt'?'active danger':''} onClick={()=>setActiveAction('interrupt')}>Interromper e enviar</button></div>}
        <textarea value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit()}}} placeholder={isRunning?activeAction==='orient'?'Oriente o trabalho em andamento…':activeAction==='enqueue'?'Adicione a próxima instrução à fila…':'Interrompa e envie uma nova direção…':'Peça algo para o Agent Office…'} rows={3}/>
        <div className="dev-composer-footer"><div><span className="shared-context-dot"/><span>{isRunning?'Execução continua enquanto você digita':'Pronto para iniciar'}</span></div><div><select value={target} onChange={e=>setTarget(e.target.value)}><option value="auto">Auto</option><option value="team">Team</option>{agents.filter(a=>a.enabled&&a.provider_id&&a.model_id).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select><button className="dev-send" disabled={sending||!message.trim()}>{sending?'•••':'➤'}</button></div></div>
      </form>
      {error&&<div className="dev-chat-error">{error}</div>}
    </main>

    {workbenchOpen&&<Workbench project={project} snapshot={snapshot} runId={workbenchRunId} liveEvents={liveEvents}/>}
  </div>;
}
