import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { CapabilityMatcher, CapabilityRepository, type CapabilityRequirement } from './capabilityCore.js';
import { GapAnalysisService } from './gapAnalysis.js';
import { TeamService } from './teamService.js';
import { addOrchestratorEvent, getOrchestratorSettings, type OrchestratorLLMEnvelope, type OrchestratorTelemetry } from './orchestratorRuntime.js';
import { AgentOperationsService } from './agentOperations.js';

export type OrchestratorLevel='deterministic'|'fast'|'deep'|'fallback';
export type TargetMode='direct_agent'|'dynamic_team'|'existing_team'|'needs_gap_analysis';
export interface RoutingDecision {
  request_id:string; normalized_goal:string; target_mode:TargetMode; target_agent_id?:string; target_team_id?:string;
  required_capabilities:CapabilityRequirement[]; required_tools:string[]; optional_capabilities:CapabilityRequirement[];
  complexity:'low'|'medium'|'high'; risk:'low'|'medium'|'high'; requires_plan:boolean; candidate_scope:string[];
  quality_controls:string[]; explanation:string; confidence:number;
}
export interface OrchestratorInput { project_id:string; conversation_id?:string|null; user_message_id?:string|null; message:string; target?:string; continuation_agent_id?:string|null }
export interface OrchestratorLLM { requires_configured_model?: boolean; decide(level:'fast'|'deep',input:{message:string;domains:string[];constraints:Record<string,unknown>}):Promise<unknown|OrchestratorLLMEnvelope> }

const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const normalizeTarget=(v?:string)=>{const x=(v??'auto').trim();return x.startsWith('@')?x.slice(1):x||'auto'};
function complexity(message:string){const n=message.length;return n>1200||/arquitet|architecture|completo|multi[- ]?domain|planej|migre|refator/i.test(message)?'high':n>300?'medium':'low'}
function risk(message:string){return /delete|excluir|deploy|produção|production|pagamento|billing|secret|senha|credential|install/i.test(message)?'high':/write|editar|alterar|banco|database/i.test(message)?'medium':'low'}
function infer(message:string,defs:Set<string>):CapabilityRequirement[]{const s=message.toLowerCase(),out:string[]=[];const add=(k:string)=>defs.has(k)&&out.push(k);if(/react|frontend|interface|ui/.test(s))add(/react/.test(s)?'software.frontend.react':'software.frontend');if(/backend|api|server/.test(s))add('software.backend');if(/test|revis|review|bug|debug/.test(s))add('software.testing');if(/marketing|copy|anúncio|anuncio/.test(s))add(/copy/.test(s)?'marketing.copywriting':'marketing');if(/video|vídeo|edição|edicao/.test(s))add(/edi/.test(s)?'video.editing':'video');if(/pesquis|research/.test(s))add('research');if(/design/.test(s))add('design');if(/seguran|security|auth/.test(s))add('security');if(!out.length&&defs.has('software')&&/code|código|codigo|program|app|site|sistema/.test(s))add('software');return[...new Set(out)].map(key=>({key,mandatory:true,minimum:.1}))}
function unwrap(raw:unknown):{decision:unknown;telemetry?:OrchestratorTelemetry}{if(raw&&typeof raw==='object'&&'decision'in raw&&'telemetry'in raw){const x=raw as OrchestratorLLMEnvelope;return{decision:x.decision,telemetry:x.telemetry}}return{decision:raw}}
function validateDecision(raw:any,defs:Set<string>):RoutingDecision|null{
  if(!raw||typeof raw!=='object')return null;const modes=new Set(['direct_agent','dynamic_team','existing_team','needs_gap_analysis']);if(!modes.has(raw.target_mode))return null;
  const req=Array.isArray(raw.required_capabilities)?raw.required_capabilities.filter((x:any)=>x&&typeof x.key==='string'&&defs.has(x.key)).map((x:any)=>({key:x.key,importance:Number.isFinite(x.importance)?Math.max(0,x.importance):1,minimum:Number.isFinite(x.minimum)?Math.max(0,Math.min(1,x.minimum)):.1,mandatory:x.mandatory!==false,allow_hierarchy:x.allow_hierarchy!==false})):[];
  return{request_id:typeof raw.request_id==='string'?raw.request_id:id(),normalized_goal:String(raw.normalized_goal||''),target_mode:raw.target_mode,target_agent_id:typeof raw.target_agent_id==='string'?raw.target_agent_id:undefined,target_team_id:typeof raw.target_team_id==='string'?raw.target_team_id:undefined,required_capabilities:req,required_tools:Array.isArray(raw.required_tools)?raw.required_tools.filter((x:any)=>typeof x==='string'):[],optional_capabilities:[],complexity:['low','medium','high'].includes(raw.complexity)?raw.complexity:'medium',risk:['low','medium','high'].includes(raw.risk)?raw.risk:'low',requires_plan:Boolean(raw.requires_plan),candidate_scope:Array.isArray(raw.candidate_scope)?raw.candidate_scope.filter((x:any)=>typeof x==='string'):[],quality_controls:Array.isArray(raw.quality_controls)?raw.quality_controls.filter((x:any)=>typeof x==='string'):[],explanation:String(raw.explanation||'Structured orchestration decision.'),confidence:Number.isFinite(raw.confidence)?Math.max(0,Math.min(1,raw.confidence)):.5}
}

export class OrchestratorGateway {
  private caps:CapabilityRepository; private matcher:CapabilityMatcher;
  constructor(private db:Database,private llm?:OrchestratorLLM){this.caps=new CapabilityRepository(db);this.matcher=new CapabilityMatcher(db)}

  private agentEligible(agentId:string):boolean{
    try { return new AgentOperationsService(this.db).isEligible(agentId); }
    catch { return false; }
  }

  private classifyFeedback(message:string):{event_type:'accepted'|'rework_requested'|'rejected';confidence:number;reason:string}|null{
    const text=message.trim().toLowerCase();
    if(!text||text.length>900)return null;
    if(/\b(n[aã]o tem nada a ver|totalmente errado|completamente errado|refa[cç]a tudo|rejeitado|rejeito|isso est[aá] todo errado)\b/i.test(text))
      return{event_type:'rejected',confidence:.96,reason:'Explicit rejection of the previous delivery.'};
    if(/\b(est[aá]|ficou|continua|ainda).{0,35}\b(errad[oa]|incorret[oa]|bugad[oa])\b|\b(corrija|corrigir|conserte|arrume|faltou|n[aã]o ficou|precisa corrigir|tem um erro|deu erro)\b/i.test(text))
      return{event_type:'rework_requested',confidence:.9,reason:'Explicit correction request for the previous delivery.'};
    const acceptance=/^(perfeito|perfeita|funcionou|deu certo|aprovado|aprovada|ficou bom|ficou [oó]timo|[oó]timo|excelente|show|beleza|isso mesmo|era isso|agora sim|tudo certo)\b/i.test(text);
    const contrast=/\b(mas|por[eé]m|s[oó] que|entretanto|ainda|por outro lado)\b/i.test(text);
    if(acceptance&&!contrast)
      return{event_type:'accepted',confidence:.94,reason:'Explicit positive acceptance of the previous delivery.'};
    return null;
  }

  private capturePreviousFeedback(input:OrchestratorInput,event:(type:string,title:string,detail?:string,payload?:Record<string,unknown>,severity?:'debug'|'info'|'warning'|'error')=>void):void{
    if(!input.conversation_id)return;
    const feedback=this.classifyFeedback(input.message);if(!feedback)return;
    const row=this.db.prepare(`
      SELECT id,agent_id,metadata_json FROM messages
      WHERE conversation_id=? AND role='assistant'
      ORDER BY created_at DESC LIMIT 1
    `).get(input.conversation_id) as any;
    if(!row)return;
    let metadata:any={};try{metadata=JSON.parse(row.metadata_json||'{}')}catch{}
    const runId=typeof metadata.child_run_id==='string'?metadata.child_run_id:typeof metadata.root_run_id==='string'?metadata.root_run_id:null;
    if(!runId)return;
    const subagentId=typeof metadata.subagent_id==='string'?metadata.subagent_id:null;
    if(row.agent_id){
      new AgentOperationsService(this.db).recordPerformance({
        agent_id:row.agent_id,
        run_id:runId,
        project_id:input.project_id,
        event_type:feedback.event_type,
        source:'orchestrator',
        detail:feedback.reason,
        metadata:{confidence:feedback.confidence,user_message:input.message.slice(0,500),assistant_message_id:row.id},
      });
    }else if(subagentId){
      this.db.prepare(`DELETE FROM subagent_performance_events WHERE subagent_id=? AND run_id=? AND source IN ('user','orchestrator') AND event_type IN ('accepted','rework_requested','rejected')`).run(subagentId,runId);
      this.db.prepare(`INSERT INTO subagent_performance_events(id,subagent_id,run_id,project_id,event_type,score,source,detail,metadata_json,created_at)VALUES(?,?,?,?,?,NULL,'orchestrator',?,?,?)`).run(
        id(),subagentId,runId,input.project_id,feedback.event_type,feedback.reason,
        JSON.stringify({confidence:feedback.confidence,user_message:input.message.slice(0,500),assistant_message_id:row.id}),now()
      );
    }else return;
    event('orchestrator.quality_feedback','Feedback de qualidade identificado',feedback.reason,{agent_id:row.agent_id??null,subagent_id:subagentId,run_id:runId,event_type:feedback.event_type,confidence:feedback.confidence});
  }

  async route(input:OrchestratorInput):Promise<{level:OrchestratorLevel;decision:RoutingDecision;orchestration_run_id:string}>{
    const started=Date.now(),requestId=id(),settings=getOrchestratorSettings(this.db);this.caps.seed();
    const defs=this.caps.list(),keys=new Set(defs.map(d=>d.key)),target=normalizeTarget(input.target);
    let level:OrchestratorLevel='deterministic',decision:RoutingDecision|undefined,error:unknown,lastTelemetry:OrchestratorTelemetry|undefined;
    let inputTokens=0,outputTokens=0;
    const staged:Array<{type:string;severity:'debug'|'info'|'warning'|'error';title:string;detail:string;payload?:Record<string,unknown>}>=[];

    const event=(type:string,title:string,detail='',payload?:Record<string,unknown>,severity:'debug'|'info'|'warning'|'error'='info')=>staged.push({type,severity,title,detail,payload});
    event('orchestrator.received','Solicitação recebida',input.message.slice(0,240),{target});
    this.capturePreviousFeedback(input,event);
    const base=(mode:TargetMode,explanation:string):RoutingDecision=>({request_id:requestId,normalized_goal:input.message.trim().slice(0,1000),target_mode:mode,required_capabilities:infer(input.message,keys),required_tools:[],optional_capabilities:[],complexity:complexity(input.message),risk:risk(input.message),requires_plan:complexity(input.message)==='high',candidate_scope:[],quality_controls:[],explanation,confidence:.8});

    if(target!=='auto'&&target!=='team'){
      const a=this.db.prepare('SELECT id,slug FROM agents WHERE (id=? OR slug=?) AND enabled=1 LIMIT 1').get(target,target) as any;
      if(a&&this.agentEligible(a.id)){decision={...base('direct_agent','Explicit eligible agent target.'),target_agent_id:a.id,candidate_scope:[a.id],confidence:1};event('orchestrator.fast_path','Target explícito validado',`Agente ${a.id} selecionado.`)}
      else {const team=this.db.prepare('SELECT id FROM teams WHERE (id=? OR slug=?) AND enabled=1 LIMIT 1').get(target,target) as any;if(!team)throw new Error('ORCHESTRATOR_TARGET_UNAVAILABLE');decision={...base('existing_team','Explicit enabled permanent team target.'),target_team_id:team.id,candidate_scope:[],confidence:1};event('orchestrator.fast_path','Equipe explícita validada',`Equipe ${team.id} selecionada.`)}
    } else if(input.continuation_agent_id&&this.agentEligible(input.continuation_agent_id)){
      decision={...base('direct_agent','Continuation keeps the current eligible owner.'),target_agent_id:input.continuation_agent_id,candidate_scope:[input.continuation_agent_id],confidence:1};event('orchestrator.fast_path','Continuação preservada',`Mantendo ${input.continuation_agent_id}.`);
    }

    if(!decision){
      const d=base(target==='team'?'dynamic_team':'needs_gap_analysis','Deterministic capability routing.');
      const matches=this.matcher.match(d.required_capabilities,d.required_tools).filter(x=>x.eligible&&this.agentEligible(x.agent_id));
      if(target!=='team'&&d.required_capabilities.length===1&&matches.length){
        decision={...d,target_mode:'direct_agent',target_agent_id:matches[0].agent_id,candidate_scope:matches.map(x=>x.agent_id),explanation:'Single-capability deterministic fast path.',confidence:.9};
        event('orchestrator.fast_path','Fast path determinístico','Uma capability inequívoca resolveu o roteamento.',{candidate_count:matches.length});
      } else if(this.llm&&settings.enabled&&((settings.principal.provider_id&&settings.principal.model_id)||!this.llm.requires_configured_model)){
        try{
          level='fast';event('orchestrator.analyzing','Análise Fast iniciada','O modelo de orquestração está classificando a solicitação.');
          const fastRaw=unwrap(await this.llm.decide('fast',{message:input.message,domains:[...new Set(defs.map(x=>x.domain))],constraints:{no_secrets:true,no_filesystem:true,no_tools:true,capability_keys:[...keys]}}));
          lastTelemetry=fastRaw.telemetry;inputTokens+=fastRaw.telemetry?.input_tokens||0;outputTokens+=fastRaw.telemetry?.output_tokens||0;
          decision=validateDecision(fastRaw.decision,keys)??undefined;
          if(lastTelemetry?.fallback_used)event('orchestrator.fallback','Fallback do Orquestrador utilizado',`${lastTelemetry.requested_provider_id}/${lastTelemetry.requested_model_id} → ${lastTelemetry.provider_id}/${lastTelemetry.model_id}`,{},'warning');
          const needsDeep=!decision||decision.confidence<settings.fast_confidence_threshold||decision.complexity==='high'||(settings.deep_for_high_risk&&decision.risk==='high');
          if(needsDeep){
            level='deep';event('orchestrator.analyzing','Análise Deep iniciada','A solicitação exige análise mais profunda.',{fast_confidence:decision?.confidence??0});
            const deepRaw=unwrap(await this.llm.decide('deep',{message:input.message,domains:[...new Set(defs.map(x=>x.domain))],constraints:{no_secrets:true,no_filesystem:true,no_tools:true,capability_keys:[...keys]}}));
            lastTelemetry=deepRaw.telemetry;inputTokens+=deepRaw.telemetry?.input_tokens||0;outputTokens+=deepRaw.telemetry?.output_tokens||0;
            const deep=validateDecision(deepRaw.decision,keys);
            if(deep&&deep.confidence>=settings.deep_confidence_threshold)decision=deep;
            if(lastTelemetry?.fallback_used)event('orchestrator.fallback','Fallback do Orquestrador utilizado',`${lastTelemetry.requested_provider_id}/${lastTelemetry.requested_model_id} → ${lastTelemetry.provider_id}/${lastTelemetry.model_id}`,{},'warning');
          }
        }catch(e){error=e;level='fallback';event('orchestrator.fallback','IA de orquestração indisponível','Fast path determinístico assumiu o controle.',{error:e instanceof Error?e.message:String(e)},'warning')}
      }
      if(!decision||decision.confidence<settings.deep_confidence_threshold){level=level==='deterministic'?'deterministic':'fallback';decision=d}
    }

    decision=this.policyValidate(decision,keys);
    if((decision.required_capabilities.length||decision.required_tools.length)&&(decision.target_mode==='needs_gap_analysis'||(decision.target_mode==='dynamic_team'&&!decision.candidate_scope.length)||(decision.target_mode==='existing_team'&&!decision.target_team_id)||(decision.target_mode==='direct_agent'&&!decision.target_agent_id))){
      const gap=new GapAnalysisService(this.db).analyze(decision.required_capabilities,decision.required_tools);
      if(gap.resolution==='active_agent'&&gap.selected_agent_ids.length===1)decision={...decision,target_mode:'direct_agent',target_agent_id:gap.selected_agent_ids[0],candidate_scope:gap.selected_agent_ids,explanation:gap.explanation,confidence:.95};
      else if(gap.resolution==='existing_team'&&gap.selected_team_id)decision={...decision,target_mode:'existing_team',target_team_id:gap.selected_team_id,candidate_scope:[],explanation:gap.explanation,confidence:.95};
      else if(gap.resolution==='dynamic_team'&&gap.selected_agent_ids.length)decision={...decision,target_mode:'dynamic_team',candidate_scope:gap.selected_agent_ids,explanation:gap.explanation,confidence:.95};
      event('orchestrator.candidates','Recursos avaliados',gap.explanation,{resolution:gap.resolution,candidates:decision.candidate_scope});
    }

    decision=this.policyValidate(decision,keys);const oid=id();
    this.db.prepare(`INSERT INTO orchestration_runs(id,project_id,conversation_id,user_message_id,level_used,decision_json,status,provider_id,model_id,input_tokens,output_tokens,duration_ms,error_json,created_at)VALUES(?,?,?,?,?,?,'routed',?,?,?,?,?,?,?)`).run(
      oid,input.project_id,input.conversation_id??null,input.user_message_id??null,level,JSON.stringify(decision),
      lastTelemetry?.provider_id??null,
      lastTelemetry?this.db.prepare('SELECT id FROM provider_models WHERE provider_id=? AND model_id=? LIMIT 1').pluck().get(lastTelemetry.provider_id,lastTelemetry.model_id)??null:null,
      inputTokens||null,outputTokens||null,Date.now()-started,error?JSON.stringify({code:'ORCHESTRATOR_FALLBACK',message:error instanceof Error?error.message:String(error)}):null,now()
    );

    if(decision.target_mode==='dynamic_team'&&decision.candidate_scope.length&&!decision.target_team_id){
      const dyn=new TeamService(this.db).createWorkforce({orchestration_run_id:oid,purpose:decision.normalized_goal,member_ids:decision.candidate_scope,policy:{allowed_tools:decision.required_tools}});
      event('orchestrator.workforce','Workforce temporária criada','Agentes existentes foram requisitados para esta execução sem alterar suas equipes permanentes.',{workforce_id:dyn.id,members:decision.candidate_scope});
      decision={...decision,target_team_id:dyn.id};this.db.prepare('UPDATE orchestration_runs SET decision_json=? WHERE id=?').run(JSON.stringify(decision),oid);
    }
    event('orchestrator.routed','Roteamento concluído',decision.explanation,{level,target_mode:decision.target_mode,target_agent_id:decision.target_agent_id??null,target_team_id:decision.target_team_id??null,confidence:decision.confidence});
    for(const e of staged)addOrchestratorEvent(this.db,{run_id:oid,project_id:input.project_id,event_type:e.type,severity:e.severity,title:e.title,detail:e.detail,payload:e.payload});
    return{level,decision,orchestration_run_id:oid}
  }

  private policyValidate(d:RoutingDecision,keys:Set<string>):RoutingDecision{
    const req=d.required_capabilities.filter(x=>keys.has(x.key));
    const allowedTools=new Set((this.db.prepare('SELECT allowed_tools_json FROM agent_tool_policies WHERE enabled=1').all() as any[]).flatMap(r=>{try{return JSON.parse(r.allowed_tools_json)}catch{return[]}}));
    const tools=d.required_tools.filter(x=>allowedTools.has(x));
    const scope=d.candidate_scope.filter(agent=>this.agentEligible(agent));let target=d.target_agent_id,team=d.target_team_id;
    if(target&&!this.agentEligible(target)){target=undefined;if(d.target_mode==='direct_agent')d={...d,target_mode:'needs_gap_analysis',explanation:d.explanation+' Invalid or unavailable target removed.'}}
    if(team&&!this.db.prepare('SELECT 1 FROM teams WHERE id=? AND enabled=1').get(team)){team=undefined;if(d.target_mode==='existing_team')d={...d,target_mode:'needs_gap_analysis',explanation:d.explanation+' Invalid or disabled team target removed.'}}
    return{...d,required_capabilities:req,required_tools:tools,candidate_scope:scope,target_agent_id:target,target_team_id:team}
  }
}
