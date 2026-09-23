import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getAgentOfficeConfig } from './config.js';
import { DevelopmentSecretStore } from './secretStore.js';
import { UniversalProviderEngine } from './universalProviderEngine.js';
import { ProviderFallbackRepository, ProviderResilienceManager } from './providerResilience.js';
import { ProviderRepositoryV2 } from './v2DataModel.js';
import type { OrchestratorLLM } from './orchestratorGateway.js';

export interface OrchestratorModelRef { provider_id:string|null; model_id:string|null }
export interface OrchestratorSettings {
  enabled:boolean; principal:OrchestratorModelRef; fast:OrchestratorModelRef|null; deep:OrchestratorModelRef|null;
  fast_confidence_threshold:number; deep_confidence_threshold:number; deep_for_high_risk:boolean; updated_at:string|null;
}
export interface OrchestratorTelemetry {
  provider_id:string; model_id:string; requested_provider_id:string; requested_model_id:string;
  input_tokens:number; output_tokens:number; duration_ms:number; fallback_used:boolean;
}
export interface OrchestratorLLMEnvelope { decision:unknown; telemetry:OrchestratorTelemetry }

const KEY='orchestrator_settings'; const now=()=>new Date().toISOString();
const defaults=():OrchestratorSettings=>({enabled:true,principal:{provider_id:null,model_id:null},fast:null,deep:null,fast_confidence_threshold:.7,deep_confidence_threshold:.55,deep_for_high_risk:true,updated_at:null});
const clamp=(v:unknown,f:number)=>Number.isFinite(Number(v))?Math.max(0,Math.min(1,Number(v))):f;
const ref=(v:any):OrchestratorModelRef|null=>v&&typeof v==='object'?{provider_id:typeof v.provider_id==='string'&&v.provider_id?v.provider_id:null,model_id:typeof v.model_id==='string'&&v.model_id?v.model_id:null}:null;

export function getOrchestratorSettings(db:Database):OrchestratorSettings{
  const row=db.prepare('SELECT value_json,updated_at FROM app_settings WHERE key=?').get(KEY) as any;
  if(!row)return defaults();
  try{const raw=JSON.parse(row.value_json||'{}');return{enabled:raw.enabled!==false,principal:ref(raw.principal)??{provider_id:null,model_id:null},fast:ref(raw.fast),deep:ref(raw.deep),fast_confidence_threshold:clamp(raw.fast_confidence_threshold,.7),deep_confidence_threshold:clamp(raw.deep_confidence_threshold,.55),deep_for_high_risk:raw.deep_for_high_risk!==false,updated_at:row.updated_at??null}}catch{return defaults()}
}
function validate(db:Database,r:OrchestratorModelRef|null,required:boolean){if(!r?.provider_id||!r.model_id){if(required)throw new Error('ORCHESTRATOR_MODEL_REQUIRED');return}const row=db.prepare('SELECT p.enabled pe,m.enabled me FROM providers p JOIN provider_models m ON m.provider_id=p.id WHERE p.id=? AND m.model_id=? LIMIT 1').get(r.provider_id,r.model_id) as any;if(!row)throw new Error('ORCHESTRATOR_MODEL_NOT_FOUND');if(!row.pe||!row.me)throw new Error('ORCHESTRATOR_MODEL_DISABLED')}
export function saveOrchestratorSettings(db:Database,input:Partial<OrchestratorSettings>):OrchestratorSettings{
  const cur=getOrchestratorSettings(db),next:OrchestratorSettings={enabled:input.enabled??cur.enabled,principal:input.principal??cur.principal,fast:input.fast===undefined?cur.fast:input.fast,deep:input.deep===undefined?cur.deep:input.deep,fast_confidence_threshold:clamp(input.fast_confidence_threshold??cur.fast_confidence_threshold,.7),deep_confidence_threshold:clamp(input.deep_confidence_threshold??cur.deep_confidence_threshold,.55),deep_for_high_risk:input.deep_for_high_risk??cur.deep_for_high_risk,updated_at:now()};
  if(next.enabled)validate(db,next.principal,true);validate(db,next.fast,false);validate(db,next.deep,false);
  db.prepare('INSERT INTO app_settings(key,value_json,updated_at)VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').run(KEY,JSON.stringify({...next,updated_at:undefined}),next.updated_at);return next
}
function extractJson(text:string):unknown{const t=text.trim().replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'');try{return JSON.parse(t)}catch{}const s=t.indexOf('{'),e=t.lastIndexOf('}');if(s>=0&&e>s)return JSON.parse(t.slice(s,e+1));throw new Error('ORCHESTRATOR_INVALID_JSON')}
function prompt(level:'fast'|'deep',input:{message:string;domains:string[];constraints:Record<string,unknown>}){return['You are Agent Office central routing control. Return ONLY strict JSON; never reveal hidden chain-of-thought.','Choose resources; do not execute the task.','target_mode: direct_agent | dynamic_team | existing_team | needs_gap_analysis.','Keys: target_mode, normalized_goal, required_capabilities, required_tools, complexity, risk, requires_plan, candidate_scope, quality_controls, explanation, confidence.','required_capabilities items use capability keys available to the Office. explanation is a short operational rationale.',`Level: ${level}`,`Domains: ${JSON.stringify(input.domains)}`,`Constraints: ${JSON.stringify(input.constraints)}`,`Request: ${input.message}`].join('\n')}

export class UniversalOrchestratorLLM implements OrchestratorLLM{
  readonly requires_configured_model=true;
  constructor(private db:Database){}
  private pick(level:'fast'|'deep'){const s=getOrchestratorSettings(this.db);if(!s.enabled)throw new Error('ORCHESTRATOR_AI_DISABLED');const x=level==='fast'?s.fast:s.deep;const r=x?.provider_id&&x.model_id?x:s.principal;if(!r.provider_id||!r.model_id)throw new Error('ORCHESTRATOR_MODEL_REQUIRED');return r}
  async decide(level:'fast'|'deep',input:{message:string;domains:string[];constraints:Record<string,unknown>}):Promise<OrchestratorLLMEnvelope>{
    const r=this.pick(level),started=Date.now(),engine=new UniversalProviderEngine(this.db,new DevelopmentSecretStore(getAgentOfficeConfig().dataDir));
    const out=await engine.complete(r.provider_id!,{model:r.model_id!,messages:[{role:'system',content:'Return strict JSON routing decisions only.'},{role:'user',content:prompt(level,input)}],temperature:0,max_output_tokens:level==='fast'?1200:2200});
    const actualProvider=out.provider_id??r.provider_id!,actualModel=out.model_id??r.model_id!;
    return{decision:extractJson(out.text),telemetry:{provider_id:actualProvider,model_id:actualModel,requested_provider_id:r.provider_id!,requested_model_id:r.model_id!,input_tokens:Number(out.usage?.input_tokens||0),output_tokens:Number(out.usage?.output_tokens||0),duration_ms:Date.now()-started,fallback_used:actualProvider!==r.provider_id||actualModel!==r.model_id}}
  }
}
export function addOrchestratorEvent(db:Database,x:{run_id?:string|null;project_id:string;event_type:string;severity?:'debug'|'info'|'warning'|'error';title:string;detail?:string;payload?:Record<string,unknown>}){db.prepare('INSERT INTO orchestration_events(id,orchestration_run_id,project_id,event_type,severity,title,detail,payload_json,created_at)VALUES(?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),x.run_id??null,x.project_id,x.event_type,x.severity??'info',x.title,x.detail??'',JSON.stringify(x.payload??{}),now())}
export function getOrchestratorStatus(db:Database){
  const s=getOrchestratorSettings(db),providers=new ProviderRepositoryV2(db),resilience=new ProviderResilienceManager(db);
  const describe=(r:OrchestratorModelRef|null)=>{if(!r?.provider_id||!r.model_id)return null;const p=providers.get(r.provider_id);if(!p)return{...r,status:'missing'};const m=providers.listModels(p.id,true).find(x=>x.model_id===r.model_id),rt=resilience.snapshot(p),fallbacks=new ProviderFallbackRepository(db).list(p.id,r.model_id);return{...r,provider_name:p.name,model_name:m?.display_name??r.model_id,enabled:Boolean(p.enabled&&m?.enabled),status:rt.operational_status,circuit_state:rt.circuit_state,queued_requests:rt.queued_requests,fallback_count:fallbacks.length}}
  const stats=db.prepare("SELECT COUNT(*) total,SUM(level_used='deterministic') deterministic,SUM(level_used='fast') fast,SUM(level_used='deep') deep,AVG(duration_ms) avg_duration_ms,SUM(COALESCE(input_tokens,0)) input_tokens,SUM(COALESCE(output_tokens,0)) output_tokens FROM orchestration_runs WHERE created_at>=datetime('now','-1 day')").get() as any;
  const fallbackEvents=db.prepare("SELECT COUNT(*) n FROM orchestration_events WHERE event_type='orchestrator.fallback' AND created_at>=datetime('now','-1 day')").get() as any;
  const latest=db.prepare(`SELECT o.created_at,o.level_used,p.name provider_name,m.model_id effective_model_id,m.display_name model_name
    FROM orchestration_runs o LEFT JOIN providers p ON p.id=o.provider_id LEFT JOIN provider_models m ON m.id=o.model_id
    ORDER BY o.created_at DESC LIMIT 1`).get() as any;
  const principal=describe(s.principal) as any;
  const unhealthy=new Set(['unavailable','auth_error','misconfigured']);
  return{settings:s,principal,fast:describe(s.fast??s.principal),deep:describe(s.deep??s.principal),last_effective:latest?{provider_name:latest.provider_name??null,model_id:latest.effective_model_id??null,model_name:latest.model_name??null,level:latest.level_used,created_at:latest.created_at}:null,stats_24h:{total:Number(stats?.total||0),deterministic:Number(stats?.deterministic||0),fast:Number(stats?.fast||0),deep:Number(stats?.deep||0),fallback:Number(fallbackEvents?.n||0),avg_duration_ms:Math.round(Number(stats?.avg_duration_ms||0)),input_tokens:Number(stats?.input_tokens||0),output_tokens:Number(stats?.output_tokens||0)},latest_run_at:latest?.created_at??null,healthy:s.enabled&&Boolean(principal?.enabled)&&!unhealthy.has(String(principal?.status||''))}
}
