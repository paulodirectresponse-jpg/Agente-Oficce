import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { CapabilityRepository } from './capabilityCore.js';
import { UsageTracker } from './usageTracker.js';
import { AgentRepositoryV2, type Agent } from './v2DataModel.js';

export type AgentReadiness =
  | 'inactive' | 'paused' | 'incomplete' | 'ready' | 'busy' | 'queued'
  | 'provider_degraded' | 'provider_unavailable' | 'model_unavailable' | 'error';

export interface AgentPerformanceSummary {
  assertiveness: number | null;
  first_pass_rate: number | null;
  rework_rate: number | null;
  quality_signals: number;
  execution_successes: number;
  operational_failures: number;
  cancellations: number;
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  success_rate: number | null;
  average_duration_ms: number | null;
  cost_usd: number | null;
  input_tokens: number;
  output_tokens: number;
}

export interface AgentOverview {
  agent_id: string;
  administrative_state: 'active'|'inactive'|'paused';
  readiness: AgentReadiness;
  readiness_reason: string;
  current_state: string;
  current_activity: string;
  provider_status: string | null;
  model_status: string | null;
  provider_name: string | null;
  model_name: string | null;
  last_effective_model: string | null;
  capabilities: ReturnType<CapabilityRepository['listAgent']>;
  performance: AgentPerformanceSummary;
  recent_activity: Array<Record<string, unknown>>;
}

const now=()=>new Date().toISOString();

function pct(a:number,b:number):number|null{return b>0?Math.round((a/b)*1000)/10:null}

export class AgentOperationsService {
  constructor(private readonly db: Database) {}

  recordPerformance(input:{agent_id:string;run_id?:string|null;project_id?:string|null;event_type:string;score?:number|null;source?:string;detail?:string;metadata?:Record<string,unknown>}):void{
    if (!this.db.prepare('SELECT 1 FROM agents WHERE id=?').get(input.agent_id)) throw new Error('AGENT_NOT_FOUND');
    const allowed=new Set(['accepted','rework_requested','rejected','quality_failure','execution_success','operational_failure','cancelled','validation_passed']);
    if(!allowed.has(input.event_type))throw new Error('AGENT_PERFORMANCE_EVENT_INVALID');
    this.db.prepare(`INSERT INTO agent_performance_events(id,agent_id,run_id,project_id,event_type,score,source,detail,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(),input.agent_id,input.run_id??null,input.project_id??null,input.event_type,
      input.score==null?null:Math.max(0,Math.min(1,input.score)),input.source??'system',input.detail??'',JSON.stringify(input.metadata??{}),now()
    );
  }

  performance(agentId:string,windowDays=30):AgentPerformanceSummary{
    const since=new Date(Date.now()-windowDays*86400000).toISOString();
    const events=this.db.prepare('SELECT event_type FROM agent_performance_events WHERE agent_id=? AND created_at>=?').all(agentId,since) as Array<{event_type:string}>;
    const count=(type:string)=>events.filter(e=>e.event_type===type).length;
    const accepted=count('accepted'),validated=count('validation_passed'),rework=count('rework_requested'),rejected=count('rejected'),qualityFailure=count('quality_failure');
    const qualityPositive=accepted+validated,qualityNegative=rework+rejected+qualityFailure,qualityTotal=qualityPositive+qualityNegative;
    const firstPassDen=accepted+rework+rejected;
    const runs=this.db.prepare(`SELECT status,started_at,ended_at FROM chat_runs WHERE agent_id=? AND started_at>=?`).all(agentId,since) as Array<{status:string;started_at:string;ended_at:string|null}>;
    const completed=runs.filter(r=>r.status==='completed').length,failed=runs.filter(r=>r.status==='failed').length;
    const terminal=runs.filter(r=>['completed','failed','cancelled'].includes(r.status)).length;
    const usage=new UsageTracker(this.db).summarize(agentId,windowDays);
    return {
      assertiveness:pct(qualityPositive,qualityTotal),
      first_pass_rate:pct(accepted,firstPassDen),
      rework_rate:pct(rework,qualityTotal),
      quality_signals:qualityTotal,
      execution_successes:count('execution_success'),
      operational_failures:count('operational_failure'),
      cancellations:count('cancelled'),
      total_runs:runs.length,
      completed_runs:completed,
      failed_runs:failed,
      success_rate:pct(completed,terminal),
      average_duration_ms:usage.average_duration_ms,
      cost_usd:usage.cost_usd,
      input_tokens:usage.input_tokens,
      output_tokens:usage.output_tokens,
    };
  }

  overview(agentId:string):AgentOverview{
    const agent=new AgentRepositoryV2(this.db).get(agentId);if(!agent)throw new Error('AGENT_NOT_FOUND');
    const provider=agent.provider_id?this.db.prepare('SELECT * FROM providers WHERE id=?').get(agent.provider_id) as any:null;
    const model=agent.model_id?this.db.prepare('SELECT * FROM provider_models WHERE id=?').get(agent.model_id) as any:null;
    const providerRuntime=provider?this.db.prepare('SELECT * FROM provider_runtime_state WHERE provider_id=?').get(provider.id) as any:null;
    const modelRuntime=provider&&model?this.db.prepare('SELECT * FROM provider_model_runtime_state WHERE provider_id=? AND model_id=?').get(provider.id,model.model_id) as any:null;
    const state=this.db.prepare('SELECT * FROM agent_states WHERE agent_id=? ORDER BY updated_at DESC LIMIT 1').get(agentId) as any;
    const latestMessage=this.db.prepare(`SELECT metadata_json FROM messages WHERE agent_id=? AND role='assistant' ORDER BY created_at DESC LIMIT 1`).get(agentId) as any;
    let lastEffective:string|null=null;try{const m=JSON.parse(latestMessage?.metadata_json||'{}');lastEffective=typeof m.effective_model==='string'?m.effective_model:typeof m.model==='string'?m.model:null}catch{}

    const derived=this.readiness(agent,provider,model,providerRuntime,modelRuntime,state);
    const caps=new CapabilityRepository(this.db);caps.seed();
    const activity=this.db.prepare('SELECT type,severity,title,detail,payload_json,created_at FROM activity_events WHERE agent_id=? ORDER BY created_at DESC LIMIT 12').all(agentId) as any[];
    return {
      agent_id:agentId,
      administrative_state:!agent.enabled?'inactive':agent.paused?'paused':'active',
      readiness:derived.status,
      readiness_reason:derived.reason,
      current_state:state?.state??'idle',
      current_activity:state?.activity??'',
      provider_status:providerRuntime?.operational_status??provider?.health_status??null,
      model_status:modelRuntime?.operational_status??(model?.enabled?'unknown':model?'unavailable':null),
      provider_name:provider?.name??null,
      model_name:model?.display_name??null,
      last_effective_model:lastEffective,
      capabilities:caps.listAgent(agentId),
      performance:this.performance(agentId),
      recent_activity:activity.map(row=>({...row,payload:this.parse(row.payload_json)})),
    };
  }

  list():AgentOverview[]{return new AgentRepositoryV2(this.db).list(true).map(a=>this.overview(a.id))}

  isEligible(agentId:string):boolean{
    const o=this.overview(agentId);
    return o.administrative_state==='active' && !['inactive','paused','incomplete','provider_unavailable','model_unavailable','error'].includes(o.readiness);
  }

  private readiness(agent:Agent,provider:any,model:any,pr:any,mr:any,state:any):{status:AgentReadiness;reason:string}{
    if(!agent.enabled)return{status:'inactive',reason:'Desativado manualmente.'};
    if(agent.paused)return{status:'paused',reason:'Pausado manualmente; não recebe novos trabalhos.'};
    if(!agent.provider_id||!agent.model_id)return{status:'incomplete',reason:'Configure provider e modelo para executar.'};
    if(!provider?.enabled)return{status:'provider_unavailable',reason:'Provider desativado ou indisponível.'};
    if(!model?.enabled)return{status:'model_unavailable',reason:'Modelo desativado ou indisponível.'};
    const ps=String(pr?.operational_status??provider.health_status??'unknown'),ms=String(mr?.operational_status??'unknown');
    if(['auth_error','misconfigured','unavailable'].includes(ps))return{status:'provider_unavailable',reason:`Provider: ${ps}`};
    if(['auth_error','misconfigured','unavailable'].includes(ms))return{status:'model_unavailable',reason:`Modelo: ${ms}`};
    if(state?.state==='error')return{status:'error',reason:state.activity||'Última execução terminou com erro.'};
    if(['thinking','responding','planning','reviewing','coding','testing','waiting'].includes(String(state?.state)))return{status:'busy',reason:state.activity||'Executando trabalho.'};
    if(ps==='queued')return{status:'queued',reason:'Provider possui requisições aguardando.'};
    if(['degraded','rate_limited'].includes(ps)||['degraded','rate_limited'].includes(ms))return{status:'provider_degraded',reason:`Runtime degradado: provider ${ps}, modelo ${ms}.`};
    return{status:'ready',reason:'Agente configurado e elegível para execução.'};
  }
  private parse(v:string){try{return JSON.parse(v||'{}')}catch{return{}}}
}
