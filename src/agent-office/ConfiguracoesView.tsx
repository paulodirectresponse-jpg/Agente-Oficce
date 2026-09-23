import { useEffect, useMemo, useState } from 'react';
import type { OrchestratorSettings, ProjectRootSetting, ProviderModel, ReleasePreflightReport, RuntimeToolHealth, UniversalProvider } from './types.js';
import { api } from './api.js';
import { V2EmptyState, V2PageHeader, V2Status, V2Tabs } from './shell/V2Primitives.js';

type Tab='geral'|'runtime'|'orquestracao'|'avancado';
const tabs:Array<{key:Tab;label:string}>=[{key:'geral',label:'Geral'},{key:'runtime',label:'Runtime'},{key:'orquestracao',label:'Orquestração'},{key:'avancado',label:'Avançado'}];
type ModelSet=Record<string,ProviderModel[]>;
export function ConfiguracoesView({providers}:{providers:UniversalProvider[]}){
  const [tab,setTab]=useState<Tab>('geral');
  const [setting,setSetting]=useState<ProjectRootSetting|null>(null);
  const [path,setPath]=useState('');
  const [tools,setTools]=useState<RuntimeToolHealth[]>([]);
  const [orchestrator,setOrchestrator]=useState<OrchestratorSettings|null>(null);
  const [models,setModels]=useState<ModelSet>({});
  const [preflight,setPreflight]=useState<ReleasePreflightReport|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{void Promise.all([api.getProjectRootSetting(),api.getRuntimeToolHealthV2(),api.getOrchestratorSettingsV3()]).then(([root,health,orch])=>{setSetting(root);setPath(root.path);setTools(health);setOrchestrator(orch)}).catch(e=>setError(e instanceof Error?e.message:'Falha ao carregar configurações.'))},[]);
  useEffect(()=>{if(tab!=='orquestracao')return;for(const p of providers){if(models[p.id])continue;void api.listProviderModelsV2(p.id).then(list=>setModels(cur=>({...cur,[p.id]:list}))).catch(()=>undefined)}},[tab,providers.map(p=>p.id).join(',')]);

  const healthy=useMemo(()=>tools.filter(t=>t.status==='healthy').length,[tools]);
  const saveRoot=async()=>{if(!path.trim())return;setBusy('root');setNotice(null);try{const s=await api.saveProjectRootSetting(path.trim());setSetting(s);setPath(s.path);setNotice('Pasta padrão salva.')}catch(e){setError(e instanceof Error?e.message:'Falha ao salvar.')}finally{setBusy(null)}};
  const testTools=async()=>{setBusy('tools');try{setTools(await api.testRuntimeToolHealthV2(path||setting?.path||undefined));setNotice('Runtime atualizado.')}catch(e){setError(e instanceof Error?e.message:'Falha ao testar runtime.')}finally{setBusy(null)}};
  const saveOrchestrator=async()=>{if(!orchestrator)return;setBusy('orch');setNotice(null);try{const saved=await api.saveOrchestratorSettingsV3(orchestrator);setOrchestrator(saved);setNotice('Orquestração salva.')}catch(e){setError(e instanceof Error?e.message:'Falha ao salvar orquestração.')}finally{setBusy(null)}};
  const runPreflight=async()=>{setBusy('preflight');try{setPreflight(await api.getReleasePreflightV3(false))}catch(e){setError(e instanceof Error?e.message:'Falha no preflight.')}finally{setBusy(null)}};
  const ref=(key:'principal'|'fast'|'deep')=>orchestrator?.[key]??null;
  const updateRef=(key:'principal'|'fast'|'deep',provider_id:string)=>{
    if(!orchestrator)return;
    const available=models[provider_id]?.filter(m=>m.enabled)??[];
    const model=available.find(m=>m.is_default)??available[0];
    setOrchestrator({...orchestrator,[key]:provider_id?{provider_id,model_id:model?.id??null}:key==='principal'?{provider_id:null,model_id:null}:null});
  };
  const updateModel=(key:'principal'|'fast'|'deep',model_id:string)=>{if(!orchestrator)return;const current=ref(key);if(!current)return;setOrchestrator({...orchestrator,[key]:{...current,model_id:model_id||null}})};

  return <div className="settings-v2-page">
    <V2PageHeader title="Configurações" subtitle="Preferências do Agent Office. Opções técnicas ficam recolhidas por padrão."/>
    <V2Tabs<Tab> items={tabs} value={tab} onChange={setTab} label="Configurações"/>
    <div className="settings-v2-panel">
      {tab==='geral'&&<>
        <section className="settings-v2-section"><div><h3>Pasta padrão dos Projects</h3><p>Novos Projects são criados aqui automaticamente.</p></div><div className="settings-v2-row"><input value={path} onChange={e=>setPath(e.target.value)} placeholder="C:\Users\...\Agent Office Projects"/><button className="v2-primary-button" disabled={busy==='root'||!path.trim()} onClick={()=>void saveRoot()}>Salvar</button></div><small>{setting?.configured?'Configurada e pronta para novos Projects.':'Configure uma pasta antes de criar novos Projects.'}</small></section>
        <section className="settings-v2-section"><div><h3>Comportamento padrão</h3><p>O Agent Office escolhe automaticamente Agents, modelos e recursos quando possível.</p></div><div className="settings-v2-choice"><V2Status tone="success">Automático</V2Status><span>Controles especializados continuam disponíveis nas outras abas.</span></div></section>
      </>}

      {tab==='runtime'&&<>
        <div className="settings-v2-runtime-head"><div><h3>Runtime local</h3><p>Recursos disponíveis na sua máquina.</p></div><strong>{healthy}/{tools.length} operacionais</strong></div>
        <div className="settings-v2-tool-grid">{tools.filter(t=>/files|powershell|git$|browser|computer/i.test(t.id+' '+t.label)).map(tool=><div key={tool.id}><span className={'settings-v2-health '+tool.status}/><div><strong>{tool.label}</strong><small>{tool.detail}</small></div><em>{tool.status}</em></div>)}{!tools.length&&<V2EmptyState title="Runtime ainda não verificado" description="Execute o teste para descobrir os recursos locais."/>}</div>
        <button className="v2-primary-button" disabled={busy==='tools'} onClick={()=>void testTools()}>{busy==='tools'?'Testando…':'Testar runtime'}</button>
        <details className="v2-disclosure"><summary>Todos os recursos detectados</summary><div className="settings-v2-tool-grid compact">{tools.map(tool=><div key={tool.id}><span className={'settings-v2-health '+tool.status}/><div><strong>{tool.label}</strong><small>{tool.detail}</small></div><em>{tool.status}</em></div>)}</div></details>
      </>}

      {tab==='orquestracao'&&<>
        <div className="settings-v2-callout"><strong>Modo automático</strong><p>O Orquestrador decide quanto raciocínio usar. Na maioria dos casos você não precisa alterar isto.</p></div>
        {!orchestrator?<V2EmptyState title="Orquestração indisponível" description="Não foi possível carregar a configuração."/>:<>
          <label className="v2-check-row"><input type="checkbox" checked={orchestrator.enabled} onChange={e=>setOrchestrator({...orchestrator,enabled:e.target.checked})}/><span><strong>Orquestrador ativo</strong><small>Escolhe a rota adequada para cada solicitação.</small></span></label>
          <div className="settings-v2-orch-levels">{(['principal','fast','deep'] as const).map(key=>{const current=ref(key);const ps=key==='principal'?providers:providers;return <section key={key}><div><strong>{key==='principal'?'Principal':key==='fast'?'Rápido':'Profundo'}</strong><small>{key==='principal'?'Controlador padrão':key==='fast'?'Tarefas simples e econômicas':'Tarefas complexas ou de maior risco'}</small></div><select value={current?.provider_id??''} onChange={e=>updateRef(key,e.target.value)}><option value="">{key==='principal'?'Não configurado':'Automático / desativado'}</option>{ps.filter(p=>p.enabled).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><select value={current?.model_id??''} disabled={!current?.provider_id} onChange={e=>updateModel(key,e.target.value)}><option value="">Modelo padrão</option>{(models[current?.provider_id??'']??[]).filter(m=>m.enabled).map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></section>})}</div>
          <details className="v2-disclosure"><summary>Ajustes avançados de roteamento</summary><div className="v2-form-grid"><label>Confiança para rota rápida<input type="number" min={0} max={1} step={.05} value={orchestrator.fast_confidence_threshold} onChange={e=>setOrchestrator({...orchestrator,fast_confidence_threshold:Number(e.target.value)})}/></label><label>Confiança mínima profunda<input type="number" min={0} max={1} step={.05} value={orchestrator.deep_confidence_threshold} onChange={e=>setOrchestrator({...orchestrator,deep_confidence_threshold:Number(e.target.value)})}/></label></div><label className="v2-check-row"><input type="checkbox" checked={orchestrator.deep_for_high_risk} onChange={e=>setOrchestrator({...orchestrator,deep_for_high_risk:e.target.checked})}/><span><strong>Usar análise profunda em alto risco</strong><small>Recomendado.</small></span></label></details>
          <button className="v2-primary-button" disabled={busy==='orch'} onClick={()=>void saveOrchestrator()}>Salvar Orquestração</button>
        </>}
      </>}

      {tab==='avancado'&&<>
        <section className="settings-v2-section"><div><h3>Release Preflight</h3><p>Valida banco, migrations e runtime antes de uma build formal.</p></div><button className="v2-primary-button" disabled={busy==='preflight'} onClick={()=>void runPreflight()}>{busy==='preflight'?'Validando…':'Executar preflight'}</button></section>
        {preflight&&<div className="settings-v2-preflight"><div><strong>{preflight.ready?'READY':'BLOCKED'}</strong><span>migration {preflight.migration_version}</span></div>{preflight.checks.map(check=><article key={check.id} className={check.status}><strong>{check.label}</strong><p>{check.detail}</p><small>{check.status}{check.blocking?' · blocking':''}</small></article>)}</div>}
        <section className="settings-v2-section muted"><div><h3>Diagnósticos profundos</h3><p>Eventos, auditoria e histórico operacional ficam na Central do Sistema.</p></div></section>
      </>}
      {notice&&<div className="v2-notice success">{notice}</div>}{error&&<div className="v2-notice error" role="alert">{error}</div>}
    </div>
  </div>;
}
