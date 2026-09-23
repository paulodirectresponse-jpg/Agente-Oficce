import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatStreamEnvelope, PreviewSession, Project, WorkspaceFileContent, WorkspaceFileEntry, WorkspaceGitDiff, WorkspaceRunInspection, WorkspaceSnapshot } from '../types.js';
import { api } from '../api.js';

type Tab='live'|'files'|'code'|'changes'|'tests'|'terminal'|'preview'|'artifacts'|'logs';

function parentPath(value:string){const parts=value.split('/').filter(Boolean);parts.pop();return parts.join('/')||'.'}
function outputOf(value:unknown){if(!value||typeof value!=='object')return'';const x=value as Record<string,unknown>;return [typeof x.stdout==='string'?x.stdout:'',typeof x.stderr==='string'?x.stderr:''].filter(Boolean).join('\n')}
function eventLabel(e:ChatStreamEnvelope){const d=e.data;return String(d.message??d.title??d.activity??d.tool_name??e.event)}

export function Workbench({project,snapshot,runId,liveEvents,contextual=false}:{project:Project;snapshot:WorkspaceSnapshot|null;runId:string|null;liveEvents:ChatStreamEnvelope[];contextual?:boolean}){
  const [tab,setTab]=useState<Tab>('live');
  const [inspection,setInspection]=useState<WorkspaceRunInspection|null>(null);
  const [dir,setDir]=useState('.');
  const [entries,setEntries]=useState<WorkspaceFileEntry[]>([]);
  const [file,setFile]=useState<WorkspaceFileContent|null>(null);
  const [diff,setDiff]=useState<WorkspaceGitDiff|null>(null);
  const [preview,setPreview]=useState<PreviewSession|null>(snapshot?.preview??null);
  const [previewLogs,setPreviewLogs]=useState<{stdout?:string;stderr?:string;command?:string;url?:string|null}|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    try{
      const tasks:Promise<unknown>[]=[
        api.getWorkspaceGitDiffV3(project.id).then(setDiff),
        api.getPreviewV3(project.id).then(setPreview),
      ];
      if(runId)tasks.push(api.getWorkspaceRunV3(runId).then(setInspection));
      await Promise.all(tasks);setError(null);
    }catch(e){setError(e instanceof Error?e.message:'Falha ao atualizar Workbench.')}
  },[project.id,runId]);

  useEffect(()=>{setDir('.');setFile(null);setInspection(null);void refresh();const timer=window.setInterval(()=>void refresh(),3000);return()=>window.clearInterval(timer)},[refresh]);
  useEffect(()=>{void api.listWorkspaceFilesV3(project.id,dir).then(setEntries).catch(e=>setError(e instanceof Error?e.message:'Falha ao listar arquivos.'))},[project.id,dir]);
  useEffect(()=>{if(tab==='preview')void api.getPreviewLogsV3(project.id).then(setPreviewLogs).catch(()=>undefined)},[tab,project.id,preview?.updated_at]);

  const tests=useMemo(()=>(inspection?.tools??[]).filter(x=>/test|build/i.test(x.tool_name)),[inspection]);
  const terminal=useMemo(()=>(inspection?.tools??[]).filter(x=>/shell|command|npm|node|git|deploy|process/i.test(x.tool_name)),[inspection]);
  const logs=useMemo(()=>{
    const persisted=(inspection?.activities??[]).map(x=>({at:x.created_at,type:x.type,text:x.detail||x.title}));
    const live=liveEvents.map(x=>({at:x.timestamp,type:x.event,text:eventLabel(x)}));
    return [...live,...persisted].sort((a,b)=>new Date(b.at).getTime()-new Date(a.at).getTime()).slice(0,160);
  },[inspection,liveEvents]);

  const openFile=async(path:string)=>{setError(null);try{const next=await api.readWorkspaceFileV3(project.id,path);setFile(next);setTab('code')}catch(e){setError(e instanceof Error?e.message:'Falha ao abrir arquivo.')}};
  const startPreview=async()=>{setBusy(true);setError(null);try{setPreview(await api.startPreviewV3(project.id,{chat_run_id:runId??undefined}));setTab('preview')}catch(e){setError(e instanceof Error?e.message:'Falha ao iniciar preview.')}finally{setBusy(false)}};
  const stopPreview=async()=>{setBusy(true);try{setPreview(await api.stopPreviewV3(project.id))}finally{setBusy(false)}};
  const restartPreview=async()=>{setBusy(true);try{setPreview(await api.restartPreviewV3(project.id))}catch(e){setError(e instanceof Error?e.message:'Falha ao reiniciar preview.')}finally{setBusy(false)}};

  const allTabs: Array<[Tab,string]>=[['live','Live'],['files','Files'],['code','Code'],['changes','Changes'],['tests','Tests'],['terminal','Terminal'],['preview','Preview'],['artifacts','Artifacts'],['logs','Logs']];
  const tabs=useMemo(()=>contextual?allTabs.filter(([key])=>{
    if(key==='live')return Boolean(snapshot?.active_run||liveEvents.length||inspection);
    if(key==='files')return Boolean(entries.length||snapshot?.git.files.length);
    if(key==='code')return Boolean(file);
    if(key==='changes')return Boolean((snapshot?.git.files.length??0)>0||(diff?.diff&&diff.diff.trim()));
    if(key==='tests')return tests.length>0;
    if(key==='terminal')return terminal.length>0;
    if(key==='preview')return Boolean(preview);
    if(key==='artifacts')return Boolean(inspection?.artifacts?.length);
    if(key==='logs')return logs.length>0;
    return false;
  }):allTabs,[contextual,snapshot?.active_run,snapshot?.git.files.length,liveEvents.length,inspection,entries.length,file,diff?.diff,tests.length,terminal.length,preview,logs.length]);
  useEffect(()=>{if(contextual&&tabs.length&&!tabs.some(([key])=>key===tab))setTab(tabs[0][0])},[contextual,tabs.map(([key])=>key).join(','),tab]);
  return <aside className={'dev-workbench '+(contextual?'contextual':'')}>
    <div className="dev-workbench-tabs">{tabs.length?tabs.map(([key,label])=><button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}):<span className="wb-tabs-empty">Detalhes aparecerão quando houver algo para inspecionar.</span>}</div>
    <div className="dev-workbench-body">
      {tab==='live'&&<div className="wb-live">
        <div className="wb-section-title"><strong>Execução atual</strong><span>{snapshot?.active_run?.status??'idle'}</span></div>
        {snapshot?.active_plan?.steps?.length?<div className="wb-step-list">{snapshot.active_plan.steps.map(s=><div key={s.id} className={'wb-step '+s.status}><span>{s.status==='completed'?'✓':s.status==='running'?'●':'○'}</span><div><strong>{s.title||s.key}</strong><small>{s.resume_state}</small></div></div>)}</div>:<div className="wb-empty">Nenhum Execution Plan ativo.</div>}
        <div className="wb-live-events">{liveEvents.slice(0,12).map(e=><div key={e.sequence}><span>{new Date(e.timestamp).toLocaleTimeString('pt-BR')}</span><strong>{e.event}</strong><small>{eventLabel(e)}</small></div>)}</div>
      </div>}

      {tab==='files'&&<div className="wb-files">
        <div className="wb-file-toolbar"><button disabled={dir==='.'} onClick={()=>setDir(parentPath(dir))}>←</button><span className="mono">{dir}</span><button onClick={()=>api.listWorkspaceFilesV3(project.id,dir).then(setEntries)}>↻</button></div>
        <div className="wb-file-list">{entries.map(e=><button key={e.path} onClick={()=>e.kind==='directory'?setDir(e.path):void openFile(e.path)}><span>{e.kind==='directory'?'▸':'·'}</span><strong>{e.name}</strong>{e.kind==='file'&&<small>{e.size!=null?Math.max(1,Math.round(e.size/1024))+' KB':''}</small>}</button>)}{!entries.length&&<div className="wb-empty">Pasta vazia.</div>}</div>
      </div>}

      {tab==='code'&&<div className="wb-code">{file?<><div className="wb-code-head"><strong>{file.path}</strong><span>{Math.max(1,Math.round(file.size/1024))} KB</span></div><pre><code>{file.content}</code></pre></>:<div className="wb-empty">Abra um arquivo em Files.</div>}</div>}

      {tab==='changes'&&<div className="wb-changes">
        <div className="wb-change-summary"><strong>+{diff?.additions??0}</strong><strong>-{diff?.deletions??0}</strong><span>{snapshot?.git.files.length??0} arquivos</span></div>
        <div className="wb-git-files">{snapshot?.git.files.map(x=><button key={x.path} onClick={async()=>{setDiff(await api.getWorkspaceGitDiffV3(project.id,x.path))}}><span>{x.status}</span><strong>{x.path}</strong></button>)}</div>
        <pre className="wb-diff">{diff?.diff||'Sem diff no working tree.'}</pre>
      </div>}

      {tab==='tests'&&<div className="wb-output-list">{tests.length?tests.map(t=><div key={t.id}><div><strong>{t.tool_name}</strong><span className={'wb-status '+t.status}>{t.status}</span></div><pre>{outputOf(t.result)||JSON.stringify(t.result??{},null,2)}</pre></div>):<div className="wb-empty">Nenhum teste/build registrado neste run.</div>}</div>}

      {tab==='terminal'&&<div className="wb-output-list">{terminal.length?terminal.map(t=><div key={t.id}><div><strong>{t.tool_name}</strong><span>{new Date(t.started_at).toLocaleTimeString('pt-BR')}</span></div><pre>{outputOf(t.result)||JSON.stringify(t.result??{},null,2)}</pre></div>):<div className="wb-empty">Nenhum comando registrado neste run.</div>}</div>}

      {tab==='preview'&&<div className="wb-preview">
        <div className="wb-preview-toolbar"><span className={'preview-dot '+(preview?.status??'stopped')}/><strong>{preview?.status??'stopped'}</strong><span>{preview?.url??'Preview não iniciado'}</span><div/><button disabled={busy} onClick={()=>void startPreview()}>Start</button><button disabled={busy||!preview} onClick={()=>void restartPreview()}>Restart</button><button disabled={busy||!preview} onClick={()=>void stopPreview()}>Stop</button>{preview?.url&&<button onClick={()=>window.open(preview.url!,'_blank')}>↗</button>}</div>
        {preview?.url&&preview.status==='healthy'?<iframe className="wb-preview-frame" src={preview.url} title="Project preview"/>:<div className="wb-preview-placeholder"><strong>{preview?.status==='failed'?'Preview falhou':'Preview local'}</strong><span>{preview?.command??'O comando será detectado pelo package.json.'}</span></div>}
        <pre className="wb-preview-logs">{[previewLogs?.stdout,previewLogs?.stderr].filter(Boolean).join('\n')||'Sem logs de preview.'}</pre>
      </div>}

      {tab==='artifacts'&&<div className="wb-artifacts">{inspection?.artifacts?.length?inspection.artifacts.map(a=><div key={a.id}><span>{a.type}</span><div><strong>{a.uri||a.type}</strong><small>{new Date(a.created_at).toLocaleString('pt-BR')}</small></div></div>):<div className="wb-empty">Nenhum artifact neste run.</div>}</div>}

      {tab==='logs'&&<div className="wb-logs">{logs.length?logs.map((l,i)=><div key={l.at+i}><span>{new Date(l.at).toLocaleTimeString('pt-BR')}</span><strong>{l.type}</strong><p>{l.text}</p></div>):<div className="wb-empty">Sem logs.</div>}</div>}
      {error&&<div className="wb-error">{error}</div>}
    </div>
  </aside>;
}
