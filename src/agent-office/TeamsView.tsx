import { useEffect, useMemo, useState } from 'react';
import type { AgentOverview, AgentProfile, ProviderModel, Subagent, Team, TeamRoom, UniversalProvider, Workforce } from './types.js';
import { api } from './api.js';

interface Props { agents: AgentProfile[]; }
type TeamDraft={
  name:string;slug:string;purpose:string;owner_agent_id:string;enabled:boolean;
  max_parallelism:number;max_delegation_depth:number;allow_external_borrowing:boolean;
  approval_mode:'safe'|'manual'|'auto';allowed_tools:string;
  room_instructions:string;room_context:string;room_memory:string;
};
type SubDraft={
  name:string;slug:string;role:string;description:string;provider_id:string;model_id:string;
  system_prompt:string;enabled:boolean;paused:boolean;
};
const slugify=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const emptyTeam=():TeamDraft=>({name:'',slug:'',purpose:'',owner_agent_id:'',enabled:true,max_parallelism:3,max_delegation_depth:2,allow_external_borrowing:true,approval_mode:'auto',allowed_tools:'',room_instructions:'',room_context:'',room_memory:''});
const emptySub=():SubDraft=>({name:'',slug:'',role:'',description:'',provider_id:'',model_id:'',system_prompt:'',enabled:true,paused:false});
const textOf=(value:Record<string,unknown>|undefined)=>typeof value?.text==='string'?value.text:value&&Object.keys(value).length?JSON.stringify(value,null,2):'';

export function TeamsView({agents}:Props){
  const [teams,setTeams]=useState<Team[]>([]);
  const [workforces,setWorkforces]=useState<Workforce[]>([]);
  const [overviews,setOverviews]=useState<Map<string,AgentOverview>>(new Map());
  const [providers,setProviders]=useState<UniversalProvider[]>([]);
  const [models,setModels]=useState<ProviderModel[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [creating,setCreating]=useState(false);
  const [draft,setDraft]=useState<TeamDraft>(emptyTeam());
  const [subDraft,setSubDraft]=useState<SubDraft>(emptySub());
  const [editingSubId,setEditingSubId]=useState<string|null>(null);
  const [showSubEditor,setShowSubEditor]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);

  const selected=creating?null:teams.find(x=>x.id===selectedId)??null;
  const agentMap=useMemo(()=>new Map(agents.map(a=>[a.id,a])),[agents]);
  const ownerIds=useMemo(()=>new Set(teams.map(t=>t.owner_agent_id).filter(Boolean) as string[]),[teams]);
  const owner=selected?.owner_agent_id?agentMap.get(selected.owner_agent_id):draft.owner_agent_id?agentMap.get(draft.owner_agent_id):null;
  const subagents=selected?.subagents??[];

  const load=async()=>{
    const [nextTeams,nextWorkforces,nextOverviews,nextProviders]=await Promise.all([
      api.listTeamsV3(),api.listWorkforcesV3(30),api.listAgentOverviewsV2(),api.listProvidersV2(),
    ]);
    const permanent=nextTeams.filter(x=>x.type==='permanent'||x.type==='system');
    setTeams(permanent);setWorkforces(nextWorkforces);setOverviews(new Map(nextOverviews.map(x=>[x.agent_id,x])));setProviders(nextProviders.filter(p=>p.enabled));
    setSelectedId(current=>current&&permanent.some(x=>x.id===current)?current:permanent[0]?.id??null);
  };
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Falha ao carregar equipes.'))},[]);

  useEffect(()=>{
    if(!selected)return;
    let cancelled=false;
    void api.getTeamRoomV3(selected.id).then(room=>{
      if(cancelled)return;
      setDraft({
        name:selected.name,slug:selected.slug,purpose:selected.purpose,owner_agent_id:selected.owner_agent_id??'',enabled:selected.enabled,
        max_parallelism:selected.max_parallelism,max_delegation_depth:selected.max_delegation_depth,allow_external_borrowing:selected.allow_external_borrowing,
        approval_mode:selected.policy?.approval_mode??'auto',allowed_tools:(selected.policy?.allowed_tools??[]).join(', '),
        room_instructions:room.instructions,room_context:textOf(room.shared_context),room_memory:textOf(room.memory),
      });
      setShowSubEditor(false);setEditingSubId(null);setSubDraft(emptySub());setError(null);setNotice(null);
    }).catch(e=>setError(e instanceof Error?e.message:'Falha ao carregar Team Room.'));
    return()=>{cancelled=true};
  },[selected?.id,selected?.current_version]);

  useEffect(()=>{
    if(!subDraft.provider_id){setModels([]);return}
    void api.listProviderModelsV2(subDraft.provider_id).then(setModels).catch(()=>setModels([]));
  },[subDraft.provider_id]);

  const startCreate=()=>{setCreating(true);setSelectedId(null);setDraft(emptyTeam());setShowSubEditor(false);setError(null);setNotice(null)};

  const saveTeam=async()=>{
    if(!draft.owner_agent_id){setError('Escolha o Agent principal da equipe.');return}
    if(!draft.name.trim()){setError('Dê um nome à equipe.');return}
    setBusy(true);setError(null);setNotice(null);
    try{
      const payload:any={
        name:draft.name.trim(),slug:draft.slug.trim()||slugify(draft.name),purpose:draft.purpose.trim(),owner_agent_id:draft.owner_agent_id,
        enabled:draft.enabled,max_parallelism:Math.max(1,draft.max_parallelism),max_delegation_depth:Math.max(0,draft.max_delegation_depth),
        allow_external_borrowing:draft.allow_external_borrowing,
        policy:{approval_mode:draft.approval_mode,allowed_tools:draft.allowed_tools.split(',').map(x=>x.trim()).filter(Boolean)},
      };
      const team=selected?await api.updateTeamV3(selected.id,payload):await api.createTeamV3(payload);
      await api.updateTeamRoomV3(team.id,{instructions:draft.room_instructions,shared_context:{text:draft.room_context},memory:{text:draft.room_memory}});
      setCreating(false);setSelectedId(team.id);await load();setNotice('Equipe salva. Agora crie os Subagents desta equipe.');
      if(!selected)setShowSubEditor(true);
    }catch(e){setError(e instanceof Error?e.message:'Falha ao salvar equipe.')}finally{setBusy(false)}
  };

  const beginSub=(sub?:Subagent)=>{
    setEditingSubId(sub?.id??null);
    setSubDraft(sub?{
      name:sub.name,slug:sub.slug,role:sub.role,description:sub.description,provider_id:sub.provider_id??'',model_id:sub.model_id??'',
      system_prompt:sub.system_prompt,enabled:sub.enabled,paused:sub.paused,
    }:emptySub());
    setShowSubEditor(true);setError(null);setNotice(null);
  };

  const saveSubagent=async()=>{
    if(!selected){setError('Salve a equipe antes de criar Subagents.');return}
    if(!subDraft.name.trim()){setError('Informe o nome do Subagent.');return}
    setBusy(true);setError(null);setNotice(null);
    try{
      const payload:any={...subDraft,name:subDraft.name.trim(),slug:subDraft.slug.trim()||slugify(subDraft.name),provider_id:subDraft.provider_id||null,model_id:subDraft.model_id||null};
      if(editingSubId)await api.updateTeamSubagentV3(selected.id,editingSubId,payload);
      else await api.createTeamSubagentV3(selected.id,payload);
      await load();setShowSubEditor(false);setEditingSubId(null);setSubDraft(emptySub());setNotice(editingSubId?'Subagent atualizado.':'Subagent criado e adicionado à equipe.');
    }catch(e){setError(e instanceof Error?e.message:'Falha ao salvar Subagent.')}finally{setBusy(false)}
  };

  const removeSubagent=async(sub:Subagent)=>{
    if(!selected||!window.confirm(`Excluir o Subagent "${sub.name}" desta equipe?`))return;
    setBusy(true);try{await api.deleteTeamSubagentV3(selected.id,sub.id);await load();setNotice('Subagent removido.')}catch(e){setError(e instanceof Error?e.message:'Falha ao remover Subagent.')}finally{setBusy(false)}
  };
  const disable=async()=>{if(!selected||!window.confirm(`Desativar a equipe "${selected.name}"?`))return;setBusy(true);try{await api.disableTeamV3(selected.id);await load();setNotice('Equipe desativada.')}catch(e){setError(e instanceof Error?e.message:'Falha ao desativar equipe.')}finally{setBusy(false)}};

  return <div className="manager-page team-hub-page">
    <header className="manager-header">
      <div><span className="office-kicker">Organização permanente</span><h1>Equipes</h1><p>Uma Team pertence a um Agent. Seus membros são Subagents próprios — nunca outros Agents do Office.</p></div>
      <button type="button" className="manager-primary" onClick={startCreate}>+ Criar equipe de um Agent</button>
    </header>

    <div className="team-hub-summary">
      <div><strong>{teams.filter(t=>t.owner_agent_id).length}</strong><span>Agent Teams</span></div>
      <div><strong>{teams.reduce((n,t)=>n+(t.subagents?.length??0),0)}</strong><span>Subagents reais</span></div>
      <div><strong>{workforces.filter(w=>w.status==='active').length}</strong><span>Workforces ativas</span></div>
      <div><strong>{teams.filter(t=>!t.owner_agent_id).length}</strong><span>Teams legadas</span></div>
    </div>

    <div className="manager-layout">
      <aside className="manager-list-panel">
        <div className="manager-list-title"><span>Agent Teams</span><strong>{teams.length}</strong></div>
        <div className="manager-list">
          {teams.map(t=>{const a=t.owner_agent_id?agentMap.get(t.owner_agent_id):null;return <button key={t.id} type="button" className={`agent-manager-select ${selectedId===t.id?'active':''}`} onClick={()=>{setCreating(false);setSelectedId(t.id)}}>
            <span className="agent-manager-avatar">{a?.name?.slice(0,1).toUpperCase()??'T'}</span>
            <span className="manager-list-copy"><strong>{t.name}</strong><small>{a?`${a.name} · ${t.subagents?.length??0} Subagents`:`Legada · ${t.members.length} Agents`}</small></span>
            <span className={`mini-status ${t.enabled?'online':'offline'}`}/>
          </button>})}
          {!teams.length&&<div className="manager-empty-small">Nenhuma equipe criada.</div>}
        </div>
        <div className="manager-list-title workforce-list-title"><span>Workforces recentes</span><strong>{workforces.length}</strong></div>
        <div className="workforce-mini-list">
          {workforces.slice(0,10).map(w=><div key={w.id}><span className={`mini-status ${w.status==='active'?'online':'unknown'}`}/><div><strong>{w.purpose||'Workforce temporária'}</strong><small>{w.members.length+(w.subagents?.length??0)} workers · {w.status}</small></div></div>)}
          {!workforces.length&&<div className="manager-empty-small">Nenhuma Workforce criada ainda.</div>}
        </div>
      </aside>

      <section className="manager-detail">
        <div className="manager-card team-org-card">
          <div className="manager-card-header"><div><span className="office-kicker">{selected?'Agent Team':'Nova Agent Team'}</span><h2>{(selected?.name??draft.name)||'Equipe de um Agent'}</h2></div>{selected&&<span className="team-version-badge">v{selected.current_version}</span>}</div>

          {selected&&!selected.owner_agent_id&&<div className="manager-alert warning">Team legada V3.6. Seus Agents antigos permanecem preservados apenas para compatibilidade histórica; novas equipes usam Subagents reais.</div>}

          <div className="team-owner-tree">
            <div className="team-owner-node">
              <span className="agent-manager-avatar">{owner?.name?.slice(0,1).toUpperCase()??'?'}</span>
              <div><small>AGENT PRINCIPAL · OWNER</small><strong>{owner?.name??'Escolha o Agent principal'}</strong><span>{owner?.role||'O único Agent estrutural da Team'}</span></div>
              {draft.owner_agent_id&&<span className={`agent-readiness-chip readiness-${overviews.get(draft.owner_agent_id)?.readiness??'incomplete'}`}>{overviews.get(draft.owner_agent_id)?.readiness??'incomplete'}</span>}
            </div>
            <div className="team-tree-line"/>
            <div className="team-subagent-row">
              {subagents.map(sub=><button key={sub.id} type="button" className="team-subagent-node real-subagent-node" onClick={()=>beginSub(sub)}>
                <span className="agent-manager-avatar">{sub.name.slice(0,1).toUpperCase()}</span><strong>{sub.name}</strong><small>{sub.role||'Subagent'}</small><span>{sub.readiness}</span>
              </button>)}
              {!subagents.length&&<div className="team-empty-node">Nenhum Subagent criado ainda</div>}
            </div>
          </div>

          <div className="manager-form-grid team-basic-settings">
            <div className="manager-field"><label>Agent principal</label><select value={draft.owner_agent_id} disabled={Boolean(selected?.owner_agent_id)} onChange={e=>{const aid=e.target.value,a=agentMap.get(aid);setDraft(x=>({...x,owner_agent_id:aid,name:x.name||`${a?.name??'Agent'} Team`,slug:x.slug||slugify(`${a?.name??'agent'}-team`)}))}}><option value="">Selecione</option>{agents.map(a=><option key={a.id} value={a.id} disabled={ownerIds.has(a.id)&&a.id!==draft.owner_agent_id}>{a.name}{ownerIds.has(a.id)&&a.id!==draft.owner_agent_id?' · já possui equipe':''}</option>)}</select></div>
            <div className="manager-field"><label>Nome da Team</label><input value={draft.name} onChange={e=>setDraft(x=>({...x,name:e.target.value,slug:selected?x.slug:slugify(e.target.value)}))}/></div>
            <div className="manager-field span-2"><label>Propósito</label><input value={draft.purpose} onChange={e=>setDraft(x=>({...x,purpose:e.target.value}))} placeholder="Como esta Team ajuda o Agent principal?"/></div>
          </div>

          <div className="subagent-management-card">
            <div className="binding-title">
              <div><strong>Subagents da Team</strong><span>Subagent é uma unidade própria criada aqui. Nenhum outro Agent do Office pode ser adicionado como membro.</span></div>
              {selected&&<button type="button" className="manager-primary" onClick={()=>beginSub()}>+ Criar Subagent</button>}
            </div>
            {!selected&&<div className="manager-empty-small">Salve a Team primeiro. Depois você poderá criar os Subagents um por vez.</div>}
            {selected&&subagents.length>0&&<div className="subagent-manage-list">{subagents.map(sub=><div key={sub.id}>
              <span className="agent-manager-avatar">{sub.name.slice(0,1).toUpperCase()}</span>
              <div><strong>{sub.name}</strong><small>{sub.role||'Subagent'} · {sub.readiness}{sub.provider_id?' · cérebro configurado':' · sem provider'}</small></div>
              <button type="button" onClick={()=>beginSub(sub)}>Editar</button><button type="button" className="danger-ghost" onClick={()=>void removeSubagent(sub)}>Excluir</button>
            </div>)}</div>}
          </div>

          {showSubEditor&&selected&&<div className="subagent-editor-card">
            <div className="binding-title"><div><strong>{editingSubId?'Editar Subagent':'Novo Subagent'}</strong><span>Este worker existe somente dentro da Team de {owner?.name??'seu Agent'}.</span></div><button type="button" onClick={()=>{setShowSubEditor(false);setEditingSubId(null)}}>Fechar</button></div>
            <div className="manager-form-grid">
              <div className="manager-field"><label>Nome</label><input value={subDraft.name} onChange={e=>setSubDraft(x=>({...x,name:e.target.value,slug:editingSubId?x.slug:slugify(e.target.value)}))}/></div>
              <div className="manager-field"><label>Função</label><input value={subDraft.role} onChange={e=>setSubDraft(x=>({...x,role:e.target.value}))} placeholder="Ex.: Backend Specialist"/></div>
              <div className="manager-field span-2"><label>Descrição</label><input value={subDraft.description} onChange={e=>setSubDraft(x=>({...x,description:e.target.value}))} placeholder="O que este Subagent faz dentro da Team?"/></div>
              <div className="manager-field"><label>Provider</label><select value={subDraft.provider_id} onChange={e=>setSubDraft(x=>({...x,provider_id:e.target.value,model_id:''}))}><option value="">Sem provider</option>{providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div className="manager-field"><label>Modelo</label><select value={subDraft.model_id} disabled={!subDraft.provider_id} onChange={e=>setSubDraft(x=>({...x,model_id:e.target.value}))}><option value="">Sem modelo</option>{models.filter(m=>m.enabled).map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></div>
              <div className="manager-field span-2"><label>System Prompt</label><textarea rows={7} value={subDraft.system_prompt} onChange={e=>setSubDraft(x=>({...x,system_prompt:e.target.value}))} placeholder="Especialidade, comportamento, critérios e responsabilidades deste Subagent."/></div>
            </div>
            <div className="subagent-editor-flags"><label><input type="checkbox" checked={subDraft.enabled} onChange={e=>setSubDraft(x=>({...x,enabled:e.target.checked}))}/> Ativo</label><label><input type="checkbox" checked={subDraft.paused} onChange={e=>setSubDraft(x=>({...x,paused:e.target.checked}))}/> Pausado</label></div>
            <p className="tool-safety-note">Capabilities são inferidas automaticamente do nome, função, descrição e System Prompt. Ferramentas seguem a autorização do Agent owner, mantendo o Subagent como identidade separada.</p>
            <div className="manager-actions"><div className="manager-action-spacer"/><button type="button" className="manager-primary" onClick={()=>void saveSubagent()} disabled={busy}>{busy?'Salvando…':editingSubId?'Salvar Subagent':'Criar Subagent'}</button></div>
          </div>}

          <div className="team-room-card">
            <div className="binding-title"><div><strong>Team Room</strong><span>Contexto permanente compartilhado pelo Agent e pelos Subagents desta Team.</span></div><span>Persistente</span></div>
            <div className="manager-field"><label>Instruções da equipe</label><textarea rows={4} value={draft.room_instructions} onChange={e=>setDraft(x=>({...x,room_instructions:e.target.value}))}/></div>
            <div className="manager-form-grid"><div className="manager-field"><label>Contexto compartilhado</label><textarea rows={4} value={draft.room_context} onChange={e=>setDraft(x=>({...x,room_context:e.target.value}))}/></div><div className="manager-field"><label>Memória da equipe</label><textarea rows={4} value={draft.room_memory} onChange={e=>setDraft(x=>({...x,room_memory:e.target.value}))}/></div></div>
          </div>

          <details className="agent-ops-details"><summary>Configurações avançadas</summary><div className="manager-form-grid">
            <div className="manager-field"><label>Máx. paralelismo</label><input type="number" min={1} value={draft.max_parallelism} onChange={e=>setDraft(x=>({...x,max_parallelism:Number(e.target.value)||1}))}/></div>
            <div className="manager-field"><label>Profundidade de delegação</label><input type="number" min={0} value={draft.max_delegation_depth} onChange={e=>setDraft(x=>({...x,max_delegation_depth:Math.max(0,Number(e.target.value)||0)}))}/></div>
            <div className="manager-field"><label>Approval</label><select value={draft.approval_mode} onChange={e=>setDraft(x=>({...x,approval_mode:e.target.value as TeamDraft['approval_mode']}))}><option value="auto">Auto</option><option value="safe">Safe</option><option value="manual">Manual</option></select></div>
            <div className="manager-field"><label>Tools adicionais/restrição</label><input value={draft.allowed_tools} onChange={e=>setDraft(x=>({...x,allowed_tools:e.target.value}))} placeholder="vazio = Full Access do owner"/></div>
          </div><label className="manager-switch-row"><input type="checkbox" checked={draft.allow_external_borrowing} onChange={e=>setDraft(x=>({...x,allow_external_borrowing:e.target.checked}))}/><span><strong>Permitir borrowing via Workforce</strong><small>Agents externos podem participar temporariamente sem virar membros da Team.</small></span></label></details>

          {error&&<div className="manager-alert error">{error}</div>}{notice&&<div className="manager-alert success">{notice}</div>}
          <div className="manager-actions">{selected&&<button type="button" className="manager-danger" onClick={()=>void disable()} disabled={busy}>Desativar</button>}<div className="manager-action-spacer"/><button type="button" className="manager-primary" onClick={()=>void saveTeam()} disabled={busy}>{busy?'Salvando…':'Salvar Team'}</button></div>
        </div>

        {selected&&<div className="manager-card"><div className="manager-card-header compact"><div><span className="office-kicker">Team Room</span><h2>Atividade e memória</h2></div></div><TeamRoomActivity teamId={selected.id}/></div>}
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
