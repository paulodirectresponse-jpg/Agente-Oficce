import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openAgentOfficeDatabase } from './database.js';
import { WorkspaceService } from './workspaceService.js';
import { ActivityRepository, ChatRunRepository } from './v2DataModel.js';

function fixture(){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ao-workspace-')),root=path.join(dataDir,'project');fs.mkdirSync(root,{recursive:true});
  const database=openAgentOfficeDatabase({dataDir,databasePath:path.join(dataDir,'office.sqlite'),logLevel:'silent'});
  const t=new Date().toISOString();
  database.connection.prepare(`INSERT INTO projects(id,name,root_path,git_enabled,git_branch,created_at,updated_at)VALUES('p','P',?,1,NULL,?,?)`).run(root,t,t);
  database.connection.prepare(`INSERT INTO conversations(id,project_id,title,created_at,updated_at)VALUES('c','p','Main',?,?)`).run(t,t);
  execFileSync('git',['init'],{cwd:root,stdio:'ignore'});execFileSync('git',['config','user.email','test@example.com'],{cwd:root});execFileSync('git',['config','user.name','Test'],{cwd:root});
  fs.writeFileSync(path.join(root,'app.txt'),'one\n');execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['commit','-m','init'],{cwd:root,stdio:'ignore'});
  return{dataDir,root,database,done(){database.connection.close();fs.rmSync(dataDir,{recursive:true,force:true})}};
}
describe('WorkspaceService',()=>{
  it('recovers the root active run, safely browses project files and inspects child-run work',()=>{
    const f=fixture();try{
      const runs=new ChatRunRepository(f.database.connection),root=runs.create({conversation_id:'c',project_id:'p',status:'running',mode:'team',metadata:{orchestration_run_id:'none'}}),child=runs.create({conversation_id:'c',project_id:'p',status:'running',mode:'single',parent_run_id:root.id});
      const svc=new WorkspaceService(f.database.connection);svc.captureBaseline('p',root.id);
      fs.mkdirSync(path.join(f.root,'src'));fs.writeFileSync(path.join(f.root,'src','a.ts'),'export const a=1;\n');fs.mkdirSync(path.join(f.root,'node_modules'));fs.writeFileSync(path.join(f.root,'node_modules','x.js'),'x');
      fs.writeFileSync(path.join(f.root,'app.txt'),'one\ntwo\n');
      const t=new Date().toISOString();
      f.database.connection.prepare(`INSERT INTO tool_audit_events(id,project_id,run_id,agent_id,tool_name,risk,status,input_json,result_json,started_at,ended_at)VALUES('audit','p',?,NULL,'write_file','write','completed','{"path":"src/a.ts"}','{"ok":true}',?,?)`).run(child.id,t,t);
      new ActivityRepository(f.database.connection).append({project_id:'p',run_id:child.id,type:'tool.completed',title:'file',detail:'src/a.ts'});
      const snap=svc.snapshot('p');expect(snap.active_run.id).toBe(root.id);
      const files=svc.files('p','.');expect(files.map(x=>x.name)).toContain('src');expect(files.map(x=>x.name)).not.toContain('node_modules');
      expect(svc.file('p','src/a.ts').content).toContain('export const');
      expect(()=>svc.file('p','../outside.txt')).toThrow('WORKSPACE_PATH_OUTSIDE_PROJECT');
      const diff=svc.gitDiff('p');expect(diff.additions).toBeGreaterThan(0);
      const inspection=svc.runInspection(root.id);expect(inspection.tools.map((x:any)=>x.id)).toContain('audit');expect(inspection.activities.some((x:any)=>x.run_id===child.id)).toBe(true);expect(inspection.files_changed).toContain('src/a.ts');
      expect(svc.listRuns('p').map(x=>x.id)).toEqual([root.id]);
    }finally{f.done()}
  });
  it('persists queue commands and tracks their lifecycle',()=>{
    const f=fixture();try{
      const run=new ChatRunRepository(f.database.connection).create({conversation_id:'c',project_id:'p',status:'running',mode:'single'}),svc=new WorkspaceService(f.database.connection);
      const queued=svc.queueCommand({project_id:'p',chat_run_id:run.id,command_type:'enqueue',message:'next',target:'auto'}) as any;
      expect(svc.nextQueued('p')?.id).toBe(queued.id);svc.markCommand(queued.id,'dispatched');expect(svc.nextQueued('p')).toBeUndefined();
      const orient=svc.queueCommand({project_id:'p',chat_run_id:run.id,command_type:'orient',message:'focus tests'}) as any;expect(svc.consumeOrientations(run.id)).toEqual(['focus tests']);expect((f.database.connection.prepare('SELECT status FROM workspace_run_commands WHERE id=?').get(orient.id) as any).status).toBe('applied');
    }finally{f.done()}
  });
});
