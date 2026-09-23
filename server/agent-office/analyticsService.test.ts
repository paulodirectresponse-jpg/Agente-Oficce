import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from './database.js';
import { ProjectRepository } from './projectRepository.js';
import { UsageTracker } from './usageTracker.js';
import { AnalyticsService } from './analyticsService.js';

function fixture() {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ao-analytics-'));
  const root=path.join(dataDir,'project');fs.mkdirSync(root,{recursive:true});
  const database=openAgentOfficeDatabase({dataDir,databasePath:path.join(dataDir,'office.sqlite'),logLevel:'silent'});
  const project=new ProjectRepository(database.connection).create({name:'Analytics Project',root_path:root});
  const conversation=database.connection.prepare('SELECT id FROM conversations WHERE project_id=?').get(project.id) as {id:string};
  const now=new Date().toISOString();
  return {dataDir,database,project,conversation,now,done(){database.connection.close();fs.rmSync(dataDir,{recursive:true,force:true})}};
}

describe('AnalyticsService',()=>{
  it('does not double count root team run token aggregates',()=>{
    const f=fixture();
    try{
      f.database.connection.prepare(`
        INSERT INTO chat_runs(id,conversation_id,project_id,status,mode,parent_run_id,started_at,ended_at,input_tokens,output_tokens,metadata_json)
        VALUES('root',?,?, 'completed','team',NULL,?,?,300,150,'{}')
      `).run(f.conversation.id,f.project.id,f.now,f.now);
      f.database.connection.prepare(`
        INSERT INTO chat_runs(id,conversation_id,project_id,status,mode,parent_run_id,started_at,ended_at,input_tokens,output_tokens,metadata_json)
        VALUES('child-a',?,?, 'completed','single','root',?,?,100,50,'{}')
      `).run(f.conversation.id,f.project.id,f.now,f.now);
      f.database.connection.prepare(`
        INSERT INTO chat_runs(id,conversation_id,project_id,status,mode,parent_run_id,started_at,ended_at,input_tokens,output_tokens,metadata_json)
        VALUES('child-b',?,?, 'completed','single','root',?,?,200,100,'{}')
      `).run(f.conversation.id,f.project.id,f.now,f.now);

      const tracker=new UsageTracker(f.database.connection);
      tracker.recordRunUsage('worker-a','provider-a',{input_tokens:100,output_tokens:50,request_count:1},{projectId:f.project.id,runId:'child-a'});
      tracker.recordRunUsage('worker-b','provider-a',{input_tokens:200,output_tokens:100,request_count:1},{projectId:f.project.id,runId:'child-b'});

      const snapshot=new AnalyticsService(f.database.connection).snapshot({range:'all'});
      expect(snapshot.overview.runs).toBe(1);
      expect(snapshot.overview.input_tokens).toBe(300);
      expect(snapshot.overview.output_tokens).toBe(150);
      expect(snapshot.overview.total_tokens).toBe(450);
      expect(snapshot.data_quality.anti_double_counting).toBe(true);
    }finally{f.done()}
  });

  it('keeps a team root run when filtering by a participating agent',()=>{
    const f=fixture();
    try{
      f.database.connection.prepare(`
        INSERT INTO chat_runs(id,conversation_id,project_id,agent_id,status,mode,parent_run_id,started_at,ended_at,metadata_json)
        VALUES('team-root',?,?,NULL,'completed','team',NULL,?,?,'{"selected_agents":["kimi"]}')
      `).run(f.conversation.id,f.project.id,f.now,f.now);
      f.database.connection.prepare(`
        INSERT INTO chat_runs(id,conversation_id,project_id,agent_id,status,mode,parent_run_id,started_at,ended_at,metadata_json)
        VALUES('team-child',?,?,'kimi','completed','single','team-root',?,?,'{}')
      `).run(f.conversation.id,f.project.id,f.now,f.now);
      const snapshot=new AnalyticsService(f.database.connection).snapshot({range:'all',agent_id:'kimi'});
      expect(snapshot.overview.runs).toBe(1);
      expect(snapshot.overview.completed_runs).toBe(1);
    }finally{f.done()}
  });

  it('summarizes workforce composition and connects orchestration to execution outcome',()=>{
    const f=fixture();
    try{
      f.database.connection.prepare(`
        INSERT INTO orchestration_runs(id,project_id,level_used,decision_json,status,duration_ms,created_at)
        VALUES('orch-1',?,'deterministic','{}','routed',12,?)
      `).run(f.project.id,f.now);
      f.database.connection.prepare(`
        INSERT INTO chat_runs(id,conversation_id,project_id,status,mode,started_at,ended_at,metadata_json)
        VALUES('orch-root',?,?,'completed','single',?,?,'{"orchestration_run_id":"orch-1"}')
      `).run(f.conversation.id,f.project.id,f.now,f.now);
      f.database.connection.prepare(`
        INSERT INTO dynamic_team_instances(id,orchestration_run_id,purpose,created_at,updated_at,lifecycle_status,started_at,completed_at)
        VALUES('wf-1','orch-1','Test workforce',?,?,'completed',?,?)
      `).run(f.now,f.now,f.now,f.now);
      f.database.connection.prepare(`
        INSERT INTO workforce_resource_metadata(dynamic_team_id,worker_kind,worker_id,reason,capability_keys_json,metadata_json,created_at)
        VALUES('wf-1','agent','kimi','','[]','{}',?)
      `).run(f.now);
      const snapshot=new AnalyticsService(f.database.connection).snapshot({range:'all'});
      expect(snapshot.execution.workforces.total).toBe(1);
      expect(snapshot.execution.workforces.completed).toBe(1);
      expect(snapshot.execution.workforces.resource_kinds.agent).toBe(1);
      expect(snapshot.orchestrator.execution_outcome).toMatchObject({linked:1,completed:1,failed:0});
      expect(snapshot.orchestrator.execution_outcome.success_rate).toBe(100);
    }finally{f.done()}
  });

  it('keeps unknown cost unknown and reports coverage',()=>{
    const f=fixture();
    try{
      const tracker=new UsageTracker(f.database.connection);
      tracker.recordRunUsage('worker-a','provider-a',{input_tokens:100,output_tokens:50,cost_usd:0.01,request_count:1},{projectId:f.project.id,costKind:'estimated'});
      tracker.recordRunUsage('worker-a','provider-a',{input_tokens:100,output_tokens:50,request_count:1},{projectId:f.project.id});
      const snapshot=new AnalyticsService(f.database.connection).snapshot({range:'all'});
      expect(snapshot.overview.cost_usd).toBeCloseTo(0.01);
      expect(snapshot.overview.cost_coverage_pct).toBe(50);
      expect(snapshot.overview.cost_known_events).toBe(1);
      expect(snapshot.overview.cost_unknown_events).toBe(1);
    }finally{f.done()}
  });

  it('does not attribute legacy unscoped usage to a project',()=>{
    const f=fixture();
    try{
      const tracker=new UsageTracker(f.database.connection);
      tracker.recordRunUsage('legacy-worker','provider-a',{input_tokens:999,output_tokens:1,request_count:1});
      tracker.recordRunUsage('scoped-worker','provider-a',{input_tokens:10,output_tokens:5,request_count:1},{projectId:f.project.id});
      const global=new AnalyticsService(f.database.connection).snapshot({range:'all'});
      const scoped=new AnalyticsService(f.database.connection).snapshot({range:'all',project_id:f.project.id});
      expect(global.overview.total_tokens).toBe(1015);
      expect(global.data_quality.unscoped_usage_events).toBeGreaterThan(0);
      expect(scoped.overview.total_tokens).toBe(15);
      expect(scoped.data_quality.unscoped_usage_events).toBe(1);
    }finally{f.done()}
  });

  it('separates quality rework from operational failure',()=>{
    const f=fixture();
    try{
      const t=f.now;
      f.database.connection.prepare(`INSERT INTO agents(id,name,slug,role,description,avatar_key,system_prompt,enabled,paused,sort_order,idle_after_seconds,metadata_json,created_at,updated_at)
        VALUES('analytics-agent','Analytics Agent','analytics-agent','','','default','',1,0,0,300,'{}',?,?)`).run(t,t);
      const insert=f.database.connection.prepare(`INSERT INTO agent_performance_events(id,agent_id,project_id,event_type,source,detail,metadata_json,created_at)
        VALUES(?,?,?,?, 'system','','{}',?)`);
      insert.run('p1','analytics-agent',f.project.id,'rework_requested',t);
      insert.run('p2','analytics-agent',f.project.id,'operational_failure',t);
      const snapshot=new AnalyticsService(f.database.connection).snapshot({range:'all',project_id:f.project.id});
      expect(snapshot.overview.rework_events).toBe(1);
      expect(snapshot.overview.operational_failures).toBe(1);
      const worker=snapshot.workers.find(w=>w.id==='analytics-agent');
      expect(worker?.rework_rate).toBe(100);
    }finally{f.done()}
  });
});
