import { useEffect, useMemo, useState } from 'react';
import type { AgentProfile, Team, TeamMember } from './types.js';
import { api } from './api.js';

interface Props { agents: AgentProfile[]; }

const slugify=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const empty=()=>({name:'',slug:'',purpose:'',lead_agent_id:'',enabled:true,max_parallelism:3,max_delegation_depth:2,allow_external_borrowing:false,approval_mode:'safe' as const,allowed_tools:''});

export function TeamsView({agents}:Props){
 const [teams,setTeams]=useState<Team[]>([]),[selectedId,setSelectedId]=useState<string|null>(null),[creating,setCreating]=useState(false);
 const [draft,setDraft]=useState(empty()),[members,setMembers]=useState<Array<{agent_id:string;role_name:string;priority:number;enabled:boolean}>>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const selected=creating?null:teams.find(x=>x.id===selectedId)??null;
 const agentMap=useMemo(()=>new Map(agents.map(a=>[a.id,a])),[agents]);
 const load=async()=>{const next=await api.listTeamsV3();setTeams(next.filter(x=>x.type==='permanent'||x.type==='system'));setSelectedId(current=>current&&next.some(x=>x.id===current)?current:next[0]?.id??null)};
 useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Falha ao carregar equipes.'))},[]);
 useEffect(()=>{if(!selected)return;setDraft({name:selected.name,slug:selected.slug,purpose:selected.purpose,lead_agent_id:selected.lead_agent_id??'',enabled:selected.enabled,max_parallelism:selected.max_parallelism,max_delegation_depth:selected.max_delegation_depth,allow_external_borrowing:selected.allow_external_borrowing,approval_mode:selected.policy?.approval_mode??'safe',allowed_tools:(selected.policy?.allowed_tools??[]).join(', ')});setMembers(selected.members.map(m=>({agent_id:m.agent_id,role_name:m.role_name,priority:m.priority,enabled:m.enabled})));setError(null);setNotice(null)},[selected?.id,selected?.current_version]);
 const startCreate=()=>{setCreating(true);setSelectedId(null);setDraft(empty());setMembers([]);setError(null);setNotice(null)};
 const toggleMember=(agentId:string,checked:boolean)=>setMembers(cur=>checked?[...cur,{agent_id:agentId,role_name:'',priority:0,enabled:true}]:cur.filter(x=>x.agent_id!==agentId));
 const save=async()=>{if(!draft.name.trim()||!draft.slug.trim()){setError('Nome e slug são obrigatórios.');return}if(draft.lead_agent_id&&!members.some(m=>m.agent_id===draft.lead_agent_id&&m.enabled)){setError('O Team Lead precisa ser um membro ativo da equipe.');return}setBusy(true);setError(null);setNotice(null);try{const payload:any={name:draft.name.trim(),slug:draft.slug.trim(),purpose:draft.purpose.trim(),lead_agent_id:draft.lead_agent_id||null,enabled:draft.enabled,max_parallelism:Math.max(1,draft.max_parallelism),max_delegation_depth:Math.max(0,draft.max_delegation_depth),allow_external_borrowing:draft.allow_external_borrowing,policy:{approval_mode:draft.approval_mode,allowed_tools:draft.allowed_tools.split(',').map(x=>x.trim()).filter(Boolean)}};const saved=selected?await api.updateTeamV3(selected.id,payload):await api.createTeamV3(payload);await api.replaceTeamMembersV3(saved.id,members);setCreating(false);setSelectedId(saved.id);await load();setNotice('Equipe salva com uma nova versão imutável.')}catch(e){setError(e instanceof Error?e.message:'Falha ao salvar equipe.')}finally{setBusy(false)}};
 const disable=async()=>{if(!selected||!window.confirm(`Desativar a equipe "${selected.name}"?`))return;setBusy(true);try{await api.disableTeamV3(selected.id);await load();setNotice('Equipe desativada.')}catch(e){setError(e instanceof Error?e.message:'Falha ao desativar equipe.')}finally{setBusy(false)}};
 return <div className="manager-page">
  <header className="manager-header"><div><span className="office-kicker">V3.6</span><h1>Teams</h1><p>Equipes permanentes reutilizam agentes existentes. Equipes dinâmicas continuam restritas à execução.</p></div><button type="button" className="manager-primary" onClick={startCreate}>+ Nova equipe</button></header>
  <div className="manager-layout">
   <aside className="manager-list-panel"><div className="manager-list-title"><span>Equipes permanentes</span><strong>{teams.length}</strong></div><div className="manager-list">{teams.map(t=><button key={t.id} type="button" className={`agent-manager-select ${selectedId===t.id?'active':''}`} onClick={()=>{setCreating(false);setSelectedId(t.id)}}><span className="agent-manager-avatar">T</span><span className="manager-list-copy"><strong>{t.name}</strong><small>{t.members.length} membros · v{t.current_version}</small></span><span className={`mini-status ${t.enabled?'online':'offline'}`}/></button>)}{!teams.length&&<div className="manager-empty-small">Nenhuma equipe permanente.</div>}</div></aside>
   <section className="manager-detail"><div className="manager-card agent-editor-card">
    <div className="manager-card-header"><div><span className="office-kicker">{selected?'Editar equipe':'Nova equipe'}</span><h2>{selected?.name??'Criar permanent team'}</h2></div>{selected&&<div className="agent-preview-chip"><span className="agent-manager-avatar">v{selected.current_version}</span><div><strong>Snapshot versionado</strong><small>Execuções antigas não mudam</small></div></div>}</div>
    <div className="manager-form-grid">
     <div className="manager-field"><label>Nome</label><input value={draft.name} onChange={e=>{const name=e.target.value;setDraft(x=>({...x,name,slug:selected?x.slug:slugify(name)}))}}/></div>
     <div className="manager-field"><label>Slug</label><input value={draft.slug} onChange={e=>setDraft(x=>({...x,slug:slugify(e.target.value)}))}/></div>
     <div className="manager-field span-2"><label>Propósito</label><input value={draft.purpose} onChange={e=>setDraft(x=>({...x,purpose:e.target.value}))} placeholder="Quando esta equipe deve ser usada?"/></div>
     <div className="manager-field"><label>Team Lead (opcional)</label><select value={draft.lead_agent_id} onChange={e=>setDraft(x=>({...x,lead_agent_id:e.target.value}))}><option value="">Sem lead</option>{members.filter(m=>m.enabled).map(m=><option key={m.agent_id} value={m.agent_id}>{agentMap.get(m.agent_id)?.name??m.agent_id}</option>)}</select></div>
     <div className="manager-field"><label>Approval policy</label><select value={draft.approval_mode} onChange={e=>setDraft(x=>({...x,approval_mode:e.target.value as any}))}><option value="safe">Safe</option><option value="manual">Manual</option><option value="auto">Auto dentro das permissões</option></select></div>
     <div className="manager-field"><label>Máx. paralelismo</label><input type="number" min={1} value={draft.max_parallelism} onChange={e=>setDraft(x=>({...x,max_parallelism:Number(e.target.value)||1}))}/></div>
     <div className="manager-field"><label>Profundidade de delegação</label><input type="number" min={0} value={draft.max_delegation_depth} onChange={e=>setDraft(x=>({...x,max_delegation_depth:Math.max(0,Number(e.target.value)||0)}))}/></div>
     <div className="manager-field span-2"><label>Tools permitidas pela equipe</label><input value={draft.allowed_tools} onChange={e=>setDraft(x=>({...x,allowed_tools:e.target.value}))} placeholder="read_file, npm_test (vazio = sem elevação; agent/tool policies continuam valendo)"/></div>
    </div>
    <label className="manager-switch-row"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft(x=>({...x,enabled:e.target.checked}))}/><span><strong>Equipe ativa</strong><small>Equipe desativada não pode ser selecionada para novas execuções.</small></span></label>
    <label className="manager-switch-row"><input type="checkbox" checked={draft.allow_external_borrowing} onChange={e=>setDraft(x=>({...x,allow_external_borrowing:e.target.checked}))}/><span><strong>Permitir borrowing externo</strong><small>Não cria membership; o agente externo ainda precisa passar por todas as policies.</small></span></label>
    <div className="agent-tool-card"><div className="binding-title"><div><strong>Membros</strong><span>Um agente pode participar de várias equipes.</span></div><span>{members.filter(x=>x.enabled).length} ativos</span></div>
     <div className="tool-chip-grid">{agents.map(a=>{const m=members.find(x=>x.agent_id===a.id);return <div key={a.id} className={`tool-chip ${m?'selected':''}`}><label><input type="checkbox" checked={Boolean(m)} onChange={e=>toggleMember(a.id,e.target.checked)}/>{a.name}</label>{m&&<><input value={m.role_name} placeholder="Função no team" onChange={e=>setMembers(cur=>cur.map(x=>x.agent_id===a.id?{...x,role_name:e.target.value}:x))}/><label><input type="checkbox" checked={m.enabled} onChange={e=>setMembers(cur=>cur.map(x=>x.agent_id===a.id?{...x,enabled:e.target.checked}:x))}/> ativo</label></>}</div>})}</div>
    </div>
    {error&&<div className="manager-alert error">{error}</div>}{notice&&<div className="manager-alert success">{notice}</div>}
    <div className="manager-actions">{selected&&<button type="button" className="manager-danger" onClick={disable} disabled={busy}>Desativar</button>}<div className="manager-action-spacer"/><button type="button" className="manager-primary" onClick={save} disabled={busy}>{busy?'Salvando...':'Salvar equipe'}</button></div>
   </div></section>
  </div>
 </div>;
}
