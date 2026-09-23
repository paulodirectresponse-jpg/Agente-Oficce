import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from './database.js';
import { IntegrationRegistryService } from './integrationRegistry.js';
import { GapAnalysisService } from './gapAnalysis.js';
import { ToolRegistry, type AgentToolPolicy } from './toolRegistry.js';
import { CapabilityMatcher } from './capabilityCore.js';
import type { SecretStore } from './secretStore.js';

class MemorySecrets implements SecretStore {
  values=new Map<string,string>();
  async get(ref:string){return this.values.get(ref)??null}
  async set(ref:string,value:string){this.values.set(ref,value)}
  async delete(ref:string){this.values.delete(ref)}
}

function fixture(){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ao-integrations-'));
  const db=openAgentOfficeDatabase({dataDir,databasePath:path.join(dataDir,'db.sqlite'),logLevel:'silent'});
  const root=path.join(dataDir,'project');fs.mkdirSync(root,{recursive:true});
  const t=new Date().toISOString();
  db.connection.prepare("INSERT INTO projects(id,name,root_path,created_at,updated_at) VALUES('p1','P1',?,?,?)").run(root,t,t);
  db.connection.prepare("INSERT INTO conversations(id,project_id,title,created_at,updated_at) VALUES('c1','p1','Main',?,?)").run(t,t);
  db.connection.prepare("INSERT INTO providers(id,name,protocol_driver,enabled,created_at,updated_at) VALUES('prov','P','openai_chat',1,?,?)").run(t,t);
  db.connection.prepare("INSERT INTO provider_models(id,provider_id,model_id,display_name,capabilities_json,enabled,created_at,updated_at) VALUES('m1','prov','m1','M1','{\"tools\":true}',1,?,?)").run(t,t);
  db.connection.prepare("INSERT INTO agents(id,name,slug,role,description,provider_id,model_id,enabled,paused,created_at,updated_at) VALUES('a1','A1','a1','Software','','prov','m1',1,0,?,?)").run(t,t);
  db.connection.prepare("INSERT INTO chat_runs(id,conversation_id,project_id,agent_id,provider_id,model_id,status,mode,started_at,metadata_json) VALUES('r1','c1','p1','a1','prov','m1','running','single',?,'{}')").run(t);
  return{db,root,dataDir,done(){db.connection.close();fs.rmSync(dataDir,{recursive:true,force:true})}};
}

describe('Block 11 Integration Registry',()=>{
  it('persists connection metadata but never the secret value in SQLite',async()=>{
    const f=fixture(),secrets=new MemorySecrets();
    try{
      const service=new IntegrationRegistryService(f.db.connection,secrets);
      const connection=await service.create({driver:'github',name:'GitHub Work',auth_mode:'token',secret:'super-secret-token'});
      expect(connection.secret_ref).toBeTruthy();
      expect(await secrets.get(connection.secret_ref!)).toBe('super-secret-token');
      const raw=JSON.stringify(f.db.connection.prepare('SELECT * FROM integration_connections WHERE id=?').get(connection.id));
      expect(raw).not.toContain('super-secret-token');
      expect(connection.capabilities.some(x=>x.tool_name==='github_pr_create')).toBe(true);
    }finally{f.done()}
  });

  it('supports multiple connections and project-scoped binding',async()=>{
    const f=fixture(),service=new IntegrationRegistryService(f.db.connection,new MemorySecrets());
    try{
      const one=await service.create({driver:'github',name:'Personal',auth_mode:'cli'});
      const two=await service.create({driver:'github',name:'Agency',auth_mode:'cli'});
      service.bindProject('p1',two.id,{repo:'agency/app'});
      expect(service.list().filter(x=>x.driver==='github')).toHaveLength(2);
      expect(service.resolve('github','p1')?.id).toBe(two.id);
      expect(service.listProjectBindings('p1')[0].scope).toEqual({repo:'agency/app'});
      expect(service.resolve('github',null,one.id)?.id).toBe(one.id);
    }finally{f.done()}
  });

  it('distinguishes missing Integration from missing Agent capability',()=>{
    const f=fixture();
    try{
      const gap=new GapAnalysisService(f.db.connection).analyze([],['railway_deploy'],{project_id:'p1'});
      expect(gap.resolution).toBe('missing_integration');
      expect(gap.gaps[0]).toMatchObject({missing_tool:'railway_deploy',missing_integration:'railway'});
    }finally{f.done()}
  });

  it('routes destructive integration actions through approval and idempotency',async()=>{
    const f=fixture(),service=new IntegrationRegistryService(f.db.connection,new MemorySecrets());
    try{
      await service.create({driver:'github',name:'GitHub',auth_mode:'cli'});
      const registry=new ToolRegistry();
      const policy:AgentToolPolicy={agent_id:'a1',enabled:true,allowed_tools:registry.listDefinitions().map(x=>x.name),approval_mode:'safe',max_tool_steps:20,updated_at:new Date().toISOString()};
      const context={database:f.db.connection,project_id:'p1',project_root:f.root,run_id:'r1',agent_id:'a1',idempotency_key:'merge-42'};
      const first=await registry.execute('github_pr_merge',{repo:'owner/repo',number:42},policy,context);
      const second=await registry.execute('github_pr_merge',{repo:'owner/repo',number:42},policy,context);
      expect(first).toMatchObject({ok:false,error:'TOOL_APPROVAL_REQUIRED',approval_required:true});
      expect(second.approval_id).toBe(first.approval_id);
      expect(f.db.connection.prepare("SELECT COUNT(*) n FROM tool_approvals WHERE tool_name='github_pr_merge'").get()).toEqual({n:1});
    }finally{f.done()}
  });

  it('blocks a model that explicitly declares tool calling unsupported',()=>{
    const f=fixture();
    try{
      f.db.connection.prepare("UPDATE provider_models SET capabilities_json='{\"tools\":false}' WHERE id='m1'").run();
      const match=new CapabilityMatcher(f.db.connection).match([],['github_repo_list']).find(x=>x.agent_id==='a1');
      expect(match?.eligible).toBe(false);
      expect(match?.blockers).toContain('model:tool_calling_unsupported');
    }finally{f.done()}
  });

  it('auto-registers Browser as a local Integration',()=>{
    const f=fixture();
    try{
      const browser=new IntegrationRegistryService(f.db.connection,new MemorySecrets()).list().find(x=>x.driver==='browser');
      expect(browser).toBeTruthy();
      expect(browser?.auth_mode).toBe('none');
      expect(browser?.capabilities.some(x=>x.tool_name==='browser_open')).toBe(true);
    }finally{f.done()}
  });
});
