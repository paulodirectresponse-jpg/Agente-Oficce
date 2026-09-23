import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import type { IntegrationCatalogEntry, IntegrationConnection, Project, ProjectIntegrationBinding } from './types.js';

type Draft={driver:string;name:string;auth_mode:string;secret:string};

function statusLabel(status:string){
  if(status==='healthy')return'Healthy';
  if(status==='auth_error')return'Auth required';
  if(status==='degraded')return'Degraded';
  if(status==='unavailable')return'Unavailable';
  if(status==='misconfigured')return'Misconfigured';
  return'Unknown';
}

export function IntegrationsView({project}:{project:Project|null}){
  const [catalog,setCatalog]=useState<IntegrationCatalogEntry[]>([]);
  const [connections,setConnections]=useState<IntegrationConnection[]>([]);
  const [bindings,setBindings]=useState<ProjectIntegrationBinding[]>([]);
  const [draft,setDraft]=useState<Draft|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);

  const load=useCallback(async()=>{
    try{
      const [nextCatalog,nextConnections,nextBindings]=await Promise.all([
        api.listIntegrationCatalogV3(),
        api.listIntegrationsV3(),
        project?api.listProjectIntegrationsV3(project.id):Promise.resolve([]),
      ]);
      setCatalog(nextCatalog);setConnections(nextConnections);setBindings(nextBindings);setMessage(null);
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao carregar integrações.')}
  },[project?.id]);

  useEffect(()=>{void load()},[load]);

  const boundIds=useMemo(()=>new Set(bindings.map(x=>x.integration_id)),[bindings]);

  async function create(){
    if(!draft)return;
    setBusy('create');
    try{
      await api.createIntegrationV3({
        driver:draft.driver,
        name:draft.name||undefined,
        auth_mode:draft.auth_mode||undefined,
        secret:draft.secret||undefined,
      });
      setDraft(null);await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao criar integração.')}
    finally{setBusy(null)}
  }

  async function test(connection:IntegrationConnection){
    setBusy('test:'+connection.id);
    try{await api.testIntegrationV3(connection.id);await load()}
    catch(error){setMessage(error instanceof Error?error.message:'Falha no health check.')}
    finally{setBusy(null)}
  }

  async function toggleBinding(connection:IntegrationConnection){
    if(!project)return;
    setBusy('bind:'+connection.id);
    try{
      if(boundIds.has(connection.id))await api.unbindProjectIntegrationV3(project.id,connection.id);
      else await api.bindProjectIntegrationV3(project.id,connection.id,{});
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:'Falha ao atualizar vínculo do Project.')}
    finally{setBusy(null)}
  }

  async function toggleEnabled(connection:IntegrationConnection){
    setBusy('enable:'+connection.id);
    try{await api.updateIntegrationV3(connection.id,{enabled:!connection.enabled});await load()}
    catch(error){setMessage(error instanceof Error?error.message:'Falha ao atualizar integração.')}
    finally{setBusy(null)}
  }

  return <div className="integrations-page">
    <header className="integrations-header">
      <div>
        <span className="office-kicker">External systems</span>
        <h1>Integrações</h1>
        <p>Conexões externas separadas dos Providers. Tools continuam passando por policies, approval, audit e idempotência.</p>
      </div>
      <div className="integration-project-context">
        <span>Project ativo</span>
        <strong>{project?.name??'Nenhum'}</strong>
      </div>
    </header>

    {message&&<div className="analytics-error">{message}</div>}

    <section className="integration-section">
      <div className="analytics-card-head">
        <div><span className="office-kicker">Connections</span><h2>Conectadas</h2></div>
        <small>{connections.length} conexões</small>
      </div>
      <div className="integration-grid">
        {connections.map(connection=>{
          const cat=catalog.find(x=>x.driver===connection.driver);
          const bound=boundIds.has(connection.id);
          return <article className="integration-card" key={connection.id}>
            <div className="integration-card-head">
              <div className={'integration-logo '+connection.driver}>{connection.name.slice(0,1).toUpperCase()}</div>
              <div className="integration-title">
                <strong>{connection.name}</strong>
                <span>{cat?.name??connection.driver}</span>
              </div>
              <span className={'integration-health '+connection.health_status}>{statusLabel(connection.health_status)}</span>
            </div>
            <p>{cat?.description??'External integration'}</p>
            <div className="integration-meta">
              <span>{connection.capabilities.filter(x=>x.enabled).length} capabilities</span>
              <span>{connection.auth_mode}</span>
              <span>{connection.enabled?'Enabled':'Disabled'}</span>
            </div>
            <div className="integration-capabilities">
              {connection.capabilities.slice(0,6).map(cap=><span key={cap.capability_key}>{cap.capability_key.replace('external.','')}</span>)}
            </div>
            {connection.last_error&&<small className="integration-last-error">{connection.last_error}</small>}
            <div className="integration-actions">
              <button className="btn" disabled={busy!==null} onClick={()=>void test(connection)}>{busy==='test:'+connection.id?'Testando…':'Testar'}</button>
              <button className="btn" disabled={busy!==null} onClick={()=>void toggleEnabled(connection)}>{connection.enabled?'Desativar':'Ativar'}</button>
              {project&&<button className={bound?'btn btn-primary':'btn'} disabled={busy!==null} onClick={()=>void toggleBinding(connection)}>{bound?'Vinculada ao Project':'Vincular ao Project'}</button>}
            </div>
          </article>
        })}
        {!connections.length&&<div className="empty-state">Nenhuma conexão registrada.</div>}
      </div>
    </section>

    <section className="integration-section">
      <div className="analytics-card-head"><div><span className="office-kicker">Catalog</span><h2>Adicionar integração</h2></div></div>
      <div className="integration-catalog-grid">
        {catalog.filter(item=>!item.local).map(item=><article className="integration-catalog-card" key={item.driver}>
          <div><strong>{item.name}</strong><span>{item.description}</span></div>
          <small>{item.capabilities.length} capabilities · {item.auth_modes.join(' / ')}</small>
          <button className="btn" onClick={()=>setDraft({driver:item.driver,name:item.name,auth_mode:item.auth_modes[0]??'none',secret:''})}>Adicionar conexão</button>
        </article>)}
      </div>
    </section>

    {draft&&<div className="integration-modal-backdrop" onClick={()=>setDraft(null)}>
      <div className="integration-modal" onClick={e=>e.stopPropagation()}>
        <span className="office-kicker">New connection</span><h2>{catalog.find(x=>x.driver===draft.driver)?.name}</h2>
        <label>Nome<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
        <label>Autenticação<select value={draft.auth_mode} onChange={e=>setDraft({...draft,auth_mode:e.target.value})}>
          {(catalog.find(x=>x.driver===draft.driver)?.auth_modes??[]).map(mode=><option key={mode} value={mode}>{mode}</option>)}
        </select></label>
        {draft.auth_mode==='token'&&<label>Token<input type="password" autoComplete="off" value={draft.secret} onChange={e=>setDraft({...draft,secret:e.target.value})} placeholder="Salvo criptografado fora do SQLite"/></label>}
        <p className="muted">Credenciais nunca são armazenadas no banco de dados.</p>
        <div className="integration-actions"><button className="btn" onClick={()=>setDraft(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy!==null} onClick={()=>void create()}>{busy==='create'?'Criando…':'Criar conexão'}</button></div>
      </div>
    </div>}
  </div>
}
