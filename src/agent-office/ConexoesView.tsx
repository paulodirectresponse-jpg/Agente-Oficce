import { useEffect, useMemo, useState } from 'react';
import type { Project, ProviderFallback, ProviderModel, ProviderRuntimeStatus, UniversalProvider } from './types.js';
import { api } from './api.js';
import { IntegrationsView } from './IntegrationsView.js';
import { ProviderManagerView } from './ProviderManagerView.js';
import { V2EmptyState, V2PageHeader, V2Status, V2Tabs } from './shell/V2Primitives.js';

type RootTab='ia'|'integracoes';
type ProviderTab='geral'|'modelos'|'resiliencia'|'diagnostico';
const rootTabs:Array<{key:RootTab;label:string}>=[{key:'ia',label:'IA'},{key:'integracoes',label:'Integrações'}];
const providerTabs:Array<{key:ProviderTab;label:string}>=[{key:'geral',label:'Geral'},{key:'modelos',label:'Modelos'},{key:'resiliencia',label:'Resiliência'},{key:'diagnostico',label:'Diagnóstico'}];
function tone(provider:UniversalProvider):'neutral'|'success'|'warning'|'danger'{if(!provider.enabled)return'neutral';if(provider.health_status==='healthy')return'success';if(provider.health_status==='unavailable')return'danger';return'warning'}
function label(provider:UniversalProvider){if(!provider.enabled)return'Desativada';if(provider.health_status==='healthy')return'Disponível';if(provider.health_status==='unavailable')return'Indisponível';return'Verificando'}
export function ConexoesView({providers,project,onChanged}:{providers:UniversalProvider[];project:Project|null;onChanged:()=>void|Promise<void>}){
  const [rootTab,setRootTab]=useState<RootTab>('ia');
  const [selectedId,setSelectedId]=useState<string|null>(providers[0]?.id??null);
  const [providerTab,setProviderTab]=useState<ProviderTab>('geral');
  const [models,setModels]=useState<ProviderModel[]>([]);
  const [runtime,setRuntime]=useState<ProviderRuntimeStatus|null>(null);
  const [fallbacks,setFallbacks]=useState<ProviderFallback[]>([]);
  const [search,setSearch]=useState('');
  const [showTechnicalManager,setShowTechnicalManager]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const selected=providers.find(x=>x.id===selectedId)??null;

  useEffect(()=>{if(selectedId&&!providers.some(x=>x.id===selectedId))setSelectedId(providers[0]?.id??null);if(!selectedId&&providers[0])setSelectedId(providers[0].id)},[providers,selectedId]);
  useEffect(()=>{
    if(!selected){setModels([]);setRuntime(null);setFallbacks([]);return}
    setError(null);setProviderTab('geral');
    void Promise.all([
      api.listProviderModelsV2(selected.id),
      api.getProviderRuntimeV2(selected.id).catch(()=>null),
      api.listProviderFallbacksV2(selected.id).catch(()=>[]),
    ]).then(([m,r,f])=>{setModels(m);setRuntime(r as ProviderRuntimeStatus|null);setFallbacks(f as ProviderFallback[])});
  },[selected?.id]);

  const refreshSelected=async()=>{if(!selected)return;const [m,r,f]=await Promise.all([api.listProviderModelsV2(selected.id),api.getProviderRuntimeV2(selected.id).catch(()=>null),api.listProviderFallbacksV2(selected.id).catch(()=>[])]);setModels(m);setRuntime(r);setFallbacks(f)};
  const test=async()=>{if(!selected)return;setBusy(true);setNotice(null);setError(null);try{const result=await api.testProviderV2(selected.id);setNotice(result.status==='healthy'?'Conexão funcionando.':'Conexão indisponível.');await onChanged();await refreshSelected()}catch(e){setError(e instanceof Error?e.message:'Falha ao testar conexão.')}finally{setBusy(false)}};
  const discover=async()=>{if(!selected)return;setBusy(true);setNotice(null);try{await api.discoverProviderModelsV2(selected.id,true);await refreshSelected();setNotice('Modelos atualizados.')}catch(e){setError(e instanceof Error?e.message:'Falha ao descobrir modelos.')}finally{setBusy(false)}};
  const updateModel=async(model:ProviderModel,patch:Partial<ProviderModel>)=>{setBusy(true);try{await api.updateProviderModelV2(model.id,patch);await refreshSelected()}catch(e){setError(e instanceof Error?e.message:'Falha ao atualizar modelo.')}finally{setBusy(false)}};
  const filtered=useMemo(()=>models.filter(m=>!search.trim()||(m.display_name+' '+m.model_id).toLowerCase().includes(search.toLowerCase())),[models,search]);
  const defaultModel=models.find(x=>x.enabled&&x.is_default)??models.find(x=>x.enabled);

  return <div className="connections-v2-page">
    <V2PageHeader title="Conexões" subtitle="IAs e serviços externos usados pelo Agent Office." actions={rootTab==='ia'?<button className="v2-primary-button" onClick={()=>setShowTechnicalManager(v=>!v)}>{showTechnicalManager?'Fechar configuração':'+ Conectar IA'}</button>:undefined}/>
    <V2Tabs<RootTab> items={rootTabs} value={rootTab} onChange={setRootTab} label="Conexões"/>
    {rootTab==='ia'&&<div className="connections-v2-body">
      {showTechnicalManager&&<details className="connections-v2-technical" open><summary>Configuração completa da conexão</summary><ProviderManagerView providers={providers} onChanged={onChanged}/></details>}
      <div className="connections-v2-layout">
        <aside className="connections-v2-list">{providers.map(provider=><button type="button" key={provider.id} className={selected?.id===provider.id?'active':''} onClick={()=>setSelectedId(provider.id)}>
          <span className="connections-v2-provider-icon">{provider.name.slice(0,1).toUpperCase()}</span><span><strong>{provider.name}</strong><small>{provider.protocol_driver}</small></span><span className={'connections-v2-health '+tone(provider)}/>
        </button>)}{!providers.length&&<V2EmptyState title="Conecte uma IA" description="Use “Conectar IA” para começar."/ >}</aside>
        <section className="connections-v2-detail">
          {!selected&&<V2EmptyState title="Nenhuma IA selecionada" description="Conecte uma IA para configurar Agents e começar a trabalhar."/>}
          {selected&&<>
            <div className="connections-v2-hero"><div><span className="connections-v2-provider-icon large">{selected.name.slice(0,1)}</span><div><h2>{selected.name}</h2><p>{models.filter(x=>x.enabled).length} modelos ativos · {defaultModel?.display_name||'sem modelo padrão'}</p></div></div><V2Status tone={tone(selected)}>{label(selected)}</V2Status></div>
            <V2Tabs<ProviderTab> items={providerTabs} value={providerTab} onChange={setProviderTab} label="Detalhes da IA"/>
            <div className="connections-v2-panel">
              {providerTab==='geral'&&<>
                <div className="connections-v2-facts"><div><span>Estado</span><strong>{label(selected)}</strong></div><div><span>Modelo padrão</span><strong>{defaultModel?.display_name||'Não definido'}</strong></div><div><span>Modelos ativos</span><strong>{models.filter(x=>x.enabled).length}</strong></div></div>
                <section className="connections-v2-general"><div><h3>Conexão</h3><p>O Agent Office usa esta conexão para executar os modelos dos seus Agents.</p></div><code>{selected.base_url}</code><div><button onClick={()=>void test()} disabled={busy}>Testar conexão</button><button onClick={()=>void discover()} disabled={busy}>Atualizar modelos</button><button onClick={()=>setShowTechnicalManager(true)}>Editar conexão</button></div></section>
                {notice&&<div className="v2-notice success">{notice}</div>}{error&&<div className="v2-notice error">{error}</div>}
              </>}
              {providerTab==='modelos'&&<>
                <div className="connections-v2-model-head"><div><h3>Modelos</h3><p>Ative somente os modelos que pretende usar.</p></div><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pesquisar modelo…"/></div>
                <div className="connections-v2-models">{filtered.map(model=><div key={model.id}><div><strong>{model.display_name}</strong><code>{model.model_id}</code></div><div>{model.is_default&&<span className="connections-v2-default">Padrão</span>}<V2Status tone={model.enabled?'success':'neutral'}>{model.enabled?'Ativo':'Desativado'}</V2Status><button disabled={busy||model.is_default||!model.enabled} onClick={()=>void updateModel(model,{is_default:true})}>Definir padrão</button><button disabled={busy} onClick={()=>void updateModel(model,{enabled:!model.enabled})}>{model.enabled?'Desativar':'Ativar'}</button></div></div>)}{!filtered.length&&<V2EmptyState title="Nenhum modelo" description="Atualize os modelos da conexão ou ajuste a pesquisa."/ >}</div>
              </>}
              {providerTab==='resiliencia'&&<>
                <div className="connections-v2-callout"><strong>Alternativas automáticas</strong><p>Quando esta IA falha de forma recuperável, o Agent Office pode usar uma conexão alternativa sem alterar o Agent.</p></div>
                <div className="connections-v2-fallbacks">{fallbacks.map((f,index)=>{const target=providers.find(p=>p.id===f.target_provider_id);return <div key={f.id}><span>{index+1}</span><div><strong>{target?.name||f.target_provider_id}</strong><small>{f.target_model||'modelo padrão'}</small></div><V2Status tone={f.enabled?'success':'neutral'}>{f.enabled?'Ativa':'Desativada'}</V2Status></div>})}{!fallbacks.length&&<V2EmptyState title="Sem alternativa configurada" description="A conexão será usada diretamente. Configure fallback somente se precisar de maior resiliência."/>}</div>
                <button className="v2-secondary-button" onClick={()=>setShowTechnicalManager(true)}>Gerenciar resiliência avançada</button>
              </>}
              {providerTab==='diagnostico'&&<>
                <div className="connections-v2-diagnostic">{runtime?<><div><span>Requisições ativas</span><strong>{runtime.runtime.active_requests}</strong></div><div><span>Na fila</span><strong>{runtime.runtime.queued_requests}</strong></div><div><span>RPM</span><strong>{runtime.runtime.rpm_used}/{runtime.runtime.rpm_limit||'—'}</strong></div><div><span>TPM</span><strong>{runtime.runtime.tpm_used}/{runtime.runtime.tpm_limit||'—'}</strong></div><div><span>Circuito</span><strong>{runtime.runtime.circuit_state}</strong></div><div><span>Falhas seguidas</span><strong>{runtime.runtime.consecutive_failures}</strong></div></>:<V2EmptyState title="Diagnóstico indisponível" description="Teste a conexão para atualizar o estado."/ >}</div>
                {runtime?.runtime.last_error&&<div className="v2-notice error">{runtime.runtime.last_error}</div>}
              </>}
            </div>
          </>}
        </section>
      </div>
    </div>}
    {rootTab==='integracoes'&&<div className="connections-v2-integrations"><IntegrationsView project={project}/></div>}
  </div>;
}
