import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, ProjectDetail, ProjectRootSetting, ProjectSummary } from './types.js';
import { api } from './api.js';

interface WorkspaceViewProps {
  activeProject: Project | null;
  onSelectProject: (project: Project) => void;
}

type Tab = 'overview'|'execution'|'files'|'artifacts'|'activity'|'decisions'|'blockers'|'result';

function previewProjectPath(root: string, name: string): string {
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const cleanName = name.trim().replace(/[<>:"/\\|?*]/g, '-');
  return cleanRoot && cleanName ? `${cleanRoot}\\${cleanName}` : cleanRoot;
}
function when(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('pt-BR');
}
function compactNumber(value: number) { return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value); }
function duration(ms: number) {
  if (!ms) return '0 min';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `${hours}h ${rest}m`;
}
function stateLabel(value: string) {
  const map: Record<string,string> = { active:'Ativo', paused:'Pausado', completed:'Concluído', archived:'Arquivado', running:'Executando', waiting_approval:'Aguardando aprovação', blocked:'Bloqueado', failed:'Falhou', idle:'Ocioso' };
  return map[value] ?? value;
}
function statusClass(value: string) {
  if (['running','active'].includes(value)) return 'ok';
  if (['blocked','failed'].includes(value)) return 'danger';
  if (['waiting_approval','paused'].includes(value)) return 'warning';
  return 'neutral';
}

export function WorkspaceView({ activeProject, onSelectProject }: WorkspaceViewProps) {
  const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [rootSetting, setRootSetting] = useState<ProjectRootSetting | null>(null);
  const [rootDraft, setRootDraft] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [objective, setObjective] = useState('');
  const [decisionTitle, setDecisionTitle] = useState('');
  const [decision, setDecision] = useState('');
  const [blockerTitle, setBlockerTitle] = useState('');
  const [blockerDetail, setBlockerDetail] = useState('');
  const [resultSummary, setResultSummary] = useState('');
  const [resultText, setResultText] = useState('');
  const [selectedArtifacts, setSelectedArtifacts] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const [next, root] = await Promise.all([api.listProjectSummariesV3(), api.getProjectRootSetting()]);
    setSummaries(next);
    setRootSetting(root);
    setRootDraft(root.path);
  }, []);

  const loadDetail = useCallback(async (projectId: string) => {
    const next = await api.getProjectDetailV3(projectId);
    setDetail(next);
    setObjective(next.project.objective ?? '');
    setResultSummary(next.result?.summary ?? '');
    setResultText(next.result?.result ?? '');
    setSelectedArtifacts((next.result?.artifacts ?? []).map((x: any) => String(x.artifact_id)));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      await loadList();
      if (activeProject) await loadDetail(activeProject.id);
      else setDetail(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar Projects.');
    }
  }, [activeProject?.id, loadList, loadDetail]);

  useEffect(() => { void refresh(); }, [refresh]);

  const pathPreview = useMemo(() => previewProjectPath(rootSetting?.path ?? rootDraft, name), [rootSetting?.path, rootDraft, name]);

  async function saveRoot() {
    if (!rootDraft.trim()) return;
    setBusy('root');
    try {
      const next = await api.saveProjectRootSetting(rootDraft.trim());
      setRootSetting(next); setRootDraft(next.path);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao salvar pasta raiz.'); }
    finally { setBusy(null); }
  }

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const project = await api.createProject({ name: name.trim() });
      setName(''); setShowCreate(false); onSelectProject(project); await loadList(); await loadDetail(project.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao criar projeto.'); }
    finally { setCreating(false); }
  }

  async function patchProject(patch: Partial<Pick<Project,'name'|'objective'|'lifecycle_status'>>) {
    if (!detail) return;
    setBusy('project');
    try {
      const summary = await api.updateProjectV3(detail.project.id, patch);
      onSelectProject(summary.project);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao atualizar Project.'); }
    finally { setBusy(null); }
  }

  async function addDecision(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || !decision.trim()) return;
    setBusy('decision');
    try {
      await api.addProjectDecisionV3(detail.project.id, { title: decisionTitle.trim(), decision: decision.trim() });
      setDecisionTitle(''); setDecision(''); await loadDetail(detail.project.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao registrar decisão.'); }
    finally { setBusy(null); }
  }

  async function addBlocker(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || !blockerTitle.trim()) return;
    setBusy('blocker');
    try {
      await api.addProjectBlockerV3(detail.project.id, { title: blockerTitle.trim(), detail: blockerDetail.trim() });
      setBlockerTitle(''); setBlockerDetail(''); await loadDetail(detail.project.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao registrar blocker.'); }
    finally { setBusy(null); }
  }

  async function resolveBlocker(id: string) {
    if (!detail) return;
    setBusy('resolve-'+id);
    try { await api.resolveProjectBlockerV3(detail.project.id, id, 'Resolvido pelo usuário.'); await loadDetail(detail.project.id); }
    finally { setBusy(null); }
  }

  async function saveResult(finalize: boolean) {
    if (!detail) return;
    setBusy('result');
    try {
      await api.saveProjectResultV3(detail.project.id, {
        status: finalize ? 'final' : 'draft',
        summary: resultSummary.trim(),
        result: resultText.trim(),
        artifact_ids: selectedArtifacts,
        complete_project: finalize,
      });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao salvar resultado.'); }
    finally { setBusy(null); }
  }

  const tabs: Array<{key:Tab;label:string}> = [
    {key:'overview',label:'Overview'}, {key:'execution',label:'Execução'}, {key:'files',label:'Files / Git'},
    {key:'artifacts',label:'Artifacts'}, {key:'activity',label:'Activity'}, {key:'decisions',label:'Decisions'},
    {key:'blockers',label:'Blockers'}, {key:'result',label:'Resultado'},
  ];

  return <div className="projects-v2">
    <div className="projects-v2-header">
      <div><h2 className="app-view-title">Projects</h2><p className="app-view-subtitle">Contexto persistente de cada objetivo, da primeira instrução ao resultado final.</p></div>
      <button className="btn btn-primary" onClick={() => setShowCreate(v => !v)}>{showCreate ? 'Fechar' : '+ Novo Project'}</button>
    </div>

    {error && <div className="projects-error">{error}</div>}

    {showCreate && <div className="project-create-grid">
      <div className="panel">
        <h3>Pasta raiz</h3>
        <div className="project-root-row"><input value={rootDraft} onChange={e=>setRootDraft(e.target.value)} /><button className="btn" onClick={saveRoot} disabled={busy==='root'}>Salvar</button></div>
        <p className="muted">A pasta é configurada uma vez e cada Project recebe seu próprio workspace.</p>
      </div>
      <form className="panel" onSubmit={createProject}>
        <h3>Criar Project</h3>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Nome do projeto" required />
        <div className="project-path-preview"><span>Workspace</span><strong className="mono">{pathPreview || 'Configure a pasta raiz'}</strong></div>
        <button className="btn btn-primary" disabled={creating || !rootSetting?.configured}>{creating ? 'Criando…' : 'Criar'}</button>
      </form>
    </div>}

    <div className="projects-layout">
      <aside className="project-list-panel">
        <div className="project-list-heading"><strong>Projects</strong><span>{summaries.length}</span></div>
        {summaries.map(item => <button key={item.project.id} className={'project-list-card '+(activeProject?.id===item.project.id?'selected':'')} onClick={()=>onSelectProject(item.project)}>
          <div className="project-list-card-top"><strong>{item.project.name}</strong><span className={'project-state '+statusClass(item.operational_state)}>{stateLabel(item.operational_state)}</span></div>
          <p>{item.project.objective || 'Objetivo ainda não definido.'}</p>
          <div className="project-list-meta"><span>{item.counts.runs.root} runs</span><span>{item.counts.blockers.open} blockers</span><span>{item.counts.artifacts} artifacts</span></div>
          <small>{when(item.last_activity_at)}</small>
        </button>)}
        {!summaries.length && <div className="empty-state">Nenhum Project criado.</div>}
      </aside>

      <section className="project-detail-panel">
        {!detail && <div className="project-empty-detail"><strong>Selecione um Project</strong><p>O histórico operacional completo aparecerá aqui.</p></div>}
        {detail && <>
          <div className="project-hero">
            <div>
              <div className="project-hero-title"><h2>{detail.project.name}</h2><span className={'project-state '+statusClass(detail.operational_state)}>{stateLabel(detail.operational_state)}</span></div>
              <p>{detail.project.objective || 'Defina o objetivo canônico deste Project.'}</p>
              <div className="project-hero-meta"><span className="mono">{detail.project.root_path}</span><span>branch: {detail.workspace.git.branch ?? '—'}</span><span>atividade: {when(detail.last_activity_at)}</span></div>
            </div>
            <select value={detail.project.lifecycle_status} onChange={e=>void patchProject({lifecycle_status:e.target.value as Project['lifecycle_status']})} disabled={busy==='project'}>
              <option value="active">Ativo</option><option value="paused">Pausado</option><option value="completed">Concluído</option><option value="archived">Arquivado</option>
            </select>
          </div>

          <div className="project-tabs">{tabs.map(item=><button key={item.key} className={tab===item.key?'active':''} onClick={()=>setTab(item.key)}>{item.label}</button>)}</div>

          {tab==='overview' && <div className="project-tab-content">
            <div className="project-kpi-grid">
              <div><span>Runs</span><strong>{detail.counts.runs.root}</strong><small>{detail.counts.runs.active} ativos</small></div>
              <div><span>Plans</span><strong>{detail.counts.plans.total}</strong><small>{detail.counts.plans.completed} concluídos</small></div>
              <div><span>Steps</span><strong>{detail.counts.steps.completed}/{detail.counts.steps.total}</strong><small>sem porcentagem inventada</small></div>
              <div><span>Blockers</span><strong>{detail.counts.blockers.open}</strong><small>abertos</small></div>
              <div><span>Tokens</span><strong>{compactNumber(detail.usage.total_tokens)}</strong><small>{compactNumber(detail.usage.input_tokens)} in · {compactNumber(detail.usage.output_tokens)} out</small></div>
              <div><span>Tempo executado</span><strong>{duration(detail.usage.execution_ms)}</strong><small>{detail.usage.cost_usd == null ? 'custo não totalmente disponível' : '$'+detail.usage.cost_usd.toFixed(4)}</small></div>
            </div>
            <div className="project-section-grid">
              <div className="panel">
                <h3>Objetivo</h3>
                <textarea rows={5} value={objective} onChange={e=>setObjective(e.target.value)} placeholder="Qual resultado este Project deve atingir?" />
                <button className="btn btn-primary" onClick={()=>void patchProject({objective:objective.trim()})} disabled={busy==='project'}>Salvar objetivo</button>
              </div>
              <div className="panel">
                <h3>Estado operacional</h3>
                <div className="project-fact-list">
                  <div><span>Run ativo</span><strong>{(detail.active_run as any)?.id ? String((detail.active_run as any).id).slice(0,8) : 'Nenhum'}</strong></div>
                  <div><span>Plan ativo</span><strong>{(detail.active_plan as any)?.goal ?? 'Nenhum'}</strong></div>
                  <div><span>Workforce atual</span><strong>{detail.workspace.workforce?.purpose || 'Nenhuma'}</strong></div>
                  <div><span>Aprovações</span><strong>{detail.workspace.pending_approvals.length}</strong></div>
                  <div><span>Preview</span><strong>{detail.workspace.preview?.status ?? 'inativo'}</strong></div>
                </div>
              </div>
            </div>
            <div className="panel"><h3>Participantes históricos</h3><div className="participant-groups"><span>Agents: {detail.participants.agents.map((x:any)=>x.name).join(', ') || '—'}</span><span>Subagents: {detail.participants.subagents.map((x:any)=>x.name).join(', ') || '—'}</span><span>Teams: {detail.participants.teams.map((x:any)=>x.name).join(', ') || '—'}</span></div></div>
          </div>}

          {tab==='execution' && <div className="project-tab-content">
            <div className="panel"><h3>Execution Plans</h3>{detail.plans.map((plan:any)=><div className="project-execution-row" key={plan.id}><div><strong>{plan.goal}</strong><small>v{plan.version} · {plan.status} · {when(plan.updated_at)}</small></div><div className="project-step-facts"><span>{plan.progress.completed} completed</span><span>{plan.progress.running} running</span><span>{plan.progress.blocked} blocked</span><span>{plan.progress.queued} queued</span></div></div>)}{!detail.plans.length&&<p className="muted">Nenhum Execution Plan neste Project.</p>}</div>
            <div className="panel"><h3>Runs</h3>{detail.runs.map(run=><div className="project-execution-row" key={run.id}><div><strong>{run.mode} · {run.status}</strong><small className="mono">{run.id}</small></div><span>{when(run.started_at)}</span></div>)}</div>
            <div className="panel"><h3>Workforces</h3>{detail.workforces.map(w=><div className="project-execution-row" key={w.id}><div><strong>{w.purpose || 'Workforce'}</strong><small>{w.lifecycle_status} · {w.resources.length} recursos</small></div><span>{when(w.created_at)}</span></div>)}{!detail.workforces.length&&<p className="muted">Nenhuma Workforce usada ainda.</p>}</div>
          </div>}

          {tab==='files' && <div className="project-tab-content">
            <div className="project-kpi-grid compact"><div><span>Git</span><strong>{detail.workspace.git.enabled?'Ativo':'Não'}</strong><small>{detail.workspace.git.branch ?? '—'}</small></div><div><span>HEAD</span><strong className="mono tiny">{detail.workspace.git.head?.slice(0,10) ?? '—'}</strong><small>baseline por Run preservado</small></div><div><span>Alterações atuais</span><strong>{detail.workspace.git.files.length}</strong><small>working tree</small></div></div>
            <div className="panel"><h3>Working tree atual</h3>{detail.workspace.git.files.map(file=><div className="project-file-row" key={file.path}><span className="mono">{file.status}</span><span className="mono">{file.path}</span></div>)}{!detail.workspace.git.files.length&&<p className="muted">Working tree limpa.</p>}<p className="muted">Para editar, comparar diff, rodar testes e terminal, use o Chat Workspace. Projects apenas referencia a mesma verdade.</p></div>
          </div>}

          {tab==='artifacts' && <div className="project-tab-content"><div className="panel"><h3>Artifacts</h3>{detail.artifacts.map((a:any)=><label className="project-artifact-row" key={a.id}><input type="checkbox" checked={selectedArtifacts.includes(a.id)} onChange={e=>setSelectedArtifacts(cur=>e.target.checked?[...cur,a.id]:cur.filter(x=>x!==a.id))}/><div><strong>{a.type}</strong><small>{a.uri || a.id} · {when(a.created_at)}</small></div></label>)}{!detail.artifacts.length&&<p className="muted">Nenhum artifact registrado.</p>}<p className="muted">A seleção acima define quais artifacts entram no resultado final, sem duplicá-los.</p></div></div>}

          {tab==='activity' && <div className="project-tab-content"><div className="panel"><h3>Timeline</h3>{detail.timeline.map((item:any)=><div className="project-timeline-row" key={item.source+':'+item.id}><span className={'timeline-dot '+statusClass(item.severity==='error'?'failed':item.severity==='warning'?'blocked':'idle')}/><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.source} · {item.type} · {when(item.created_at)}</small></div></div>)}</div></div>}

          {tab==='decisions' && <div className="project-tab-content">
            <form className="panel project-inline-form" onSubmit={addDecision}><h3>Registrar decisão</h3><input value={decisionTitle} onChange={e=>setDecisionTitle(e.target.value)} placeholder="Título opcional"/><textarea rows={3} value={decision} onChange={e=>setDecision(e.target.value)} placeholder="Decisão tomada" required/><button className="btn btn-primary" disabled={busy==='decision'}>Registrar</button></form>
            <div className="panel">{detail.decisions.map(item=><div className="project-record-row" key={item.id}><strong>{item.title || 'Decisão'}</strong><p>{item.decision}</p>{item.rationale&&<small>{item.rationale}</small>}<small>{when(item.created_at)}</small></div>)}{!detail.decisions.length&&<p className="muted">Nenhuma decisão registrada.</p>}</div>
          </div>}

          {tab==='blockers' && <div className="project-tab-content">
            <form className="panel project-inline-form" onSubmit={addBlocker}><h3>Novo blocker</h3><input value={blockerTitle} onChange={e=>setBlockerTitle(e.target.value)} placeholder="O que está impedindo o avanço?" required/><textarea rows={3} value={blockerDetail} onChange={e=>setBlockerDetail(e.target.value)} placeholder="Detalhes"/><button className="btn btn-primary" disabled={busy==='blocker'}>Registrar blocker</button></form>
            <div className="panel">{detail.blockers.map(item=><div className="project-record-row blocker" key={item.id}><div className="project-record-head"><strong>{item.title}</strong><span className={'project-state '+(item.status==='open'?'warning':'neutral')}>{item.status}</span></div><p>{item.detail}</p><small>aberto {when(item.opened_at)}{item.resolved_at?' · resolvido '+when(item.resolved_at):''}</small>{item.status==='open'&&<button className="btn" onClick={()=>void resolveBlocker(item.id)} disabled={busy==='resolve-'+item.id}>Resolver</button>}</div>)}</div>
          </div>}

          {tab==='result' && <div className="project-tab-content"><div className="panel project-result-editor"><h3>Resultado final</h3><input value={resultSummary} onChange={e=>setResultSummary(e.target.value)} placeholder="Resumo executivo do resultado"/><textarea rows={9} value={resultText} onChange={e=>setResultText(e.target.value)} placeholder="Resultado final, entregáveis, observações e próximos passos"/><p className="muted">{selectedArtifacts.length} artifact(s) selecionados como outputs finais.</p><div className="project-result-actions"><button className="btn" onClick={()=>void saveResult(false)} disabled={busy==='result'}>Salvar rascunho</button><button className="btn btn-primary" onClick={()=>void saveResult(true)} disabled={busy==='result'}>Finalizar Project</button></div>{detail.result?.status==='final'&&<div className="project-final-badge">Resultado final registrado em {when(detail.result.completed_at)}</div>}</div></div>}
        </>}
      </section>
    </div>
  </div>;
}
