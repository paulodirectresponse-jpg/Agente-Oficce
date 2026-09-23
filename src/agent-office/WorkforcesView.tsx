import { useEffect, useMemo, useState } from 'react';
import type { AgentProfile, Subagent, Team, Workforce } from './types.js';
import { api } from './api.js';

export function WorkforcesView(){
  const [workforces,setWorkforces]=useState<Workforce[]>([]);
  const [agents,setAgents]=useState<AgentProfile[]>([]);
  const [teams,setTeams]=useState<Team[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);

  const load=async()=>{
    const [w,a,t]=await Promise.all([api.listWorkforcesV3(100),api.listAgentsV2(),api.listTeamsV3()]);
    setWorkforces(w);setAgents(a);setTeams(t);
    setSelectedId(cur=>cur&&w.some(x=>x.id===cur)?cur:w[0]?.id??null);
  };
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Falha ao carregar Workforces.'));const timer=window.setInterval(()=>void load().catch(()=>undefined),5000);return()=>window.clearInterval(timer)},[]);
  const selected=workforces.find(x=>x.id===selectedId)??null;
  const agentMap=useMemo(()=>new Map(agents.map(a=>[a.id,a])),[agents]);
  const teamMap=useMemo(()=>new Map(teams.map(t=>[t.id,t])),[teams]);
  const subagentMap=useMemo(()=>{const map=new Map<string,Subagent>();for(const t of teams)for(const s of t.subagents??[])map.set(s.id,s);return map},[teams]);

  const resourceName=(kind:string,id:string)=>{
    if(kind==='agent')return agentMap.get(id)?.name??id;
    if(kind==='subagent')return subagentMap.get(id)?.name??id;
    return teamMap.get(id)?.name??id;
  };
  const statusLabel=(s:string)=>s==='active'?'Executando':s==='forming'?'Montando':s==='completed'?'Concluída':s==='failed'?'Falhou':'Cancelada';

  return <div className="manager-page workforce-page">
    <header className="manager-header">
      <div><span className="office-kicker">Execução temporária</span><h1>Workforces</h1><p>Forças de trabalho montadas pelo Orquestrador. Elas requisitam Agents, Subagents e Teams sem alterar a estrutura permanente.</p></div>
      <div className="workforce-live-pill"><span className="mini-status online"/>{workforces.filter(w=>w.lifecycle_status==='active').length} ativas</div>
    </header>

    <div className="workforce-metrics">
      <div><strong>{workforces.length}</strong><span>Total</span></div>
      <div><strong>{workforces.filter(w=>w.lifecycle_status==='active').length}</strong><span>Executando</span></div>
      <div><strong>{workforces.filter(w=>w.lifecycle_status==='completed').length}</strong><span>Concluídas</span></div>
      <div><strong>{workforces.filter(w=>w.lifecycle_status==='failed'||w.lifecycle_status==='cancelled').length}</strong><span>Encerradas com problema</span></div>
    </div>

    <div className="manager-layout">
      <aside className="manager-list-panel">
        <div className="manager-list-title"><span>Execuções</span><strong>{workforces.length}</strong></div>
        <div className="manager-list">
          {workforces.map(w=><button key={w.id} type="button" className={`agent-manager-select ${selectedId===w.id?'active':''}`} onClick={()=>setSelectedId(w.id)}>
            <span className="agent-manager-avatar">W</span>
            <span className="manager-list-copy"><strong>{w.purpose||'Workforce temporária'}</strong><small>{w.resources.length} recursos · {statusLabel(w.lifecycle_status)}</small></span>
            <span className={`mini-status ${w.lifecycle_status==='active'?'online':w.lifecycle_status==='failed'?'offline':'unknown'}`}/>
          </button>)}
          {!workforces.length&&<div className="manager-empty-small">Nenhuma Workforce criada ainda. O Orquestrador cria automaticamente quando a tarefa exige múltiplos recursos.</div>}
        </div>
      </aside>

      <section className="manager-detail">
        {!selected&&<div className="manager-card"><div className="manager-empty-small">Selecione uma Workforce.</div></div>}
        {selected&&<>
          <div className="manager-card workforce-hero-card">
            <div className="manager-card-header">
              <div><span className="office-kicker">Workforce {selected.id.slice(0,12)}</span><h2>{selected.purpose||'Execução temporária'}</h2></div>
              <span className={`workforce-status status-${selected.lifecycle_status}`}>{statusLabel(selected.lifecycle_status)}</span>
            </div>
            <div className="workforce-detail-grid">
              <div><span>Orchestration Run</span><strong>{selected.orchestration_run_id?.slice(0,16)??'—'}</strong></div>
              <div><span>Chat Run</span><strong>{selected.chat_run_id?.slice(0,16)??'—'}</strong></div>
              <div><span>Execution Plan</span><strong>{selected.execution_plan_id?.slice(0,16)??'—'}</strong></div>
              <div><span>Paralelismo</span><strong>{selected.max_parallelism}</strong></div>
              <div><span>Início</span><strong>{selected.started_at?new Date(selected.started_at).toLocaleString('pt-BR'):'—'}</strong></div>
              <div><span>Fim</span><strong>{selected.completed_at?new Date(selected.completed_at).toLocaleString('pt-BR'):'—'}</strong></div>
            </div>
          </div>

          <div className="manager-card">
            <div className="manager-card-header compact"><div><span className="office-kicker">Composição</span><h2>Recursos requisitados</h2></div><span className="team-version-badge">{selected.resources.length} recursos</span></div>
            <div className="workforce-resource-list">
              {selected.resources.map(r=><div key={`${r.worker_kind}:${r.worker_id}`} className={`workforce-resource resource-${r.worker_kind}`}>
                <span className="workforce-resource-kind">{r.worker_kind==='agent'?'AGENT':r.worker_kind==='subagent'?'SUBAGENT':'TEAM'}</span>
                <div><strong>{resourceName(r.worker_kind,r.worker_id)}</strong><p>{r.reason||'Selecionado pelo Orquestrador para esta execução.'}</p>
                  <div className="workforce-cap-chips">{r.capability_keys.map(k=><span key={k}>{k}</span>)}</div>
                  {r.source_team_id&&r.worker_kind==='subagent'&&<small>Origem: {teamMap.get(r.source_team_id)?.name??r.source_team_id}</small>}
                </div>
                {r.score!=null&&<span className="workforce-score">{Math.round(r.score*100)}%</span>}
              </div>)}
              {!selected.resources.length&&<div className="manager-empty-small">Workforce legada sem metadata de seleção.</div>}
            </div>
          </div>

          {selected.teams.length>0&&<div className="manager-card">
            <div className="manager-card-header compact"><div><span className="office-kicker">Snapshots</span><h2>Teams congeladas nesta execução</h2></div></div>
            <div className="workforce-team-snapshots">{selected.teams.map(t=><div key={t.team_id}><strong>{teamMap.get(t.team_id)?.name??t.team_id}</strong><span>Version snapshot: {t.team_version_id?.slice(0,14)??'—'}</span><small>{t.reason||'Team requisitada como unidade.'}</small></div>)}</div>
          </div>}

          <div className="manager-card">
            <div className="manager-card-header compact"><div><span className="office-kicker">Regras</span><h2>Execução</h2></div></div>
            <div className="workforce-rules">
              <div><strong>Estrutura permanente preservada</strong><span>Nenhum Agent, Subagent ou Team muda de owner ou membership por participar desta Workforce.</span></div>
              <div><strong>Full Access preservado</strong><span>Required tools são requisitos da tarefa, não uma allowlist que reduz o acesso dos workers.</span></div>
              <div><strong>Lifecycle automático</strong><span>A Workforce encerra junto com o Chat Run ou Execution Plan que a originou.</span></div>
            </div>
          </div>
        </>}
        {error&&<div className="manager-alert error">{error}</div>}
      </section>
    </div>
  </div>;
}
