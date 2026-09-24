import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import type { Database } from 'better-sqlite3';
import { getAgentOfficeConfig } from './config.js';

const MAX_LOG=256*1024;
interface ActivePreview{child:ChildProcess;projectId:string;sessionId:string;port:number;url:string;stdout:string;stderr:string;exitCode:number|null}
const active=new Map<string,ActivePreview>();
const bounded=(v:string)=>v.length>MAX_LOG?v.slice(-MAX_LOG)+'\n[truncated]':v;
const now=()=>new Date().toISOString();

async function freePort():Promise<number>{
  return await new Promise((resolve,reject)=>{const s=net.createServer();s.unref();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const a=s.address();const p=typeof a==='object'&&a?a.port:0;s.close(()=>p?resolve(p):reject(new Error('PREVIEW_PORT_UNAVAILABLE')))})});
}
function ensureStaticServerScript(){
  const dir=path.join(getAgentOfficeConfig().dataDir,'preview-runtime');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'static-server.cjs');
  if(!fs.existsSync(file))fs.writeFileSync(file,`const http=require('http'),fs=require('fs'),path=require('path');const root=path.resolve(process.argv[2]),port=Number(process.argv[3]);const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2'};http.createServer((req,res)=>{try{const raw=decodeURIComponent((req.url||'/').split('?')[0]);let target=path.resolve(root,'.'+raw);if(!target.startsWith(root)){res.writeHead(403);return res.end('Forbidden')}if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');if(!fs.existsSync(target)){const fallback=path.join(root,'index.html');if(fs.existsSync(fallback)&&!path.extname(raw))target=fallback;else{res.writeHead(404);return res.end('Not found')}}res.setHeader('Content-Type',types[path.extname(target).toLowerCase()]||'application/octet-stream');res.setHeader('Cache-Control','no-store');fs.createReadStream(target).pipe(res)}catch(e){res.writeHead(500);res.end(String(e))}}).listen(port,'127.0.0.1');`);
  return file;
}
function detect(root:string,port:number){
  const pkg=path.join(root,'package.json');
  if(!fs.existsSync(pkg)){
    if(fs.existsSync(path.join(root,'index.html'))){
      const server=ensureStaticServerScript();
      return{command:`node "${server}" "${root}" ${port}`,script:'static'};
    }
    throw new Error('PREVIEW_ENTRYPOINT_REQUIRED');
  }
  let json:any={};try{json=JSON.parse(fs.readFileSync(pkg,'utf8'))}catch{throw new Error('PREVIEW_PACKAGE_JSON_INVALID')}
  const scripts=json.scripts??{};
  if(scripts.dev)return{command:`npm run dev -- --host 127.0.0.1 --port ${port}`,script:'dev'};
  if(scripts.preview)return{command:`npm run preview -- --host 127.0.0.1 --port ${port}`,script:'preview'};
  if(scripts.start)return{command:'npm start',script:'start'};
  if(fs.existsSync(path.join(root,'index.html'))){
    const server=ensureStaticServerScript();
    return{command:`node "${server}" "${root}" ${port}`,script:'static'};
  }
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
    const entry:ActivePreview={child,projectId,sessionId,port,url,stdout:'',stderr:'',exitCode:null};active.set(projectId,entry);
    child.stdout?.on('data',x=>{entry.stdout=bounded(entry.stdout+String(x))});child.stderr?.on('data',x=>{entry.stderr=bounded(entry.stderr+String(x))});
    child.on('exit',(code)=>{entry.exitCode=code??0});
    const healthy=await waitHealth(url,child);
    if(!healthy&&child.exitCode===null){try{if(process.platform==='win32'&&child.pid)execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else child.kill('SIGTERM')}catch{}active.delete(projectId)}
    this.db.prepare('UPDATE preview_sessions SET status=?,updated_at=?,stopped_at=? WHERE id=?').run(healthy?'healthy':'failed',now(),healthy?null:now(),sessionId);
    return this.status(projectId);
  }
  status(projectId:string){
    this.project(projectId);let row=this.db.prepare('SELECT * FROM preview_sessions WHERE project_id=? ORDER BY updated_at DESC LIMIT 1').get(projectId) as any;if(!row)return null;
    const live=active.get(projectId);
    if(live){
      const running=live.exitCode===null&&live.child.exitCode===null&&!live.child.killed;
      const nextStatus=running?row.status:(live.exitCode===0?'stopped':'failed');
      const stoppedAt=running?row.stopped_at:(row.stopped_at??now());
      this.db.prepare('UPDATE preview_sessions SET status=?,stdout=?,stderr=?,updated_at=?,stopped_at=? WHERE id=?').run(nextStatus,live.stdout,live.stderr,now(),stoppedAt,row.id);
      row=this.db.prepare('SELECT * FROM preview_sessions WHERE id=?').get(row.id) as any;
      if(!running)active.delete(projectId);
      return{...row,running};
    }
    if(row.status==='starting'||row.status==='healthy'){const t=now();this.db.prepare("UPDATE preview_sessions SET status='stopped',updated_at=?,stopped_at=COALESCE(stopped_at,?) WHERE id=?").run(t,t,row.id);row=this.db.prepare('SELECT * FROM preview_sessions WHERE id=?').get(row.id) as any}
    return{...row,running:false};
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
  async restart(projectId:string){await this.stop(projectId);return this.start(projectId)}
  reconcileStale(){
    const ids=this.db.prepare("SELECT id FROM preview_sessions WHERE status IN ('starting','healthy')").all() as any[];for(const r of ids)this.db.prepare("UPDATE preview_sessions SET status='stopped',updated_at=?,stopped_at=? WHERE id=?").run(now(),now(),r.id);return ids.length
  }
}
