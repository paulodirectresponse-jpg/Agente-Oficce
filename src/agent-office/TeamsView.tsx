import { useEffect, useMemo, useState } from 'react';
import type { AgentOverview, AgentProfile, Team, TeamRoom, Workforce } from './types.js';
import { api } from './api.js';

interface Props { agents: AgentProfile[]; }
type MemberDraft={agent_id:string;role_name:string;priority:number;enabled:boolean};
type Draft={name:string;slug:string;purpose:string;owner_agent_id:string;enabled:boolean;max_parallelism:number;max_delegation_depth:number;allow_external_borrowing:boolean;approval_mode:'safe'|'manual'|'auto';allowed_tools:string;room_instructions:string;room_context:string;room_memory:string};

const slugify=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const empty=():Draft=>({name:'',slug:'',purpose:'',owner_agent_id:'',enabled:true,max_parallelism:3,max_delegation_depth:2,allow_external_borrowing:true,approval_mode:'auto',allowed_tools:'',room_instructions:'',room_context:'',room_memory:''});
const textOf=(value:Record<string,unknown>|undefined)=>typeof value?.text==='string'?value.text:value&&Object.keys(value).length?JSON.stringify(value,null,2):'';

export function TeamsView({agents}:Props){
 const [teams,setTeams]=useState<Team[]>([]),[workforces,setWorkforces]=useState<Workforce[]>([]),[overviews,setOverviews]=useState<Map<string,AgentOverview>>(new Map());
 const [selectedId,setSelectedId]=useState<string|null>(null),[creating,setCreating]=useState(false);
 const [draft,setDraft]=useState(empty()),[members,setMembers]=useState<MemberDraft[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const selected=creating?null:teams.find(x=>x.id===selectedId)??null;
 const agentMap=useMemo(()=>new Map(agents.map(a=>[a.id,a])),[agents]);
 const ownerIds=useMemo(()=>new Set(teams.map(t=>t.owner_agent_id).filter(Boolean) as string[]),[teams]);
 const permanentParent=useMemo(()=>{const map=new Map<string,string>();for(const t of teams)if(t.owner_agent_id)for(const m of t.members)map.set(m.agent_id,t.owner_agent_id);return map},[teams]);

 const load=async()=>{
  const [next,nextWorkforces,nextOverviews]=await Promise.all([api.listTeamsV3(),api.listWorkforcesV3(30),api.listAgentOverviewsV2()]);
  const permanent=next.filter(x=>x.type==='permanent'||x.type==='system');
  setTeams(permanent);setWorkforces(nextWorkforces);setOverviews(new Map(nextOverviews.map(x=>[x.agent_id,x])));
  setSelectedId(current=>current&&permanent.some(x=>x.id===current)?current:permanent[0]?.id??null);
 };
 useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Falha ao carregar equipes.'))},[]);

 useEffect(()=>{
  if(!selected)return;
  let cancelled=false;
  void api.getTeamRoomV3(selected.id).then(room=>{if(cancelled)return;setDraft({
   name:selected.name,slug:selected.slug,purpose:selected.purpose,owner_agent_id:selected.owner_agent_id??'',enabled:selected.enabled,
   max_parallelism:selected.max_parallelism,max_delegation_depth:selected.max_delegation_depth,allow_external_borrowing:selected.allow_external_borrowing,
   approval_mode:selected.policy?.approval_mode??'auto',allowed_tools:(selected.policy?.allowed_tools??[]).join(', '),
   room_instructions:room.instructions,room_context:textOf(room.shared_context),room_memory:textOf(room.memory),
  });setMembers(selected.members.map(m=>({agent_id:m.agent_id,role_name:m.role_name,priority:m.priority,enabled:m.enabled})));setError(null);setNotice(null)}).catch(e=>setError(e instanceof Error?e.message:'Falha ao carregar Team Room.'));
  return()=>{cancelled=true};
 },[selected?.id,selected?.current_version]);

 const startCreate=()=>{setCreating(true);setSelectedId(null);setDraft(empty());setMembers([]);setError(null);setNotice(null)};
 const toggleMember=(agentId:string)=>{
  setMembers(cur=>cur.some(x=>x.agent_id===agentId)?cur.filter(x=>x.agent_id!==agentId):[...cur,{agent_id:agentId,role_name:agentMap.get(agentId)?.role??'',priority:cur.length,enabled:true}]);
 };
 const save=async()=>{
  if(!draft.owner_agent_id){setError('Escolha o agente principal desta equipe.');return}
  if(!draft.name.trim()){setError('Dê um nome à equipe.');return}
  setBusy(true);setError(null);setNotice(null);
  try{
   const payload:any={name:draft.name.trim(),slug:draft.slug.trim()||slugify(draft.name),purpose:draft.purpose.trim(),owner_agent_id:draft.owner_agent_id,enabled:draft.enabled,max_parallelism:Math.max(1,draft.max_parallelism),max_delegation_depth:Math.max(0,draft.max_delegation_depth),allow_external_borrowing:draft.allow_external_borrowing,policy:{approval_mode:draft.approval_mode,allowed_tools:draft.allowed_tools.split(',').map(x=>x.trim()).filter(Boolean)}};
   const team=selected?await api.updateTeamV3(selected.id,payload):await api.createTeamV3(payload);
   const filtered=members.filter(m=>m.agent_id!==draft.owner_agent_id);
   await api.replaceTeamMembersV3(team.id,filtered);
   await api.updateTeamRoomV3(team.id,{instructions:draft.room_instructions,shared_context:{text:draft.room_context},memory:{text:draft.room_memory}});
   setCreating(false);setSelectedId(team.id);await load();setNotice('Equipe salva. Owner, subagentes e Team Room estão sincronizados.');
  }catch(e){setError(e instanceof Error?e.message:'Falha ao salvar equipe.')}finally{setBusy(false)}
 };
 const disable=async()=>{if(!selected||!window.confirm(`Desativar a equipe "${selected.name}"?`))return;setBusy(true);try{await api.disableTeamV3(selected.id);await load();setNotice('Equipe desativada.')}catch(e){setError(e instanceof Error?e.message:'Falha ao desativar equipe.')}finally{setBusy(false)}};

 const owner=selected?.owner_agent_id?agentMap.get(selected.owner_agent_id):draft.owner_agent_id?agentMap.get(draft.owner_agent_id):null;
 const availableMembers=agents.filter(a=>a.id!==draft.owner_agent_id);
 const legacy=Boolean(selected&&!selected.owner_agent_id);

 return <div className="manager-page team-hub-page">
  <header className="manager-header">
   <div><span className="office-kicker">Organização permanente</span><h1>Equipes</h1><p>Cada equipe pertence a um agente principal. Workforces temporárias ficam separadas e não alteram essa estrutura.</p></div>
   <button type="button" className="manager-primary" onClick={startCreate}>+ Criar equipe de um agente</button>
  </header>

  <div className="team-hub-summary">
   <div><strong>{teams.filter(t=>t.owner_agent_id).length}</strong><span>equipes de agentes</span></div>
   <div><strong>{teams.reduce((n,t)=>n+t.members.length,0)}</strong><span>subagentes vinculados</span></div>
   <div><strong>{workforces.filter(w=>w.status==='active').length}</strong><span>workforces ativas</span></div>
   <div><strong>{teams.filter(t=>!t.owner_agent_id).length}</strong><span>teams legadas</span></div>
  </div>

  <div className="manager-layout">
   <aside className="manager-list-panel">
    <div className="manager-list-title"><span>Agent Teams</span><strong>{teams.length}</strong></div>
    <div className="manager-list">
     {teams.map(t=>{const a=t.owner_agent_id?agentMap.get(t.owner_agent_id):null;return <button key={t.id} type="button" className={`agent-manager-select ${selectedId===t.id?'active':''}`} onClick={()=>{setCreating(false);setSelectedId(t.id)}}>
      <span className="agent-manager-avatar">{a?.name?.slice(0,1).toUpperCase()??'T'}</span>
      <span className="manager-list-copy"><strong>{t.name}</strong><small>{a?`${a.name} · ${t.members.length} subagentes`:`Legada · ${t.members.length} membros`}</small></span>
      <span className={`mini-status ${t.enabled?'online':'offline'}`}/>
     </button>})}
     {!teams.length&&<div className="manager-empty-small">Nenhuma equipe criada.</div>}
    </div>

    <div className="manager-list-title workforce-list-title"><span>Workforces recentes</span><strong>{workforces.length}</strong></div>
    <div className="workforce-mini-list">
     {workforces.slice(0,10).map(w=><div key={w.id}><span className={`mini-status ${w.status==='active'?'online':'unknown'}`}/><div><strong>{w.purpose||'Workforce temporária'}</strong><small>{w.members.length} agentes · {w.status}</small></div></div>)}
     {!workforces.length&&<div className="manager-empty-small">Nenhuma workforce criada ainda.</div>}
    </div>
   </aside>

   <section className="manager-detail">
    <div className="manager-card team-org-card">
     <div className="manager-card-header">
      <div><span className="office-kicker">{selected?'Agent Team':'Nova Agent Team'}</span><h2>{(selected?.name ?? draft.name) || 'Equipe de um agente'}</h2></div>
      {selected&&<span className="team-version-badge">v{selected.current_version}</span>}
     </div>

     {legacy&&<div className="manager-alert warning">Esta é uma Team V3.6 legada. Escolha um owner para migrá-la ao novo modelo sem apagar histórico nem snapshots.</div>}

     <div className="team-owner-tree">
      <div className="team-owner-node">
       <span className="agent-manager-avatar">{owner?.name?.slice(0,1).toUpperCase()??'?'}</span>
       <div><small>MAIN AGENT · OWNER</small><strong>{owner?.name??'Escolha o agente principal'}</strong><span>{owner?.role||'A equipe nasce a partir deste agente'}</span></div>
       {draft.owner_agent_id&&<span className={`agent-readiness-chip readiness-${overviews.get(draft.owner_agent_id)?.readiness??'incomplete'}`}>{overviews.get(draft.owner_agent_id)?.readiness??'incomplete'}</span>}
      </div>
      <div className="team-tree-line"/>
      <div className="team-subagent-row">
       {members.map(m=>{const a=agentMap.get(m.agent_id),o=overviews.get(m.agent_id);return <div key={m.agent_id} className="team-subagent-node"><span className="agent-manager-avatar">{a?.name?.slice(0,1).toUpperCase()??'?'}</span><strong>{a?.name??m.agent_id}</strong><small>{m.role_name||a?.role||'Subagente'}</small><span>{o?.readiness??'unknown'}</span></div>})}
       {!members.length&&<div className="team-empty-node">Nenhum subagente ainda</div>}
      </div>
     </div>

     <div className="manager-form-grid team-basic-settings">
      <div className="manager-field"><label>Agente principal</label><select value={draft.owner_agent_id} disabled={Boolean(selected?.owner_agent_id)} onChange={e=>{const id=e.target.value,a=agentMap.get(id);setDraft(x=>({...x,owner_agent_id:id,name:x.name||`${a?.name??'Agent'} Team`,slug:x.slug||slugify(`${a?.name??'agent'}-team`)}));setMembers(cur=>cur.filter(m=>m.agent_id!==id))}}><option value="">Selecione</option>{agents.map(a=><option key={a.id} value={a.id} disabled={ownerIds.has(a.id)&&a.id!==draft.owner_agent_id}>{a.name}{ownerIds.has(a.id)&&a.id!==draft.owner_agent_id?' · já possui equipe':''}</option>)}</select></div>
      <div className="manager-field"><label>Nome</label><input value={draft.name} onChange={e=>setDraft(x=>({...x,name:e.target.value,slug:selected?x.slug:slugify(e.target.value)}))}/></div>
      <div className="manager-field span-2"><label>Propósito</label><input value={draft.purpose} onChange={e=>setDraft(x=>({...x,purpose:e.target.value}))} placeholder="Como esta equipe ajuda o agente principal?"/></div>
     </div>

     <div className="agent-tool-card team-subagent-picker">
      <div className="binding-title"><div><strong>Subagentes</strong><span>Os membros abaixo passam a responder estruturalmente ao owner. Um subagente não é duplicado.</span></div><span>{members.length}</span></div>
      <div className="tool-chip-grid">{availableMembers.map(a=>{const m=members.find(x=>x.agent_id===a.id),o=overviews.get(a.id),parent=permanentParent.get(a.id),blocked=Boolean(parent&&parent!==draft.owner_agent_id);return <div key={a.id} className={`tool-chip ${m?'selected':''} ${blocked?'locked':''}`}><button type="button" disabled={blocked} onClick={()=>toggleMember(a.id)}>{m?'✓':blocked?'↳':'+'} {a.name}</button><small>{blocked?`Já é subagente de ${agentMap.get(parent!)?.name??parent}`:`${a.role||'Agent'} · ${o?.readiness??'unknown'}`}</small>{m&&<input value={m.role_name} placeholder="Função na equipe" onChange={e=>setMembers(cur=>cur.map(x=>x.agent_id===a.id?{...x,role_name:e.target.value}:x))}/>}</div>})}</div>
     </div>

     <div className="team-room-card">
      <div className="binding-title"><div><strong>Team Room</strong><span>Contexto permanente compartilhado entre o owner e seus subagentes.</span></div><span>Persistente</span></div>
      <div className="manager-field"><label>Instruções da equipe</label><textarea rows={4} value={draft.room_instructions} onChange={e=>setDraft(x=>({...x,room_instructions:e.target.value}))} placeholder="Como esta equipe deve trabalhar em conjunto?"/></div>
      <div className="manager-form-grid">
       <div className="manager-field"><label>Contexto compartilhado</label><textarea rows={4} value={draft.room_context} onChange={e=>setDraft(x=>({...x,room_context:e.target.value}))} placeholder="Decisões, padrões, stack, convenções..."/></div>
       <div className="manager-field"><label>Memória da equipe</label><textarea rows={4} value={draft.room_memory} onChange={e=>setDraft(x=>({...x,room_memory:e.target.value}))} placeholder="Conhecimento que deve permanecer disponível para a equipe."/></div>
      </div>
     </div>

     <details className="agent-ops-details">
      <summary>Configurações avançadas</summary>
      <div className="manager-form-grid">
       <div className="manager-field"><label>Máx. paralelismo</label><input type="number" min={1} value={draft.max_parallelism} onChange={e=>setDraft(x=>({...x,max_parallelism:Number(e.target.value)||1}))}/></div>
       <div className="manager-field"><label>Profundidade de delegação</label><input type="number" min={0} value={draft.max_delegation_depth} onChange={e=>setDraft(x=>({...x,max_delegation_depth:Math.max(0,Number(e.target.value)||0)}))}/></div>
       <div className="manager-field"><label>Approval</label><select value={draft.approval_mode} onChange={e=>setDraft(x=>({...x,approval_mode:e.target.value as Draft['approval_mode']}))}><option value="auto">Auto</option><option value="safe">Safe</option><option value="manual">Manual</option></select></div>
       <div className="manager-field"><label>Tools da equipe</label><input value={draft.allowed_tools} onChange={e=>setDraft(x=>({...x,allowed_tools:e.target.value}))} placeholder="vazio = policies dos agentes continuam valendo"/></div>
      </div>
      <label className="manager-switch-row"><input type="checkbox" checked={draft.allow_external_borrowing} onChange={e=>setDraft(x=>({...x,allow_external_borrowing:e.target.checked}))}/><span><strong>Permitir borrowing via Workforce</strong><small>Agentes externos podem participar de um trabalho sem virar membros permanentes.</small></span></label>
      <label className="manager-switch-row"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft(x=>({...x,enabled:e.target.checked}))}/><span><strong>Equipe ativa</strong><small>Desativada não entra em novas execuções.</small></span></label>
     </details>

     {error&&<div className="manager-alert error">{error}</div>}{notice&&<div className="manager-alert success">{notice}</div>}
     <div className="manager-actions">{selected&&<button type="button" className="manager-danger" onClick={disable} disabled={busy}>Desativar</button>}<div className="manager-action-spacer"/><button type="button" className="manager-primary" onClick={save} disabled={busy}>{busy?'Salvando...':'Salvar Agent Team'}</button></div>
    </div>

    {selected&&<div className="manager-card team-room-activity-card"><div className="manager-card-header compact"><div><span className="office-kicker">Team Room</span><h2>Atividade e memória</h2></div></div><TeamRoomActivity teamId={selected.id}/></div>}
   </section>
  </div>
 </div>;
}

function TeamRoomActivity({teamId}:{teamId:string}){
 const [room,setRoom]=useState<TeamRoom|null>(null);
 useEffect(()=>{void api.getTeamRoomV3(teamId).then(setRoom).catch(()=>setRoom(null))},[teamId]);
 if(!room)return <span className="manager-empty-small">Sem atividade registrada.</span>;
 return <div className="team-room-entry-list">{room.entries.slice(0,15).map(entry=><div key={entry.id}><span>{entry.entry_type}</span><div><strong>{entry.content||'Evento da equipe'}</strong><small>{new Date(entry.created_at).toLocaleString('pt-BR')}</small></div></div>)}{!room.entries.length&&<span className="manager-empty-small">O Team Room ainda não possui eventos.</span>}</div>;
}
