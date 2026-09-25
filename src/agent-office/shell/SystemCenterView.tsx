import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnalyticsView } from '../AnalyticsView.js';
import { api } from '../api.js';
import type { ActivityEventV2, IntegrationConnection, OrchestrationEvent, OrchestrationRun, OrchestratorStatus, Project, ReleasePreflightReport, RuntimeToolHealth, UniversalProvider } from '../types.js';
import { V2EmptyState, V2Status, V2Tabs } from './V2Primitives.js';
import { runtimeLabel } from './shellModel.js';
import type { RuntimeState } from './shellModel.js';

type SystemTab='atividade'|'uso'|'saude'|'orquestracao'|'diagnostico';
const tabs:Array<{key:SystemTab;label:string}>=[{key:'atividade',label:'Atividade'},{key:'uso',label:'Uso & Custo'},{key:'saude',label:'Saúde'},{key:'orquestracao',label:'Orquestração'},{key:'diagnostico',label:'Diagnóstico'}];
function pTone(p:UniversalProvider):'neutral'|'success'|'warning'|'danger'{if(!p.enabled)return'neutral';if(p.health_status==='healthy')return'success';if(p.health_status==='unavailable')return'danger';return'warning'}
function iTone(i:IntegrationConnection):'neutral'|'success'|'warning'|'danger'{if(!i.enabled)return'neutral';if(i.health_status==='healthy')return'success';if(['auth_error','unavailable','misconfigured'].includes(i.health_status))return'danger';return'warning'}
export function SystemCenterView({runtimeState,providers,activeProject}:{runtimeState:RuntimeState;providers:UniversalProvider[];activeProject:Project|null}){
  const [tab,setTab]=useState<SystemTab>('atividade');
  const [activity,setActivity]=useState<ActivityEventV2[]>([]);
  const [integrations,setIntegrations]=useState<IntegrationConnection[]>([]);
  const [tools,setTools]=useState<RuntimeToolHealth[]>([]);
  const [orchStatus,setOrchStatus]=useState<OrchestratorStatus|null>(null);
  const [runs,setRuns]=useState<OrchestrationRun[]>([]);
  const [events,setEvents]=useState<OrchestrationEvent[]>([]);
  const [preflight,setPreflight]=useState<ReleasePreflightReport|null>(null);
  const [error,setError]=useState<string|null>(null);

  const loadActivity=useCallback(async()=>{if(!activeProject){setActivity([]);return}try{setActivity((await api.listActivityV2(activeProject.id)).slice(0,60))}catch{setError('Não foi possível carregar a atividade agora.')}},[activeProject?.id]);
  useEffect(()=>{if(tab!=='atividade')return;void loadActivity();const timer=window.setInterval(()=>void loadActivity(),8000);return()=>window.clearInterval(timer)},[tab,loadActivity]);
  useEffect(()=>{if(tab!=='saude')return;void Promise.all([api.listIntegrationsV3(),api.getRuntimeToolHealthV2()]).then(([i,t])=>{setIntegrations(i);setTools(t)}).catch(()=>undefined)},[tab]);
  useEffect(()=>{if(tab!=='orquestracao')return;void Promise.all([api.getOrchestratorStatusV3(),api.listOrchestrationRunsV3(30),api.listOrchestrationEventsV3(80)]).then(([s,r,e])=>{setOrchStatus(s);setRuns(r);setEvents(e)}).catch(()=>setError('Não foi possível carregar a orquestração.'))},[tab]);
  useEffect(()=>{if(tab!=='diagnostico')return;void api.getReleasePreflightV3(false).then(setPreflight).catch(()=>setPreflight(null))},[tab]);

  const health=useMemo(()=>({providers:providers.filter(p=>p.enabled&&p.health_status==='healthy').length,integrations:integrations.filter(i=>i.enabled&&i.health_status==='healthy').length,tools:tools.filter(t=>t.status==='healthy').length}),[providers,integrations,tools]);
  return <section className="system-v2-page" aria-label="Central do sistema">
    <header className="system-v2-header"><div><h1>Central do sistema</h1><p>Veja o que está acontecendo sem colocar detalhes técnicos no caminho do trabalho.</p></div></header>
    <V2Tabs<SystemTab> items={tabs} value={tab} onChange={setTab} label="Central do sistema"/>
    <div className="system-v2-panel">
      {error&&<div className="v2-notice error">{error}</div>}
      {tab==='atividade'&&<>
        {!activeProject?<V2EmptyState title="Sem Project ativo" description="Selecione um Project para ver a atividade recente."/>:activity.length?<div className="system-v2-activity">{activity.map(event=><article key={event.id}><span className={'system-v2-event-dot '+event.severity}/><div><strong>{event.title}</strong>{event.detail&&<p>{event.detail}</p>}</div><time>{new Date(event.created_at).toLocaleString('pt-BR')}</time></article>)}</div>:<V2EmptyState title="Sem atividade recente" description={'Quando houver trabalho em “'+activeProject.name+'”, ele aparece aqui.'}/>}
      </>}
      {tab==='uso'&&<div className="system-v2-embed"><AnalyticsView/></div>}
      {tab==='saude'&&<>
        <div className="system-v2-health-summary"><div><span>Runtime</span><strong>{runtimeLabel(runtimeState)}</strong></div><div><span>IAs</span><strong>{health.providers}/{providers.length} disponíveis</strong></div><div><span>Integrações</span><strong>{health.integrations}/{integrations.length} disponíveis</strong></div><div><span>Recursos locais</span><strong>{health.tools}/{tools.length} operacionais</strong></div></div>
        <section className="system-v2-health-section"><h3>IAs</h3>{providers.map(p=><div key={p.id}><span>{p.name}</span><V2Status tone={pTone(p)}>{p.enabled?p.health_status:'Desativada'}</V2Status></div>)}</section>
        <section className="system-v2-health-section"><h3>Integrações</h3>{integrations.map(i=><div key={i.id}><span>{i.name}</span><V2Status tone={iTone(i)}>{i.enabled?i.health_status:'Desativada'}</V2Status></div>)}{!integrations.length&&<p>Nenhuma integração externa configurada.</p>}</section>
        <details className="v2-disclosure"><summary>Recursos locais</summary><div className="system-v2-tool-health">{tools.map(t=><div key={t.id}><strong>{t.label}</strong><span>{t.status}</span><small>{t.detail}</small></div>)}</div></details>
      </>}
      {tab==='orquestracao'&&<>
        {!orchStatus?<V2EmptyState title="Sem dados de orquestração" description="As decisões aparecerão depois das primeiras execuções."/>:<>
          <div className="system-v2-orch-kpis"><div><span>Decisões · 24h</span><strong>{orchStatus.stats_24h.total}</strong></div><div><span>Rota rápida</span><strong>{orchStatus.stats_24h.fast}</strong></div><div><span>Análise profunda</span><strong>{orchStatus.stats_24h.deep}</strong></div><div><span>Alternativas usadas</span><strong>{orchStatus.stats_24h.fallback}</strong></div></div>
          <div className="system-v2-orch-grid"><section><h3>Decisões recentes</h3>{runs.map(run=><article key={run.id}><div><strong>{String(run.decision?.normalized_goal||'Solicitação').slice(0,100)}</strong><small>{new Date(run.created_at).toLocaleString('pt-BR')}</small></div><span>{run.level_used}</span></article>)}{!runs.length&&<p>Sem decisões registradas.</p>}</section><section><h3>Trilha recente</h3>{events.slice(0,30).map(e=><article key={e.id}><span className={'system-v2-event-dot '+e.severity}/><div><strong>{e.title}</strong><small>{e.detail}</small></div></article>)}</section></div>
          <p className="system-v2-hint">A configuração Principal/Rápido/Profundo fica em Configurações → Orquestração.</p>
        </>}
      </>}
      {tab==='diagnostico'&&<>
        {!preflight?<V2EmptyState title="Carregando diagnóstico" description="Validando release e banco local."/>:<><div className="system-v2-diagnostic-head"><div><strong>{preflight.ready?'READY':'BLOCKED'}</strong><span>Migration {preflight.migration_version}</span></div><time>{new Date(preflight.generated_at).toLocaleString('pt-BR')}</time></div><div className="system-v2-checks">{preflight.checks.map(check=><article key={check.id} className={check.status}><strong>{check.label}</strong><p>{check.detail}</p><small>{check.status}{check.blocking?' · blocking':''}</small></article>)}</div></>}
        <div className="system-v2-hint">Logs, auditoria de Tools e eventos detalhados permanecem preservados no backend e nas inspeções de execução.</div>
      </>}
    </div>
  </section>;
}
