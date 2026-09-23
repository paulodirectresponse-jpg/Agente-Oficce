import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import type { Database } from 'better-sqlite3';

const MAX_LOG=256*1024;
interface ActivePreview{child:ChildProcess;projectId:string;sessionId:string;port:number;url:string}
const active=new Map<string,ActivePreview>();
const bounded=(v:string)=>v.length>MAX_LOG?v.slice(-MAX_LOG)+'\n[truncated]':v;
const now=()=>new Date().toISOString();

async function freePort():Promise<number>{
  return await new Promise((resolve,reject)=>{const s=net.createServer();s.unref();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const a=s.address();const p=typeof a==='object'&&a?a.port:0;s.close(()=>p?resolve(p):reject(new Error('PREVIEW_PORT_UNAVAILABLE')))})});
}
function detect(root:string,port:number){
  const pkg=path.join(root,'package.json');if(!fs.existsSync(pkg))throw new Error('PREVIEW_PACKAGE_JSON_REQUIRED');
  let json:any={};try{json=JSON.parse(fs.readFileSync(pkg,'utf8'))}catch{throw new Error('PREVIEW_PACKAGE_JSON_INVALID')}
  const scripts=json.scripts??{};
  if(scripts.dev)return{command:`npm run dev -- --host 127.0.0.1 --port ${port}`,script:'dev'};
  if(scripts.preview)return{command:`npm run preview -- --host 127.0.0.1 --port ${port}`,script:'preview'};
  if(scripts.start)return{command:'npm start',script:'start'};
  throw new Error('PREVIEW_SCRIPT_NOT_FOUND');
}
async function waitHealth(url:string,child:ChildProcess){
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)return false;
    try{const r=await fetch(url,{signal:AbortSignal.timeout(1200)});if(r.status<500)return true}catch{}
    await new Promise(r=>setTimeout(r,500));
  }
  return false;
}
export class PreviewService{
  constructor(private db:Database){}
  private project(projectId:string){const p=this.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) as any;if(!p)throw new Error('PROJECT_NOT_FOUND');return p}
  async start(projectId:string,input:{chat_run_id?:string|null;command?:string}={}){
    const project=this.project(projectId);await this.stop(projectId).catch(()=>undefined);
    const port=await freePort(),detected=input.command?.trim()?{command:input.command.trim(),script:'custom'}:detect(project.root_path,port),sessionId=crypto.randomUUID(),url=`http://127.0.0.1:${port}`,t=now();
    const env={...process.env,PORT:String(port),HOST:'127.0.0.1',BROWSER:'none'};
    const child=spawn(detected.command,{cwd:project.root_path,env,shell:true,windowsHide:true,stdio:['ignore','pipe','pipe']});
    this.db.prepare(`INSERT INTO preview_sessions(id,project_id,chat_run_id,process_id,pid,command,port,url,status,stdout,stderr,started_at,updated_at)VALUES(?,?,?,?,?,?,?,?, 'starting','','',?,?)`).run(sessionId,projectId,input.chat_run_id??null,sessionId,child.pid??null,detected.command,port,url,t,t);
    active.set(projectId,{child,projectId,sessionId,port,url});
    const append=(kind:'stdout'|'stderr',chunk:any)=>{const row=this.db.prepare(`SELECT ${kind} value FROM preview_sessions WHERE id=?`).get(sessionId) as any;this.db.prepare(`UPDATE preview_sessions SET ${kind}=?,updated_at=? WHERE id=?`).run(bounded(String(row?.value??'')+String(chunk)),now(),sessionId)};
    child.stdout?.on('data',x=>append('stdout',x));child.stderr?.on('data',x=>append('stderr',x));
    child.on('exit',(code)=>{active.delete(projectId);const row=this.db.prepare('SELECT status FROM preview_sessions WHERE id=?').get(sessionId) as any;if(row?.status==='stopped')return;this.db.prepare("UPDATE preview_sessions SET status=?,updated_at=?,stopped_at=? WHERE id=?").run(code===0?'stopped':'failed',now(),now(),sessionId)});
    const healthy=await waitHealth(url,child);
    this.db.prepare('UPDATE preview_sessions SET status=?,updated_at=? WHERE id=?').run(healthy?'healthy':child.exitCode===null?'failed':'failed',now(),sessionId);
    return this.status(projectId);
  }
  status(projectId:string){
    this.project(projectId);const row=this.db.prepare('SELECT * FROM preview_sessions WHERE project_id=? ORDER BY updated_at DESC LIMIT 1').get(projectId) as any;if(!row)return null;
    const live=active.get(projectId);return{...row,running:Boolean(live&&live.child.exitCode===null&&!live.child.killed)};
  }
  logs(projectId:string){const s=this.status(projectId);return s?{id:s.id,status:s.status,stdout:s.stdout,stderr:s.stderr,command:s.command,url:s.url}:null}
  async stop(projectId:string){
    const live=active.get(projectId),row=this.db.prepare("SELECT * FROM preview_sessions WHERE project_id=? AND status IN ('starting','healthy','failed') ORDER BY updated_at DESC LIMIT 1").get(projectId) as any;
    if(live){
      try{
        if(process.platform==='win32'&&live.child.pid)execFileSync('taskkill',['/PID',String(live.child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
        else live.child.kill('SIGTERM');
      }catch{try{live.child.kill()}catch{}}
      active.delete(projectId);
    }
    if(row)this.db.prepare("UPDATE preview_sessions SET status='stopped',updated_at=?,stopped_at=? WHERE id=?").run(now(),now(),row.id);
    return this.status(projectId);
  }
  async restart(projectId:string){const row=this.status(projectId);const command=row?.command;await this.stop(projectId);return this.start(projectId,{command})}
  reconcileStale(){
    const ids=this.db.prepare("SELECT id FROM preview_sessions WHERE status IN ('starting','healthy')").all() as any[];for(const r of ids)this.db.prepare("UPDATE preview_sessions SET status='stopped',updated_at=?,stopped_at=? WHERE id=?").run(now(),now(),r.id);return ids.length
  }
}
