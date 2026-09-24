import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Database } from 'better-sqlite3';
import { TeamService } from './teamService.js';

const MAX_FILE_BYTES=2*1024*1024;
const IGNORED=new Set(['node_modules','.git','.next','dist','build','.cache','.turbo','coverage']);
function inside(root:string,requested:string){
  const base=path.resolve(root),target=path.resolve(base,requested||'.'),rel=path.relative(base,target);
  if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('WORKSPACE_PATH_OUTSIDE_PROJECT');
  return target;
}
function j<T>(value:string|undefined|null,fallback:T):T{try{return value?JSON.parse(value):fallback}catch{return fallback}}
function git(root:string,args:string[]):string{try{return execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}catch{return''}}
export class WorkspaceService{
  constructor(private db:Database){}
  project(projectId:string){const p=this.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) as any;if(!p)throw new Error('PROJECT_NOT_FOUND');return p}
  snapshot(projectId:string){
    const project=this.project(projectId);
    const activeRun=this.db.prepare("SELECT * FROM chat_runs WHERE project_id=? AND parent_run_id IS NULL AND status IN ('created','running') ORDER BY started_at DESC LIMIT 1").get(projectId) as any;
    const latestRun=activeRun??this.db.prepare('SELECT * FROM chat_runs WHERE project_id=? AND parent_run_id IS NULL ORDER BY started_at DESC LIMIT 1').get(projectId) as any;
    const plan=(latestRun?this.planForRun(latestRun):null)??this.db.prepare("SELECT * FROM execution_plans WHERE project_id=? AND status IN ('validated','running') ORDER BY created_at DESC LIMIT 1").get(projectId) as any;
    const workforce=latestRun?this.db.prepare('SELECT id FROM dynamic_team_instances WHERE chat_run_id=? ORDER BY created_at DESC LIMIT 1').get(latestRun.id) as any:null;
    const approvals=this.db.prepare("SELECT * FROM tool_approvals WHERE project_id=? AND status='pending' ORDER BY created_at").all(projectId) as any[];
    const commands=this.db.prepare("SELECT * FROM workspace_run_commands WHERE project_id=? AND status='pending' ORDER BY created_at").all(projectId) as any[];
    const preview=this.db.prepare("SELECT * FROM preview_sessions WHERE project_id=? ORDER BY updated_at DESC LIMIT 1").get(projectId) as any;
    const usage=latestRun?{input_tokens:latestRun.input_tokens??0,output_tokens:latestRun.output_tokens??0}:null;
    return{project:{...project,git_enabled:Boolean(project.git_enabled)},active_run:activeRun?this.runRow(activeRun):null,latest_run:latestRun?this.runRow(latestRun):null,active_plan:plan?this.plan(plan.id):null,workforce:workforce?new TeamService(this.db).getWorkforce(workforce.id):null,pending_approvals:approvals.map(x=>({...x,input:j(x.input_json,{})})),pending_commands:commands,preview:preview?this.previewRow(preview):null,usage,git:this.gitStatus(projectId)};
  }
  private planForRun(run:any){const md=j<any>(run.metadata_json,{}),oid=md.orchestration_run_id??md.routing_decision?.orchestration_run_id;return oid?this.db.prepare("SELECT * FROM execution_plans WHERE orchestration_run_id=? ORDER BY created_at DESC LIMIT 1").get(oid) as any:null}
  private runRow(r:any){return{...r,error:j(r.error_json,null),metadata:j(r.metadata_json,{})}}
  plan(planId:string){
    const p=this.db.prepare('SELECT * FROM execution_plans WHERE id=?').get(planId) as any;if(!p)return null;
    const steps=(this.db.prepare('SELECT * FROM execution_steps WHERE plan_id=? ORDER BY priority DESC,key').all(planId) as any[]).map(s=>({...s,required_capabilities:j(s.required_capabilities_json,[]),required_tools:j(s.required_tools_json,[]),resource_locks:j(s.resource_locks_json,[])}));
    const deps=this.db.prepare('SELECT * FROM step_dependencies WHERE step_id IN (SELECT id FROM execution_steps WHERE plan_id=?)').all(planId);
    const attempts=this.db.prepare('SELECT * FROM step_attempts WHERE step_id IN (SELECT id FROM execution_steps WHERE plan_id=?) ORDER BY started_at').all(planId).map((a:any)=>({...a,error:j(a.error_json,null),output:j(a.output_json,{})}));
    const replans=this.db.prepare('SELECT * FROM replan_requests WHERE plan_id=? ORDER BY created_at').all(planId);
    return{...p,budget:j(p.budget_json,{}),steps,dependencies:deps,attempts,replans};
  }
  files(projectId:string,relative='.'){
    const p=this.project(projectId),dir=inside(p.root_path,relative);if(!fs.existsSync(dir)||!fs.statSync(dir).isDirectory())throw new Error('WORKSPACE_DIRECTORY_NOT_FOUND');
    return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>!IGNORED.has(e.name)).slice(0,500).map(e=>{const full=path.join(dir,e.name),st=fs.statSync(full);return{name:e.name,path:path.relative(p.root_path,full).replace(/\\/g,'/'),kind:e.isDirectory()?'directory':'file',size:e.isFile()?st.size:null,modified_at:st.mtime.toISOString()}}).sort((a,b)=>a.kind===b.kind?a.name.localeCompare(b.name):a.kind==='directory'?-1:1);
  }
  file(projectId:string,relative:string){
    const p=this.project(projectId),target=inside(p.root_path,relative);if(!fs.existsSync(target)||!fs.statSync(target).isFile())throw new Error('WORKSPACE_FILE_NOT_FOUND');const st=fs.statSync(target);if(st.size>MAX_FILE_BYTES)throw new Error('WORKSPACE_FILE_TOO_LARGE');return{path:path.relative(p.root_path,target).replace(/\\/g,'/'),content:fs.readFileSync(target,'utf8'),size:st.size,modified_at:st.mtime.toISOString()};
  }
  gitStatus(projectId:string){
    const p=this.project(projectId);const branch=git(p.root_path,['branch','--show-current'])||p.git_branch||null,head=git(p.root_path,['rev-parse','HEAD'])||null,porcelain=git(p.root_path,['status','--porcelain=v1']);
    const files=porcelain?porcelain.split(/\r?\n/).filter(Boolean).map(line=>({status:line.slice(0,2).trim()||line.slice(0,2),path:line.slice(3)})):[];
    return{enabled:Boolean(head||p.git_enabled),branch,head,files};
  }
  gitDiff(projectId:string,file?:string){
    const p=this.project(projectId),args=['diff','--no-ext-diff','--no-color'];if(file)args.push('--',file);const diff=git(p.root_path,args);const stat=git(p.root_path,['diff','--numstat']);let additions=0,deletions=0;for(const line of stat.split(/\r?\n/)){const [a,d]=line.split('\t');if(/^\d+$/.test(a))additions+=Number(a);if(/^\d+$/.test(d))deletions+=Number(d)}
    return{diff,additions,deletions};
  }
  captureBaseline(projectId:string,runId:string){
    const s=this.gitStatus(projectId),t=new Date().toISOString();this.db.prepare(`INSERT OR REPLACE INTO workspace_run_baselines(chat_run_id,project_id,git_head,git_branch,git_status,created_at)VALUES(?,?,?,?,?,?)`).run(runId,projectId,s.head,s.branch,JSON.stringify(s.files),t);return{run_id:runId,...s,created_at:t}
  }
  runInspection(runId:string){
    const run=this.db.prepare('SELECT * FROM chat_runs WHERE id=?').get(runId) as any;if(!run)throw new Error('CHAT_RUN_NOT_FOUND');
    const tools=(this.db.prepare("SELECT * FROM tool_audit_events WHERE run_id=? OR run_id IN (SELECT id FROM chat_runs WHERE parent_run_id=?) ORDER BY started_at").all(runId,runId) as any[]).map(x=>({...x,input:j(x.input_json,{}),result:j(x.result_json,null)}));
    const activities=(this.db.prepare("SELECT * FROM activity_events WHERE run_id=? OR run_id IN (SELECT id FROM chat_runs WHERE parent_run_id=?) ORDER BY created_at").all(runId,runId) as any[]).map(x=>({...x,payload:j(x.payload_json,{})}));
    const files=[...new Set(tools.flatMap(x=>{const p=x.input?.path??x.input?.to??x.input?.from;return typeof p==='string'?[p]:[]}))];
    const workforce=this.db.prepare('SELECT id FROM dynamic_team_instances WHERE chat_run_id=? ORDER BY created_at DESC LIMIT 1').get(runId) as any;
    const plan=this.planForRun(run);
    const artifacts=plan?this.db.prepare('SELECT * FROM execution_artifacts WHERE plan_id=? ORDER BY created_at').all(plan.id).map((x:any)=>({...x,payload:j(x.payload_json,{})})):[];
    return{run:this.runRow(run),tools,activities,files_changed:files,workforce:workforce?new TeamService(this.db).getWorkforce(workforce.id):null,plan:plan?this.plan(plan.id):null,artifacts,baseline:this.db.prepare('SELECT * FROM workspace_run_baselines WHERE chat_run_id=?').get(runId)??null};
  }
  listRuns(projectId:string){return (this.db.prepare('SELECT * FROM chat_runs WHERE project_id=? AND parent_run_id IS NULL ORDER BY started_at DESC LIMIT 80').all(projectId) as any[]).map(r=>this.runRow(r))}
  queueCommand(input:{project_id:string;chat_run_id?:string|null;execution_plan_id?:string|null;command_type:'orient'|'enqueue'|'interrupt';message:string;target?:string;attachment_ids?:string[]}){
    const id=crypto.randomUUID(),t=new Date().toISOString(),attachments=[...new Set((input.attachment_ids??[]).filter(Boolean))];
    this.db.prepare(`INSERT INTO workspace_run_commands(id,project_id,chat_run_id,execution_plan_id,command_type,message,target,status,created_at)VALUES(?,?,?,?,?,?,?,'pending',?)`).run(id,input.project_id,input.chat_run_id??null,input.execution_plan_id??null,input.command_type,input.message,input.target??'auto',t);
    if(input.execution_plan_id&&input.command_type!=='interrupt'){
      const type=input.command_type==='orient'?'orient':'enqueue_message';
      this.db.prepare(`INSERT INTO execution_commands(id,plan_id,command_type,payload_json,status,created_at)VALUES(?,?,?,?, 'pending',?)`).run(crypto.randomUUID(),input.execution_plan_id,type,JSON.stringify({message:input.message,workspace_command_id:id,attachment_ids:attachments}),t)
    }
    return {...(this.db.prepare('SELECT * FROM workspace_run_commands WHERE id=?').get(id) as any),attachment_ids:attachments};
  }
  consumeOrientations(runId:string){
    const rows=this.db.prepare("SELECT * FROM workspace_run_commands WHERE chat_run_id=? AND command_type='orient' AND status='pending' ORDER BY created_at").all(runId) as any[];if(!rows.length)return[];
    const t=new Date().toISOString(),ids=rows.map(x=>x.id);const q=ids.map(()=>'?').join(',');this.db.prepare(`UPDATE workspace_run_commands SET status='applied',applied_at=? WHERE id IN (${q})`).run(t,...ids);return rows.map(x=>x.message);
  }
  nextQueued(projectId:string){
    return this.db.prepare("SELECT * FROM workspace_run_commands WHERE project_id=? AND command_type IN ('enqueue','interrupt') AND status='pending' ORDER BY created_at LIMIT 1").get(projectId) as any;
  }
  markCommand(id:string,status:'applied'|'dispatched'|'cancelled'){this.db.prepare('UPDATE workspace_run_commands SET status=?,applied_at=? WHERE id=?').run(status,new Date().toISOString(),id)}
  private previewRow(x:any){return{...x}}
}
