import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import type { AnalyticsRange, AnalyticsSnapshot, Project } from './types.js';

type Tab='overview'|'workers'|'projects'|'execution'|'providers'|'orchestrator'|'usage';

const fmt=(n:number)=>new Intl.NumberFormat('pt-BR',{notation:n>=10000?'compact':'standard',maximumFractionDigits:1}).format(n);
const pct=(n:number|null)=>n==null?'—':`${n.toFixed(1)}%`;
const money=(n:number|null)=>n==null?'não disponível':`US$ ${n.toFixed(4)}`;
const ms=(n:number|null)=>n==null?'—':n<1000?`${n} ms`:n<60000?`${(n/1000).toFixed(1)}s`:`${(n/60000).toFixed(1)} min`;
const date=(v:string|null)=>v?new Date(v).toLocaleString('pt-BR'):'—';

export function AnalyticsView(){
  const [data,setData]=useState<AnalyticsSnapshot|null>(null);
  const [projects,setProjects]=useState<Project[]>([]);
  const [range,setRange]=useState<AnalyticsRange>('7d');
  const [projectId,setProjectId]=useState('');
  const [workerFilter,setWorkerFilter]=useState('');
  const [providerId,setProviderId]=useState('');
  const [modelId,setModelId]=useState('');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [tab,setTab]=useState<Tab>('overview');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  const load=useCallback(async()=>{
    if(range==='custom'&&!from){setLoading(false);return;}
    setLoading(true);
    try{
      const filters:any={range};
      if(projectId)filters.project_id=projectId;
      if(workerFilter){
        const [kind,id]=workerFilter.split(':',2);
        if(kind==='agent')filters.agent_id=id;
        if(kind==='subagent')filters.subagent_id=id;
      }
      if(providerId)filters.provider_id=providerId;
      if(modelId)filters.model_id=modelId;
      if(range==='custom'){
        filters.from=new Date(from).toISOString();
        if(to)filters.to=new Date(to).toISOString();
      }
      const [snapshot,list]=await Promise.all([api.getAnalyticsV3(filters),api.listProjects()]);
      setData(snapshot);setProjects(list);setError(null);
    }catch(e){setError(e instanceof Error?e.message:'Falha ao carregar métricas.')}
    finally{setLoading(false)}
  },[range,projectId,workerFilter,providerId,modelId,from,to]);

  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),20000);return()=>window.clearInterval(timer)},[load]);

  const maxTokens=useMemo(()=>Math.max(1,...(data?.timeseries??[]).map(x=>x.total_tokens)),[data]);
  const tabs:Array<{key:Tab;label:string}>=[
    {key:'overview',label:'Visão geral'},{key:'workers',label:'Equipe'},{key:'projects',label:'Projects'},
    {key:'execution',label:'Execução'},{key:'providers',label:'IAs'},{key:'orchestrator',label:'Orquestração'},
    {key:'usage',label:'Uso & Custo'},
  ];

  return <div className="analytics-page">
    <header className="analytics-header">
      <div><span className="office-kicker">Inteligência operacional</span><h1>Monitoramento</h1><p>Métricas observáveis do Agent Office, sem scores artificiais e sem dupla contagem de execuções em equipe.</p></div>
      <div className="analytics-filters">
        <select value={range} onChange={e=>setRange(e.target.value as AnalyticsRange)}>
          <option value="24h">24 horas</option><option value="7d">7 dias</option><option value="30d">30 dias</option><option value="all">Tudo</option><option value="custom">Personalizado</option>
        </select>
        <select value={projectId} onChange={e=>setProjectId(e.target.value)}>
          <option value="">Todos os Projects</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={workerFilter} onChange={e=>setWorkerFilter(e.target.value)}>
          <option value="">Todos os membros</option>{data?.workers.map(w=><option key={w.worker_kind+':'+w.id} value={w.worker_kind+':'+w.id}>{w.worker_kind==='subagent'?'Subagent':'Agent'} · {w.name}</option>)}
        </select>
        <select value={providerId} onChange={e=>{setProviderId(e.target.value);setModelId('')}}>
          <option value="">Todas as IAs</option>{data?.providers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={modelId} onChange={e=>setModelId(e.target.value)}>
          <option value="">Todos os modelos</option>{data?.providers.flatMap(p=>p.models).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button className="btn" onClick={()=>void load()} disabled={loading}>{loading?'Atualizando…':'Atualizar'}</button>
      </div>
    </header>

    {range==='custom'&&<div className="analytics-custom-range"><label>De<input type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Até<input type="datetime-local" value={to} onChange={e=>setTo(e.target.value)}/></label></div>}
    {error&&<div className="analytics-error">{error}</div>}
    {!data&&loading&&<div className="empty-state">Carregando métricas…</div>}

    {data&&<>
      <div className="analytics-tabs">{tabs.map(t=><button key={t.key} className={tab===t.key?'active':''} onClick={()=>setTab(t.key)}>{t.label}</button>)}</div>

      {tab==='overview'&&<div className="analytics-stack">
        <div className="analytics-kpis">
          <div><span>Execuções</span><strong>{fmt(data.overview.runs)}</strong><small>{data.overview.completed_runs} concluídos · {data.overview.failed_runs} falharam</small></div>
          <div><span>Taxa de sucesso</span><strong>{pct(data.overview.success_rate)}</strong><small>somente execuções concluídas</small></div>
          <div><span>Tokens</span><strong>{fmt(data.overview.total_tokens)}</strong><small>{fmt(data.overview.input_tokens)} entrada · {fmt(data.overview.output_tokens)} saída</small></div>
          <div><span>Custo conhecido</span><strong>{money(data.overview.cost_usd)}</strong><small>{data.overview.cost_coverage_pct.toFixed(1)}% de cobertura</small></div>
          <div><span>Retrabalho</span><strong>{data.overview.rework_events}</strong><small>separado de falhas operacionais</small></div>
          <div><span>Falhas operacionais</span><strong>{data.overview.operational_failures}</strong><small>{data.overview.cancelled_runs} execuções canceladas</small></div>
        </div>
        <section className="analytics-card">
          <div className="analytics-card-head"><div><span className="office-kicker">Tendência</span><h2>Consumo e execuções</h2></div><small>gerado {date(data.generated_at)}</small></div>
          <div className="analytics-chart">
            {data.timeseries.map(point=><div className="analytics-bar-col" key={point.bucket} title={`${point.bucket} · ${point.total_tokens} tokens · ${point.runs} runs`}>
              <div className="analytics-bar-track"><div className="analytics-bar" style={{height:`${Math.max(4,(point.total_tokens/maxTokens)*100)}%`}}/></div>
              <strong>{point.runs}</strong><span>{range==='24h'?point.bucket.slice(11,16):point.bucket.slice(5)}</span>
            </div>)}
            {!data.timeseries.length&&<div className="empty-state">Sem dados no período.</div>}
          </div>
        </section>
        <details className="analytics-data-quality">
          <summary>Qualidade dos dados</summary>
          <section className="analytics-quality">
            <div className={data.data_quality.anti_double_counting?'good':'warn'}><strong>Proteção contra dupla contagem</strong><span>{data.data_quality.anti_double_counting?'Ativa':'Atenção'}</span></div>
            <div><strong>Uso rastreável</strong><span>{data.data_quality.scoped_usage_events} eventos</span></div>
            <div className={data.data_quality.unscoped_usage_events?'warn':'good'}><strong>Uso antigo sem escopo</strong><span>{data.data_quality.unscoped_usage_events}</span></div>
            <div><strong>Cobertura de custo</strong><span>{data.data_quality.cost_coverage_pct.toFixed(1)}%</span></div>
          </section>
        </details>
      </div>}

      {tab==='workers'&&<div className="analytics-stack"><section className="analytics-card">
        <div className="analytics-card-head"><div><span className="office-kicker">Equipe</span><h2>Agents e Subagents</h2></div><small>qualidade e operação permanecem separadas</small></div>
        <div className="analytics-table-wrap"><table className="data-table analytics-table"><thead><tr><th>Membro</th><th>Tipo</th><th>Execuções</th><th>Sucesso</th><th>Primeira tentativa</th><th>Retrabalho</th><th>Tokens</th><th>Custo</th><th>Latência</th></tr></thead><tbody>
          {data.workers.map(w=><tr key={w.worker_kind+':'+w.id}><td><strong>{w.name}</strong><small>{w.role||'—'}</small></td><td><span className={'analytics-kind '+w.worker_kind}>{w.worker_kind}</span></td><td>{w.runs}</td><td>{pct(w.success_rate)}</td><td>{pct(w.first_pass_rate)}</td><td>{pct(w.rework_rate)}</td><td>{fmt(w.total_tokens)}</td><td>{money(w.cost_usd)}<small>{w.cost_coverage_pct.toFixed(0)}% cobertura</small></td><td>{ms(w.average_run_duration_ms)}</td></tr>)}
        </tbody></table></div>
      </section></div>}

      {tab==='projects'&&<div className="analytics-stack"><section className="analytics-card">
        <div className="analytics-card-head"><div><span className="office-kicker">Projects</span><h2>Performance operacional</h2></div></div>
        <div className="analytics-table-wrap"><table className="data-table analytics-table"><thead><tr><th>Project</th><th>Execuções</th><th>Sucesso</th><th>Planos</th><th>Recursos temporários</th><th>Bloqueios</th><th>Tokens</th><th>Custo</th></tr></thead><tbody>
          {data.projects.map(p=><tr key={p.id}><td><strong>{p.name}</strong><small>{p.lifecycle_status}</small></td><td>{p.runs}</td><td>{pct(p.success_rate)}</td><td>{p.completed_plans}/{p.plans}<small>{p.failed_plans} falhos</small></td><td>{p.workforces}<small>{p.failed_workforces} falhas</small></td><td>{p.open_blockers}</td><td>{fmt(p.total_tokens)}</td><td>{money(p.cost_usd)}<small>{p.cost_coverage_pct.toFixed(0)}% cobertura</small></td></tr>)}
        </tbody></table></div>
      </section></div>}

      {tab==='execution'&&<div className="analytics-stack">
        <div className="analytics-kpis">
          <div><span>Sucesso dos planos</span><strong>{pct(data.execution.plan_success_rate)}</strong><small>{data.execution.completed_plans}/{data.execution.plans} concluídos</small></div>
          <div><span>Sucesso das etapas</span><strong>{pct(data.execution.step_success_rate)}</strong><small>{data.execution.completed_steps}/{data.execution.steps} concluídos</small></div>
          <div><span>Taxa de repetição</span><strong>{pct(data.execution.retry_rate)}</strong><small>{data.execution.retry_attempts} tentativas extras</small></div>
          <div><span>Replanejamentos</span><strong>{data.execution.replans}</strong><small>{data.execution.blocked_steps} etapas bloqueadas</small></div>
          <div><span>Tempo / limite</span><strong>{data.execution.timed_out} / {data.execution.budget_exceeded}</strong><small>tentativas terminais</small></div>
          <div><span>Duração média</span><strong>{ms(data.execution.average_attempt_duration_ms)}</strong><small>{data.execution.attempts} tentativas</small></div>
        </div>
        <section className="analytics-quality">
          <div><strong>Recursos temporários</strong><span>{data.execution.workforces.total}</span></div>
          <div><strong>Concluídas</strong><span>{data.execution.workforces.completed}</span></div>
          <div><strong>Falhas / canceladas</strong><span>{data.execution.workforces.failed} / {data.execution.workforces.cancelled}</span></div>
          <div><strong>Recursos médios</strong><span>{data.execution.workforces.average_resources}</span></div>
        </section>
        <section className="analytics-card"><div className="analytics-card-head"><div><span className="office-kicker">Ferramentas</span><h2>Ferramentas e aprovações</h2></div><small>{data.execution.tool_calls} chamadas · {data.execution.tool_failures} falhas</small></div>
          <div className="analytics-table-wrap"><table className="data-table analytics-table"><thead><tr><th>Ferramenta</th><th>Chamadas</th><th>Concluídas</th><th>Falhas</th><th>Duração</th><th>Aprovações</th><th>Negadas</th></tr></thead><tbody>
            {data.tools.map(t=><tr key={t.name}><td className="mono">{t.name}</td><td>{t.calls}</td><td>{t.completed}</td><td>{t.failed}</td><td>{ms(t.average_duration_ms)}</td><td>{t.approvals}</td><td>{t.denied}</td></tr>)}
          </tbody></table></div>
        </section>
      </div>}

      {tab==='providers'&&<div className="analytics-provider-grid">
        {data.providers.map(p=><section className="analytics-card analytics-provider-card" key={p.id}>
          <div className="analytics-card-head"><div><span className="office-kicker">{p.operational_status}</span><h2>{p.name}</h2></div><span className={'mini-status '+(p.health_status==='healthy'?'online':p.enabled?'unknown':'offline')}/></div>
          <div className="analytics-provider-stats"><div><span>Tokens</span><strong>{fmt(p.total_tokens)}</strong></div><div><span>Custo</span><strong>{money(p.cost_usd)}</strong></div><div><span>Fila</span><strong>{p.queued_requests}</strong></div><div><span>Falhas seq.</span><strong>{p.consecutive_failures}</strong></div></div>
          <div className="analytics-model-list">{p.models.map(m=><div key={m.id}><span><strong>{m.name}</strong><small>{m.model_id}</small></span><span>{fmt(m.total_tokens)} tokens</span><span>{money(m.cost_usd)}</span></div>)}</div>
          <small>Último sucesso: {date(p.last_success_at)} · circuito: {p.circuit_state??'—'}</small>
        </section>)}
      </div>}

      {tab==='orchestrator'&&<div className="analytics-stack">
        <div className="analytics-kpis">
          <div><span>Roteamentos</span><strong>{data.orchestrator.total}</strong><small>{data.orchestrator.failed} falhos</small></div>
          <div><span>Sucesso</span><strong>{pct(data.orchestrator.success_rate)}</strong><small>routing saídacome</small></div>
          <div><span>Alternativa automática</span><strong>{pct(data.orchestrator.fallback_rate)}</strong><small>{data.orchestrator.fallback_events} eventos</small></div>
          <div><span>Latência</span><strong>{ms(data.orchestrator.average_duration_ms)}</strong><small>média do roteamento</small></div>
          <div><span>Tokens</span><strong>{fmt(data.orchestrator.input_tokens+data.orchestrator.output_tokens)}</strong><small>somente Orquestrador</small></div>
          <div><span>Níveis</span><strong>{data.orchestrator.levels.fast}/{data.orchestrator.levels.deep}</strong><small>rápido / profundo</small></div>
        </div>
        <section className="analytics-quality">
          <div><strong>Execuções ligadas</strong><span>{data.orchestrator.execution_outcome.linked}</span></div>
          <div><strong>Execuções concluídas</strong><span>{data.orchestrator.execution_outcome.completed}</span></div>
          <div><strong>Falhas / canceladas</strong><span>{data.orchestrator.execution_outcome.failed} / {data.orchestrator.execution_outcome.cancelled}</span></div>
          <div><strong>Sucesso após roteamento</strong><span>{pct(data.orchestrator.execution_outcome.success_rate)}</span></div>
        </section>
        <section className="analytics-card"><div className="analytics-levels">
          {Object.entries(data.orchestrator.levels).map(([key,value])=><div key={key}><span>{key}</span><strong>{value}</strong><div><i style={{width:`${data.orchestrator.total?Math.max(3,(value/data.orchestrator.total)*100):0}%`}}/></div></div>)}
        </div></section>
      </div>}

      {tab==='usage'&&<div className="analytics-stack">
        <div className="analytics-kpis">
          <div><span>Tokens de entrada</span><strong>{fmt(data.overview.input_tokens)}</strong></div>
          <div><span>Tokens de saída</span><strong>{fmt(data.overview.output_tokens)}</strong></div>
          <div><span>Requisições</span><strong>{fmt(data.overview.requests)}</strong></div>
          <div><span>Custo acumulado conhecido</span><strong>{money(data.overview.cost_usd)}</strong><small>nunca substitui custo desconhecido por zero</small></div>
          <div><span>Cobertura</span><strong>{data.overview.cost_coverage_pct.toFixed(1)}%</strong><small>{data.overview.cost_known_events} conhecidos · {data.overview.cost_unknown_events} desconhecidos</small></div>
          <div><span>Duração média por membro</span><strong>{ms(data.overview.average_duration_ms)}</strong><small>{data.overview.usage_events} eventos de uso</small></div>
        </div>
        <section className="analytics-card"><div className="analytics-card-head"><div><span className="office-kicker">Qualidade dos dados</span><h2>Como estes números são calculados</h2></div></div>
          <div className="analytics-notes">{data.data_quality.notes.map(note=><div key={note}>✓ {note}</div>)}</div>
          <div className="analytics-coverage"><span>Custo informado: <strong>{data.overview.cost_reported_events}</strong></span><span>Custo estimado: <strong>{data.overview.cost_estimated_events}</strong></span><span>Desconhecido: <strong>{data.overview.cost_unknown_events}</strong></span></div>
        </section>
      </div>}
    </>}
  </div>
}
