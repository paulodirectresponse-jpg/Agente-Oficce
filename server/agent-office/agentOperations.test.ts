import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from './database.js';
import { AgentOperationsService } from './agentOperations.js';
import { AgentRepositoryV2, ProviderRepositoryV2 } from './v2DataModel.js';

function fixture(){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ao-agent-ops-'));
  const database=openAgentOfficeDatabase({dataDir,databasePath:path.join(dataDir,'office.sqlite'),logLevel:'silent'});
  const agents=new AgentRepositoryV2(database.connection);
  const providers=new ProviderRepositoryV2(database.connection);
  return{dataDir,database,agents,providers,cleanup(){database.connection.close();fs.rmSync(dataDir,{recursive:true,force:true})}};
}

describe('Block 4 agent operations',()=>{
  it('keeps manual enabled state separate from operational readiness',()=>{
    const f=fixture();
    try{
      const agent=f.agents.create({id:'incomplete',name:'Incomplete',slug:'incomplete',enabled:true});
      const ops=new AgentOperationsService(f.database.connection);
      const overview=ops.overview(agent.id);
      expect(overview.administrative_state).toBe('active');
      expect(overview.readiness).toBe('incomplete');
      expect(f.agents.get(agent.id)?.enabled).toBe(true);
      expect(ops.isEligible(agent.id)).toBe(false);
    }finally{f.cleanup()}
  });

  it('supports pause without disabling the agent and removes it from eligibility',()=>{
    const f=fixture();
    try{
      const provider=f.providers.create({id:'p',name:'P',protocol_driver:'openai_chat',base_url:'https://example.invalid',auth_driver:'none'});
      const model=f.providers.createModel(provider.id,{id:'m-pk',model_id:'m',enabled:true,is_default:true});
      const agent=f.agents.create({id:'worker',name:'Worker',slug:'worker',provider_id:provider.id,model_id:model.id,enabled:true});
      const ops=new AgentOperationsService(f.database.connection);
      expect(ops.isEligible(agent.id)).toBe(true);
      f.agents.update(agent.id,{paused:true});
      const overview=ops.overview(agent.id);
      expect(overview.administrative_state).toBe('paused');
      expect(overview.readiness).toBe('paused');
      expect(f.agents.get(agent.id)?.enabled).toBe(true);
      expect(ops.isEligible(agent.id)).toBe(false);
    }finally{f.cleanup()}
  });

  it('derives provider/model degradation independently from administrative state',()=>{
    const f=fixture();
    try{
      const provider=f.providers.create({id:'p2',name:'P2',protocol_driver:'openai_chat',base_url:'https://example.invalid',auth_driver:'none'});
      const model=f.providers.createModel(provider.id,{id:'m2-pk',model_id:'m2',enabled:true,is_default:true});
      const agent=f.agents.create({id:'worker2',name:'Worker2',slug:'worker2',provider_id:provider.id,model_id:model.id,enabled:true});
      const t=new Date().toISOString();
      f.database.connection.prepare(`INSERT INTO provider_runtime_state(provider_id,operational_status,active_requests,queued_requests,rpm_used,tpm_used,circuit_state,consecutive_failures,updated_at) VALUES(?, 'degraded',0,0,0,0,'closed',1,?)`).run(provider.id,t);
      const overview=new AgentOperationsService(f.database.connection).overview(agent.id);
      expect(overview.administrative_state).toBe('active');
      expect(overview.readiness).toBe('provider_degraded');
      expect(overview.provider_status).toBe('degraded');
    }finally{f.cleanup()}
  });

  it('keeps operational failures outside quality assertiveness',()=>{
    const f=fixture();
    try{
      const agent=f.agents.create({id:'quality',name:'Quality',slug:'quality'});
      const ops=new AgentOperationsService(f.database.connection);
      ops.recordPerformance({agent_id:agent.id,event_type:'operational_failure',detail:'HTTP 502'});
      let perf=ops.performance(agent.id);
      expect(perf.operational_failures).toBe(1);
      expect(perf.assertiveness).toBeNull();

      ops.recordPerformance({agent_id:agent.id,event_type:'accepted',source:'user'});
      perf=ops.performance(agent.id);
      expect(perf.assertiveness).toBe(100);

      ops.recordPerformance({agent_id:agent.id,event_type:'rework_requested',source:'user'});
      perf=ops.performance(agent.id);
      expect(perf.assertiveness).toBe(50);
      expect(perf.rework_rate).toBe(50);
      expect(perf.operational_failures).toBe(1);
    }finally{f.cleanup()}
  });
});
