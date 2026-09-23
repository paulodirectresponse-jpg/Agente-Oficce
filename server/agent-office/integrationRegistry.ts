
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Database } from 'better-sqlite3';
import { DevelopmentSecretStore, type SecretStore } from './secretStore.js';
import { getAgentOfficeConfig } from './config.js';
import { executeFullAccessTool } from './fullAccessTools.js';
import { redactSecrets } from './securitySanitizer.js';

const execFileAsync=promisify(execFile);
const now=()=>new Date().toISOString();
const json=<T>(value:string|null|undefined,fallback:T):T=>{try{return value?JSON.parse(value) as T:fallback}catch{return fallback}};

export type IntegrationHealth='unknown'|'healthy'|'degraded'|'auth_error'|'unavailable'|'misconfigured';
export type IntegrationRisk='read'|'write'|'execute'|'external'|'destructive';

export interface IntegrationCatalogEntry{
  driver:string;name:string;description:string;auth_modes:string[];local:boolean;
  capabilities:Array<{key:string;tool_name:string;risk:IntegrationRisk;description:string}>;
}
export interface IntegrationConnection{
  id:string;driver:string;name:string;enabled:boolean;auth_mode:string;secret_ref:string|null;
  health_status:IntegrationHealth;last_health_at:string|null;last_error:string|null;
  config:Record<string,unknown>;metadata:Record<string,unknown>;created_at:string;updated_at:string;
  capabilities:Array<{capability_key:string;tool_name:string;risk:IntegrationRisk;enabled:boolean;metadata:Record<string,unknown>}>;
}
export interface IntegrationProjectBinding{
  project_id:string;integration_id:string;scope:Record<string,unknown>;metadata:Record<string,unknown>;created_at:string;updated_at:string;
}

export const INTEGRATION_CATALOG:IntegrationCatalogEntry[]=[
  {driver:'github',name:'GitHub',description:'Repositories, issues and pull requests via GitHub CLI.',auth_modes:['cli','token'],local:false,capabilities:[
    {key:'external.github.identity.read',tool_name:'github_user_get',risk:'read',description:'Read authenticated GitHub identity.'},
    {key:'external.github.repositories.read',tool_name:'github_repo_list',risk:'read',description:'List repositories.'},
    {key:'external.github.issues.write',tool_name:'github_issue_create',risk:'external',description:'Create an issue.'},
    {key:'external.github.pull_requests.write',tool_name:'github_pr_create',risk:'external',description:'Create a pull request.'},
    {key:'external.github.pull_requests.merge',tool_name:'github_pr_merge',risk:'destructive',description:'Merge a pull request.'},
  ]},
  {driver:'railway',name:'Railway',description:'Projects, logs and deployments through Railway CLI.',auth_modes:['cli','token'],local:false,capabilities:[
    {key:'external.railway.projects.read',tool_name:'railway_project_list',risk:'read',description:'List Railway projects.'},
    {key:'external.railway.logs.read',tool_name:'railway_logs_read',risk:'read',description:'Read service logs.'},
    {key:'external.railway.deploy',tool_name:'railway_deploy',risk:'destructive',description:'Deploy the active project.'},
  ]},
  {driver:'supabase',name:'Supabase',description:'Project discovery and Edge Functions through Supabase CLI.',auth_modes:['token','cli'],local:false,capabilities:[
    {key:'external.supabase.projects.read',tool_name:'supabase_project_list',risk:'read',description:'List Supabase projects.'},
    {key:'external.supabase.functions.read',tool_name:'supabase_functions_list',risk:'read',description:'List Edge Functions.'},
    {key:'external.supabase.functions.deploy',tool_name:'supabase_function_deploy',risk:'destructive',description:'Deploy an Edge Function.'},
  ]},
  {driver:'browser',name:'Browser',description:'Managed Edge/CDP using existing local Browser tools.',auth_modes:['none'],local:true,capabilities:[
    {key:'external.browser.navigate',tool_name:'browser_open',risk:'external',description:'Open a URL.'},
    {key:'external.browser.inspect',tool_name:'browser_text',risk:'read',description:'Read page text.'},
    {key:'external.browser.interact',tool_name:'browser_click',risk:'external',description:'Interact with a page.'},
  ]},
];

export const integrationToolDefinitions=INTEGRATION_CATALOG.flatMap(entry=>entry.driver==='browser'?[]:entry.capabilities.map(cap=>({
  name:cap.tool_name,description:cap.description,risk:cap.risk,default_enabled:true,input_schema:integrationToolSchema(cap.tool_name),
})));

function integrationToolSchema(name:string):Record<string,unknown>{
  const common={integration_id:{type:'string'}};
  if(name==='github_repo_list')return{type:'object',properties:{...common,limit:{type:'number'}},additionalProperties:false};
  if(name==='github_issue_create')return{type:'object',properties:{...common,repo:{type:'string'},title:{type:'string'},body:{type:'string'}},required:['repo','title'],additionalProperties:false};
  if(name==='github_pr_create')return{type:'object',properties:{...common,repo:{type:'string'},base:{type:'string'},head:{type:'string'},title:{type:'string'},body:{type:'string'}},required:['repo','base','head','title'],additionalProperties:false};
  if(name==='github_pr_merge')return{type:'object',properties:{...common,repo:{type:'string'},number:{type:'number'},method:{type:'string'}},required:['repo','number'],additionalProperties:false};
  if(name==='railway_logs_read')return{type:'object',properties:{...common,service:{type:'string'},lines:{type:'number'}},additionalProperties:false};
  if(name==='railway_deploy')return{type:'object',properties:{...common,cwd:{type:'string'},service:{type:'string'}},additionalProperties:false};
  if(name==='supabase_functions_list')return{type:'object',properties:{...common,project_ref:{type:'string'}},required:['project_ref'],additionalProperties:false};
  if(name==='supabase_function_deploy')return{type:'object',properties:{...common,project_ref:{type:'string'},function_name:{type:'string'},cwd:{type:'string'}},required:['project_ref','function_name'],additionalProperties:false};
  return{type:'object',properties:common,additionalProperties:false};
}

function normalizeError(error:any):{code:string;detail:string;retryable:boolean}{
  const text=String(error?.stderr||error?.message||error||'INTEGRATION_FAILED');
  const lower=text.toLowerCase();
  if(lower.includes('auth')||lower.includes('login')||lower.includes('token'))return{code:'AUTH_ERROR',detail:text,retryable:false};
  if(lower.includes('rate limit')||lower.includes('429'))return{code:'RATE_LIMITED',detail:text,retryable:true};
  if(lower.includes('not found')||lower.includes('404'))return{code:'NOT_FOUND',detail:text,retryable:false};
  if(lower.includes('permission')||lower.includes('forbidden')||lower.includes('403'))return{code:'PERMISSION_DENIED',detail:text,retryable:false};
  if(lower.includes('conflict')||lower.includes('409'))return{code:'CONFLICT',detail:text,retryable:false};
  if(lower.includes('timeout')||lower.includes('network')||lower.includes('econn'))return{code:'TRANSIENT',detail:text,retryable:true};
  return{code:'INTEGRATION_ERROR',detail:text,retryable:false};
}
function connectionExe(name:string){return process.platform==='win32'?name+'.exe':name}

export class IntegrationRegistryService{
  private secrets:SecretStore;
  constructor(private db:Database,secrets?:SecretStore){
    this.secrets=secrets??new DevelopmentSecretStore(getAgentOfficeConfig().dataDir);
    this.ensureLocalConnections();
  }

  catalog(){return INTEGRATION_CATALOG}
  list():IntegrationConnection[]{return (this.db.prepare('SELECT * FROM integration_connections ORDER BY name,id').all() as any[]).map(r=>this.hydrate(r))}
  get(id:string):IntegrationConnection|null{const row=this.db.prepare('SELECT * FROM integration_connections WHERE id=?').get(id) as any;return row?this.hydrate(row):null}

  async create(input:{driver:string;name?:string;auth_mode?:string;secret?:string;config?:Record<string,unknown>;metadata?:Record<string,unknown>;enabled?:boolean}){
    const cat=INTEGRATION_CATALOG.find(x=>x.driver===input.driver);if(!cat)throw new Error('INTEGRATION_DRIVER_UNSUPPORTED');
    const id=crypto.randomUUID(),ts=now(),auth=input.auth_mode??cat.auth_modes[0]??'none';
    if(!cat.auth_modes.includes(auth))throw new Error('INTEGRATION_AUTH_MODE_UNSUPPORTED');
    const secretRef=input.secret?'integration:'+id:null;
    if(input.secret&&secretRef)await this.secrets.set(secretRef,input.secret);
    this.db.prepare("INSERT INTO integration_connections(id,driver,name,enabled,auth_mode,secret_ref,health_status,config_json,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,'unknown',?,?,?,?)")
      .run(id,input.driver,input.name?.trim()||cat.name,input.enabled===false?0:1,auth,secretRef,JSON.stringify(input.config??{}),JSON.stringify(input.metadata??{}),ts,ts);
    this.seedCapabilities(id,input.driver);
    this.event(id,null,null,'connected','info','connect','Integration connection created.',{driver:input.driver});
    return this.get(id)!;
  }

  async update(id:string,patch:{name?:string;enabled?:boolean;auth_mode?:string;secret?:string|null;config?:Record<string,unknown>;metadata?:Record<string,unknown>}){
    const current=this.get(id);if(!current)throw new Error('INTEGRATION_NOT_FOUND');
    const cat=INTEGRATION_CATALOG.find(x=>x.driver===current.driver)!;
    const auth=patch.auth_mode??current.auth_mode;if(!cat.auth_modes.includes(auth))throw new Error('INTEGRATION_AUTH_MODE_UNSUPPORTED');
    let secretRef=current.secret_ref;
    if(patch.secret!==undefined){
      if(patch.secret){secretRef=secretRef??'integration:'+id;await this.secrets.set(secretRef,patch.secret)}
      else if(secretRef){await this.secrets.delete(secretRef);secretRef=null}
    }
    this.db.prepare('UPDATE integration_connections SET name=?,enabled=?,auth_mode=?,secret_ref=?,config_json=?,metadata_json=?,updated_at=? WHERE id=?').run(
      patch.name?.trim()||current.name,patch.enabled===undefined?(current.enabled?1:0):(patch.enabled?1:0),auth,secretRef,
      JSON.stringify(patch.config??current.config),JSON.stringify(patch.metadata??current.metadata),now(),id);
    return this.get(id)!;
  }

  async remove(id:string){
    const current=this.get(id);if(!current)return false;
    if(current.secret_ref)await this.secrets.delete(current.secret_ref).catch(()=>undefined);
    this.db.prepare('DELETE FROM integration_connections WHERE id=?').run(id);
    return true;
  }

  bindProject(projectId:string,integrationId:string,scope:Record<string,unknown>={},metadata:Record<string,unknown>={}):IntegrationProjectBinding{
    if(!this.db.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId))throw new Error('PROJECT_NOT_FOUND');
    if(!this.get(integrationId))throw new Error('INTEGRATION_NOT_FOUND');
    const ts=now();
    this.db.prepare('INSERT INTO project_integration_bindings(project_id,integration_id,scope_json,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,integration_id) DO UPDATE SET scope_json=excluded.scope_json,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at')
      .run(projectId,integrationId,JSON.stringify(scope),JSON.stringify(metadata),ts,ts);
    return this.listProjectBindings(projectId).find(x=>x.integration_id===integrationId)!;
  }
  unbindProject(projectId:string,integrationId:string){return this.db.prepare('DELETE FROM project_integration_bindings WHERE project_id=? AND integration_id=?').run(projectId,integrationId).changes>0}
  listProjectBindings(projectId:string):IntegrationProjectBinding[]{return (this.db.prepare('SELECT * FROM project_integration_bindings WHERE project_id=? ORDER BY created_at').all(projectId) as any[]).map(r=>({project_id:r.project_id,integration_id:r.integration_id,scope:json(r.scope_json,{}),metadata:json(r.metadata_json,{}),created_at:r.created_at,updated_at:r.updated_at}))}

  async test(id:string){
    const connection=this.get(id);if(!connection)throw new Error('INTEGRATION_NOT_FOUND');
    let status:IntegrationHealth='healthy',detail='Ready';
    try{
      if(connection.driver==='browser'){
        const result=await executeFullAccessTool('runtime_health',{}, {projectRoot:process.cwd(),timeoutMs:5000});
        const tools=Array.isArray((result.data as any)?.tools)?(result.data as any).tools:[];
        const browser=tools.find((x:any)=>x.id==='browser');if(!browser||browser.status==='unavailable')throw new Error(browser?.detail||'BROWSER_UNAVAILABLE');
        detail=browser.detail||'Browser ready';
      }else{
        const env=await this.commandEnv(connection);
        const command=this.healthCommand(connection.driver);
        const out=await execFileAsync(command[0],command[1],{timeout:8000,windowsHide:true,env:{...process.env,...env},maxBuffer:256*1024});
        detail=String(out.stdout||out.stderr||'Ready').trim().slice(0,500)||'Ready';
      }
    }catch(error:any){
      const norm=normalizeError(error);status=norm.code==='AUTH_ERROR'?'auth_error':norm.code==='TRANSIENT'?'degraded':'unavailable';detail=norm.detail.slice(0,500);
    }
    this.db.prepare('UPDATE integration_connections SET health_status=?,last_health_at=?,last_error=?,updated_at=? WHERE id=?').run(status,now(),status==='healthy'?null:detail,now(),id);
    this.event(id,null,null,status==='healthy'?'health_success':'health_failure',status==='healthy'?'info':'warning','health',detail,{});
    return{integration_id:id,status,detail};
  }

  resolve(driver:string,projectId?:string|null,explicitId?:string|null):IntegrationConnection|null{
    if(explicitId){const c=this.get(explicitId);return c&&c.driver===driver&&c.enabled?c:null}
    if(projectId){
      const row=this.db.prepare("SELECT c.* FROM project_integration_bindings b JOIN integration_connections c ON c.id=b.integration_id WHERE b.project_id=? AND c.driver=? AND c.enabled=1 ORDER BY CASE c.health_status WHEN 'healthy' THEN 0 ELSE 1 END,b.created_at LIMIT 1").get(projectId,driver) as any;
      if(row)return this.hydrate(row);
    }
    const row=this.db.prepare("SELECT * FROM integration_connections WHERE driver=? AND enabled=1 ORDER BY CASE health_status WHEN 'healthy' THEN 0 ELSE 1 END,created_at LIMIT 1").get(driver) as any;
    return row?this.hydrate(row):null;
  }

  availabilityForTool(toolName:string,projectId?:string|null){
    const cat=INTEGRATION_CATALOG.find(c=>c.capabilities.some(x=>x.tool_name===toolName));
    if(!cat)return{managed:false,available:true,driver:null,integration:null};
    const connection=this.resolve(cat.driver,projectId);
    return{managed:true,available:Boolean(connection&&connection.enabled&&['healthy','unknown','degraded'].includes(connection.health_status)),driver:cat.driver,integration:connection};
  }

  async executeTool(toolName:string,input:Record<string,unknown>,ctx:{project_id:string;project_root:string;run_id:string;signal?:AbortSignal}){
    const cat=INTEGRATION_CATALOG.find(c=>c.capabilities.some(x=>x.tool_name===toolName));if(!cat)throw new Error('INTEGRATION_TOOL_NOT_FOUND');
    const connection=this.resolve(cat.driver,ctx.project_id,typeof input.integration_id==='string'?input.integration_id:null);
    if(!connection)return{ok:false,error:'INTEGRATION_UNAVAILABLE',data:{driver:cat.driver}};
    if(!connection.enabled)return{ok:false,error:'INTEGRATION_DISABLED'};
    if(connection.health_status==='auth_error')return{ok:false,error:'INTEGRATION_AUTH_REQUIRED'};
    this.event(connection.id,ctx.project_id,ctx.run_id,'action_started','info',toolName,'Integration action started.',{tool_name:toolName});
    const binding=this.db.prepare('SELECT scope_json FROM project_integration_bindings WHERE project_id=? AND integration_id=?').get(ctx.project_id,connection.id) as {scope_json:string}|undefined;
    const scope=binding?json<Record<string,unknown>>(binding.scope_json,{}):{};
    const effectiveInput={...scope,...input};
    try{
      const result=await this.executeDriver(connection,toolName,effectiveInput,ctx);
      this.event(connection.id,ctx.project_id,ctx.run_id,'action_completed','info',toolName,'Integration action completed.',{tool_name:toolName});
      return{ok:true,data:{...result,integration_id:connection.id,integration_driver:connection.driver,operation:toolName,external_untrusted:true}};
    }catch(error:any){
      const norm=normalizeError(error);const safeDetail=String(redactSecrets(norm.detail));this.event(connection.id,ctx.project_id,ctx.run_id,'action_failed','error',toolName,safeDetail.slice(0,500),{code:norm.code,retryable:norm.retryable});
      return{ok:false,error:norm.code,data:{detail:String(redactSecrets(norm.detail)).slice(0,1000),retryable:norm.retryable,integration_id:connection.id,integration_driver:connection.driver,operation:toolName,external_untrusted:true}};
    }
  }

  listEvents(limit=100){return (this.db.prepare('SELECT * FROM integration_events ORDER BY created_at DESC LIMIT ?').all(Math.max(1,Math.min(500,limit))) as any[]).map(r=>({...r,payload:json(r.payload_json,{})}))}

  private async executeDriver(c:IntegrationConnection,tool:string,input:Record<string,unknown>,ctx:{project_root:string;signal?:AbortSignal}){
    if(c.driver==='github'){
      const args=tool==='github_user_get'?['api','user']:
        tool==='github_repo_list'?['repo','list','--limit',String(Number(input.limit)||50),'--json','nameWithOwner,url,isPrivate']:
        tool==='github_issue_create'?['issue','create','--repo',String(input.repo),'--title',String(input.title),...(input.body?['--body',String(input.body)]:[])]:
        tool==='github_pr_create'?['pr','create','--repo',String(input.repo),'--base',String(input.base),'--head',String(input.head),'--title',String(input.title),...(input.body?['--body',String(input.body)]:[])]:
        ['pr','merge',String(input.number),'--repo',String(input.repo),String(input.method)==='squash'?'--squash':String(input.method)==='rebase'?'--rebase':'--merge'];
      return this.exec(connectionExe('gh'),args,c,ctx.project_root);
    }
    if(c.driver==='railway'){
      const args=tool==='railway_project_list'?['list','--json']:
        tool==='railway_logs_read'?['logs',...(input.service?['--service',String(input.service)]:[]),'--lines',String(Number(input.lines)||100)]:
        ['up','--detach',...(input.service?['--service',String(input.service)]:[])];
      return this.exec(connectionExe('railway'),args,c,typeof input.cwd==='string'?input.cwd:ctx.project_root);
    }
    if(c.driver==='supabase'){
      const args=tool==='supabase_project_list'?['projects','list','--output','json']:
        tool==='supabase_functions_list'?['functions','list','--project-ref',String(input.project_ref),'--output','json']:
        ['functions','deploy',String(input.function_name),'--project-ref',String(input.project_ref)];
      return this.exec(connectionExe('supabase'),args,c,typeof input.cwd==='string'?input.cwd:ctx.project_root);
    }
    throw new Error('INTEGRATION_DRIVER_UNSUPPORTED');
  }

  private async exec(exe:string,args:string[],c:IntegrationConnection,cwd:string){
    const env=await this.commandEnv(c);
    const out=await execFileAsync(exe,args,{cwd,timeout:120000,windowsHide:true,env:{...process.env,...env},maxBuffer:512*1024});
    const stdout=String(out.stdout??'').trim(),stderr=String(out.stderr??'').trim();
    let data:any=stdout;try{data=stdout?JSON.parse(stdout):{}}catch{}
    return{stdout:data,stderr:stderr||undefined};
  }
  private async commandEnv(c:IntegrationConnection){
    if(!c.secret_ref)return{};
    const value=await this.secrets.get(c.secret_ref);if(!value)throw new Error('AUTH_TOKEN_MISSING');
    if(c.driver==='github')return{GH_TOKEN:value};
    if(c.driver==='railway')return{RAILWAY_TOKEN:value};
    if(c.driver==='supabase')return{SUPABASE_ACCESS_TOKEN:value};
    return{};
  }
  private healthCommand(driver:string):[string,string[]]{
    if(driver==='github')return[connectionExe('gh'),['auth','status']];
    if(driver==='railway')return[connectionExe('railway'),['whoami']];
    if(driver==='supabase')return[connectionExe('supabase'),['projects','list','--output','json']];
    throw new Error('INTEGRATION_DRIVER_UNSUPPORTED');
  }
  private ensureLocalConnections(){
    const existing=this.db.prepare("SELECT id FROM integration_connections WHERE driver='browser' LIMIT 1").get() as {id:string}|undefined;
    if(existing){this.seedCapabilities(existing.id,'browser');return}
    const ts=now(),id='local-browser';
    this.db.prepare("INSERT OR IGNORE INTO integration_connections(id,driver,name,enabled,auth_mode,secret_ref,health_status,config_json,metadata_json,created_at,updated_at) VALUES(?, 'browser','Browser local',1,'none',NULL,'unknown','{}','{}',?,?)").run(id,ts,ts);
    this.seedCapabilities(id,'browser');
  }

  private seedCapabilities(id:string,driver:string){
    const cat=INTEGRATION_CATALOG.find(x=>x.driver===driver);if(!cat)return;
    const stmt=this.db.prepare('INSERT OR IGNORE INTO integration_capabilities(integration_id,capability_key,tool_name,risk,enabled,metadata_json) VALUES(?,?,?,?,1,?)');
    for(const cap of cat.capabilities)stmt.run(id,cap.key,cap.tool_name,cap.risk,JSON.stringify({description:cap.description}));
  }
  private hydrate(r:any):IntegrationConnection{
    const caps=(this.db.prepare('SELECT * FROM integration_capabilities WHERE integration_id=? ORDER BY capability_key').all(r.id) as any[]).map(x=>({capability_key:x.capability_key,tool_name:x.tool_name,risk:x.risk as IntegrationRisk,enabled:Boolean(x.enabled),metadata:json(x.metadata_json,{})}));
    return{id:r.id,driver:r.driver,name:r.name,enabled:Boolean(r.enabled),auth_mode:r.auth_mode,secret_ref:r.secret_ref,health_status:r.health_status,last_health_at:r.last_health_at,last_error:r.last_error,config:json(r.config_json,{}),metadata:json(r.metadata_json,{}),created_at:r.created_at,updated_at:r.updated_at,capabilities:caps};
  }
  private event(integrationId:string|null,projectId:string|null,runId:string|null,eventType:string,status:string,operation:string,detail:string,payload:Record<string,unknown>){
    this.db.prepare('INSERT INTO integration_events(id,integration_id,project_id,run_id,event_type,status,operation,detail,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(),integrationId,projectId,runId,eventType,status,operation,detail,JSON.stringify(payload),now());
  }
}
