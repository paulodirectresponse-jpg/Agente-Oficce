import { useCallback, useEffect, useState } from 'react';
import type { Project, ProjectDetail, ProjectRootSetting, ProjectSummary } from './types.js';
import { api } from './api.js';
import { V2EmptyState, V2PageHeader, V2Status, V2Tabs } from './shell/V2Primitives.js';
import type { ProjectMenuAction } from './shell/ProjectSwitcher.js';

type Tab='overview'|'work'|'files'|'history'|'settings';
const tabs:Array<{key:Tab;label:string}>=[
  {key:'overview',label:'Visão geral'},{key:'work',label:'Trabalho'},{key:'files',label:'Arquivos'},{key:'history',label:'Histórico'},{key:'settings',label:'Configurações'},
];
function when(value?:string|null){if(!value)return'—';const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString('pt-BR')}
function duration(ms:number){if(!ms)return'0 min';const m=Math.round(ms/60000);return m<60?m+' min':Math.floor(m/60)+'h '+(m%60)+'m'}
function state(value:string){const map:Record<string,string>={active:'Ativo',paused:'Pausado',completed:'Concluído',archived:'Arquivado',running:'Trabalhando',blocked:'Bloqueado',failed:'Falhou',idle:'Ocioso'};return map[value]??value}
function tone(value:string):'neutral'|'success'|'warning'|'danger'{if(['active','running','completed'].includes(value))return'success';if(['blocked','paused'].includes(value))return'warning';if(value==='failed')return'danger';return'neutral'}
export function ProjectsView({activeProject,onSelectProject,onOpenWork,intent}:{activeProject:Project|null;onSelectProject:(p:Project)=>void;onOpenWork:()=>void;intent?:ProjectMenuAction}){
  const [summaries,setSummaries]=useState<ProjectSummary[]>([]);
  const [detail,setDetail]=useState<ProjectDetail|null>(null);
  const [root,setRoot]=useState<ProjectRootSetting|null>(null);
  const [rootDraft,setRootDraft]=useState('');
  const [tab,setTab]=useState<Tab>('overview');
  const [showCreate,setShowCreate]=useState(false);
  const [name,setName]=useState('');
  const [objective,setObjective]=useState('');
  const [resultSummary,setResultSummary]=useState('');
  const [resultText,setResultText]=useState('');
  const [selectedArtifacts,setSelectedArtifacts]=useState<string[]>([]);
  const [decision,setDecision]=useState('');
  const [blocker,setBlocker]=useState('');
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);

  const loadList=useCallback(async()=>{const [s,r]=await Promise.all([api.listProjectSummariesV3(),api.getProjectRootSetting()]);setSummaries(s);setRoot(r);setRootDraft(r.path)},[]);
  const loadDetail=useCallback(async(id:string)=>{const d=await api.getProjectDetailV3(id);setDetail(d);setObjective(d.project.objective??'');setResultSummary(d.result?.summary??'');setResultText(d.result?.result??'');setSelectedArtifacts((d.result?.artifacts??[]).map((x:any)=>String(x.artifact_id)))},[]);
  const refresh=useCallback(async()=>{try{setError(null);await loadList();if(activeProject)await loadDetail(activeProject.id);else setDetail(null)}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar Projects.')}},[activeProject?.id,loadList,loadDetail]);
  useEffect(()=>{void refresh()},[refresh]);
  useEffect(()=>{if(intent==='new')setShowCreate(true);if(intent==='settings'&&activeProject)setTab('settings');if(intent==='all')setShowCreate(false)},[intent,activeProject?.id]);

  const create=async(e:React.FormEvent)=>{e.preventDefault();if(!name.trim())return;setBusy('create');try{const p=await api.createProject({name:name.trim()});setName('');setShowCreate(false);onSelectProject(p);await loadList();await loadDetail(p.id)}catch(e){setError(e instanceof Error?e.message:'Falha ao criar Project.')}finally{setBusy(null)}};
  const patch=async(patch:Partial<Pick<Project,'name'|'objective'|'lifecycle_status'>>)=>{if(!detail)return;setBusy('project');try{const next=await api.updateProjectV3(detail.project.id,patch);onSelectProject(next.project);await refresh()}catch(e){setError(e instanceof Error?e.message:'Falha ao atualizar Project.')}finally{setBusy(null)}};
  const saveRoot=async()=>{if(!rootDraft.trim())return;setBusy('root');try{const r=await api.saveProjectRootSetting(rootDraft.trim());setRoot(r);setRootDraft(r.path)}finally{setBusy(null)}};
  const addDecision=async()=>{if(!detail||!decision.trim())return;setBusy('decision');try{await api.addProjectDecisionV3(detail.project.id,{decision:decision.trim()});setDecision('');await loadDetail(detail.project.id)}finally{setBusy(null)}};
  const addBlocker=async()=>{if(!detail||!blocker.trim())return;setBusy('blocker');try{await api.addProjectBlockerV3(detail.project.id,{title:blocker.trim()});setBlocker('');await loadDetail(detail.project.id)}finally{setBusy(null)}};
  const resolve=async(id:string)=>{if(!detail)return;setBusy(id);try{await api.resolveProjectBlockerV3(detail.project.id,id,'Resolvido pelo usuário.');await loadDetail(detail.project.id)}finally{setBusy(null)}};
  const saveResult=async(finalize:boolean)=>{if(!detail)return;setBusy('result');try{await api.saveProjectResultV3(detail.project.id,{status:finalize?'final':'draft',summary:resultSummary.trim(),result:resultText.trim(),artifact_ids:selectedArtifacts,complete_project:finalize});await refresh()}finally{setBusy(null)}};

  return <div className="projects-v3-page">
    <V2PageHeader title="Projects" subtitle="Contextos persistentes do que você está construindo." actions={<button className="v2-primary-button" onClick={()=>setShowCreate(v=>!v)}>{showCreate?'Fechar':'+ Novo Project'}</button>}/>
    {error&&<div className="v2-notice error" role="alert">{error}</div>}
    {showCreate&&<form className="projects-v3-create" onSubmit={create}><div><strong>Novo Project</strong><p>Dê um nome. O workspace é criado automaticamente na pasta padrão.</p></div><input value={name} onChange={e=>setName(e.target.value)} placeholder="Nome do Project" autoFocus/><button className="v2-primary-button" disabled={busy==='create'||!name.trim()}>Criar</button></form>}

    <div className="projects-v3-layout">
      <aside className="projects-v3-list">{summaries.map(item=><button type="button" key={item.project.id} className={activeProject?.id===item.project.id?'active':''} onClick={()=>onSelectProject(item.project)}>
        <div><strong>{item.project.name}</strong><V2Status tone={tone(item.operational_state)}>{state(item.operational_state)}</V2Status></div><p>{item.project.objective||'Sem objetivo definido.'}</p><small>{item.counts.runs.root} execuções · {item.counts.blockers.open} bloqueios · {when(item.last_activity_at)}</small>
      </button>)}{!summaries.length&&<V2EmptyState title="Nenhum Project" description="Crie o primeiro Project para começar."/>}</aside>

      <section className="projects-v3-detail">
        {!detail&&<V2EmptyState title="Selecione um Project" description="O objetivo, trabalho, arquivos e histórico aparecerão aqui."/>}
        {detail&&<>
          <div className="projects-v3-hero"><div><div><h2>{detail.project.name}</h2><V2Status tone={tone(detail.operational_state)}>{state(detail.operational_state)}</V2Status></div><p>{detail.project.objective||'Defina o resultado que este Project deve alcançar.'}</p></div><button className="v2-primary-button" onClick={onOpenWork}>Abrir Trabalho</button></div>
          <V2Tabs<Tab> items={tabs} value={tab} onChange={setTab} label="Project"/>

          <div className="projects-v3-panel">
            {tab==='overview'&&<>
              <div className="projects-v3-kpis">
                <div><span>Execuções</span><strong>{detail.counts.runs.root}</strong><small>{detail.counts.runs.active} em andamento</small></div>
                <div><span>Bloqueios</span><strong>{detail.counts.blockers.open}</strong><small>abertos</small></div>
                <div><span>Uso</span><strong>{detail.usage.total_tokens.toLocaleString('pt-BR')}</strong><small>tokens</small></div>
                <div><span>Tempo</span><strong>{duration(detail.usage.execution_ms)}</strong><small>executado</small></div>
              </div>
              <section className="projects-v3-objective"><div><h3>Objetivo</h3><p>É a referência persistente para Agents e execuções deste Project.</p></div><textarea rows={5} value={objective} onChange={e=>setObjective(e.target.value)} placeholder="Qual resultado este Project deve atingir?"/><button className="v2-primary-button" disabled={busy==='project'} onClick={()=>void patch({objective:objective.trim()})}>Salvar objetivo</button></section>
              <div className="projects-v3-current"><div><span>Agora</span><strong>{detail.active_run?'Execução em andamento':'Sem execução ativa'}</strong></div><div><span>Preview</span><strong>{detail.workspace.preview?.status??'Inativo'}</strong></div><div><span>Agents envolvidos</span><strong>{detail.participants.agents.length||0}</strong></div><div><span>Resultado</span><strong>{detail.result?.status==='final'?'Finalizado':detail.result?'Rascunho':'Ainda não definido'}</strong></div></div>
              {detail.result&&<section className="projects-v3-result-card"><h3>Resultado mais recente</h3><strong>{detail.result.summary||'Resultado do Project'}</strong><p>{detail.result.result||'Sem descrição.'}</p></section>}
            </>}

            {tab==='work'&&<>
              <div className="projects-v3-work-head"><div><h3>Trabalho deste Project</h3><p>Execuções e planos pertencentes ao mesmo contexto.</p></div><button className="v2-primary-button" onClick={onOpenWork}>Continuar trabalhando</button></div>
              <div className="projects-v3-runs">{detail.runs.map(run=><div key={run.id}><span className={'projects-v3-run-dot '+run.status}/><div><strong>{state(run.status)}</strong><small>{when(run.started_at)} · {run.mode}</small></div><code>{run.id.slice(0,8)}</code></div>)}{!detail.runs.length&&<V2EmptyState title="Nenhuma execução" description="Peça algo em Trabalho para começar."/>}</div>
            </>}

            {tab==='files'&&<>
              <div className="projects-v3-file-summary"><div><span>Branch</span><strong>{detail.workspace.git.branch??'—'}</strong></div><div><span>Alterações atuais</span><strong>{detail.workspace.git.files.length}</strong></div><div><span>Artifacts</span><strong>{detail.artifacts.length}</strong></div></div>
              <section className="projects-v3-files"><h3>Arquivos alterados</h3>{detail.workspace.git.files.map(file=><div key={file.path}><code>{file.status}</code><span>{file.path}</span></div>)}{!detail.workspace.git.files.length&&<p className="v2-help">Working tree limpa.</p>}</section>
              <section className="projects-v3-artifacts"><h3>Resultados e artifacts</h3>{detail.artifacts.map((a:any)=><label key={a.id}><input type="checkbox" checked={selectedArtifacts.includes(a.id)} onChange={e=>setSelectedArtifacts(cur=>e.target.checked?[...cur,a.id]:cur.filter(x=>x!==a.id))}/><span><strong>{a.type}</strong><small>{a.uri||a.id}</small></span></label>)}{!detail.artifacts.length&&<p className="v2-help">Nenhum artifact registrado ainda.</p>}</section>
            </>}

            {tab==='history'&&<>
              <details className="projects-v3-history-group" open><summary>Atividade <span>{detail.timeline.length}</span></summary><div>{detail.timeline.slice(0,60).map((item:any)=><article key={item.source+':'+item.id}><span>{when(item.created_at)}</span><div><strong>{item.title}</strong>{item.detail&&<p>{item.detail}</p>}</div></article>)}</div></details>
              <details className="projects-v3-history-group"><summary>Decisões <span>{detail.decisions.length}</span></summary><div>{detail.decisions.map(item=><article key={item.id}><span>{when(item.created_at)}</span><div><strong>{item.title||'Decisão'}</strong><p>{item.decision}</p></div></article>)}<div className="projects-v3-inline"><input value={decision} onChange={e=>setDecision(e.target.value)} placeholder="Registrar uma decisão"/><button onClick={()=>void addDecision()} disabled={busy==='decision'}>Adicionar</button></div></div></details>
              <details className="projects-v3-history-group"><summary>Bloqueios <span>{detail.blockers.filter(x=>x.status==='open').length}</span></summary><div>{detail.blockers.map(item=><article key={item.id}><span>{item.status==='open'?'Aberto':'Resolvido'}</span><div><strong>{item.title}</strong><p>{item.detail}</p>{item.status==='open'&&<button onClick={()=>void resolve(item.id)} disabled={busy===item.id}>Resolver</button>}</div></article>)}<div className="projects-v3-inline"><input value={blocker} onChange={e=>setBlocker(e.target.value)} placeholder="Registrar um bloqueio"/><button onClick={()=>void addBlocker()} disabled={busy==='blocker'}>Adicionar</button></div></div></details>
              <details className="projects-v3-history-group"><summary>Recursos temporários <span>{detail.workforces.length}</span></summary><div>{detail.workforces.map(w=><article key={w.id}><span>{when(w.created_at)}</span><div><strong>{w.purpose||'Recursos trabalhando juntos'}</strong><p>{w.resources.length} recursos · {state(w.lifecycle_status)}</p></div></article>)}</div></details>
            </>}

            {tab==='settings'&&<>
              <div className="v2-form-grid"><label>Nome<input value={detail.project.name} onChange={()=>{}} readOnly/><small className="v2-help">Renomeação poderá ser adicionada no pente fino; o identificador do Project permanece estável.</small></label><label>Estado<select value={detail.project.lifecycle_status} onChange={e=>void patch({lifecycle_status:e.target.value as Project['lifecycle_status']})}><option value="active">Ativo</option><option value="paused">Pausado</option><option value="completed">Concluído</option><option value="archived">Arquivado</option></select></label></div>
              <section className="projects-v3-settings-section"><h3>Workspace</h3><code>{detail.project.root_path}</code><small>Branch atual: {detail.workspace.git.branch??'—'}</small></section>
              <section className="projects-v3-settings-section"><h3>Resultado final</h3><input value={resultSummary} onChange={e=>setResultSummary(e.target.value)} placeholder="Resumo do resultado"/><textarea rows={7} value={resultText} onChange={e=>setResultText(e.target.value)} placeholder="Resultado final, entregáveis e observações"/><div><button onClick={()=>void saveResult(false)} disabled={busy==='result'}>Salvar rascunho</button><button className="v2-primary-button" onClick={()=>void saveResult(true)} disabled={busy==='result'}>Finalizar Project</button></div></section>
              <details className="v2-disclosure"><summary>Pasta padrão para novos Projects</summary><div className="projects-v3-inline"><input value={rootDraft} onChange={e=>setRootDraft(e.target.value)}/><button onClick={()=>void saveRoot()} disabled={busy==='root'}>Salvar</button></div><p>{root?.configured?'Configurada':'Ainda não configurada'}.</p></details>
            </>}
          </div>
        </>}
      </section>
    </div>
  </div>;
}
