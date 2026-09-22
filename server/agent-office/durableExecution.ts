import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { ActivityRepository } from './v2DataModel.js';
import { ExecutionGraphService, type PlanDraft } from './executionGraph.js';
import { createExecutionCheckpoint } from './executionCheckpoint.js';

const id=()=>crypto.randomUUID(), now=()=>new Date().toISOString(), json=(v:unknown)=>JSON.stringify(v??{});
const UNSAFE_TOOLS=new Set(['write_file','apply_patch','npm_install','node_script','run_command']);

export class DurableExecutionService{
 constructor(private db:Database){}
 recoverAll(){
  const plans=this.db.prepare(`SELECT id,project_id FROM execution_plans WHERE status IN ('validated','running') ORDER BY created_at`).all() as any[];
  let recovered=0,manualReview=0,retryable=0;
  const recoveredAt=now();
  const tx=this.db.transaction(()=>{
   this.db.prepare(`UPDATE resource_locks SET status='expired' WHERE status='active'`).run();
   this.db.prepare(`UPDATE tool_approvals SET status='denied',resolved_at=?,actor='system:expiry' WHERE status='pending' AND expires_at IS NOT NULL AND expires_at<=?`).run(recoveredAt,recoveredAt);
   for(const plan of plans){
    const running=this.db.prepare(`SELECT a.id attempt_id,a.step_id,s.required_tools_json,s.resource_locks_json,s.resume_state FROM step_attempts a JOIN execution_steps s ON s.id=a.step_id WHERE s.plan_id=? AND a.status='running'`).all(plan.id) as any[];
    for(const row of running){
     let tools:string[]=[],locks:any[]=[];try{tools=JSON.parse(row.required_tools_json||'[]')}catch{}try{locks=JSON.parse(row.resource_locks_json||'[]')}catch{}
     const uncertain=tools.some(t=>UNSAFE_TOOLS.has(t))||locks.some(l=>l?.mode==='write'||l?.mode==='exclusive')||row.resume_state==='running_tool_side_effect';
     this.db.prepare(`UPDATE step_attempts SET status='failed',ended_at=?,error_json=? WHERE id=?`).run(recoveredAt,json({code:uncertain?'DURABLE_SIDE_EFFECT_UNCERTAIN':'RUN_INTERRUPTED_RETRYABLE'}),row.attempt_id);
     if(uncertain){this.db.prepare(`UPDATE execution_steps SET status='blocked',resume_state='blocked_manual_review',updated_at=? WHERE id=?`).run(recoveredAt,row.step_id);manualReview++}
     else{this.db.prepare(`UPDATE execution_steps SET status='queued',resume_state='queued',updated_at=? WHERE id=?`).run(recoveredAt,row.step_id);retryable++}
    }
    createExecutionCheckpoint(this.db,plan.id,'runtime_recovery');
    new ActivityRepository(this.db).append({project_id:plan.project_id,type:'run.recovered',severity:'warning',title:'Execução V3 recuperada após reinício',detail:manualReview?'Side effects incertos foram bloqueados para revisão manual.':'Steps interrompidos e seguros foram recolocados na fila.',payload:{plan_id:plan.id,recovered_at:recoveredAt}});
    recovered++;
   }
  });
  tx();
  return{recovered_plans:recovered,retryable_steps:retryable,manual_review_steps:manualReview};
 }
 enqueueCommand(planId:string,type:'orient'|'enqueue_message'|'cancel'|'request_replan',payload:Record<string,unknown>={}){
  if(!this.db.prepare('SELECT 1 FROM execution_plans WHERE id=?').get(planId))throw new Error('EXECUTION_PLAN_NOT_FOUND');
  const commandId=id();this.db.prepare('INSERT INTO execution_commands(id,plan_id,command_type,payload_json,status,created_at)VALUES(?,?,?,?,\'pending\',?)').run(commandId,planId,type,json(payload),now());return{command_id:commandId,status:'pending'};
 }
 requestReplan(planId:string,reason:string,triggerType:string){
  const plan=this.db.prepare('SELECT budget_json,replan_count,status FROM execution_plans WHERE id=?').get(planId) as any;if(!plan)throw new Error('EXECUTION_PLAN_NOT_FOUND');if(['completed','cancelled','superseded'].includes(plan.status))throw new Error('REPLAN_PLAN_TERMINAL');
  let budget:any={};try{budget=JSON.parse(plan.budget_json||'{}')}catch{}const max=Math.max(0,Number(budget.max_replans??3));if(Number(plan.replan_count)>=max)throw new Error('REPLAN_LIMIT_EXCEEDED');
  const normalized=reason.trim().toLowerCase().replace(/\s+/g,' '),fingerprint=crypto.createHash('sha256').update(`${triggerType}:${normalized}`).digest('hex');
  const repeats=(this.db.prepare(`SELECT COUNT(*) n FROM replan_requests WHERE plan_id=? AND fingerprint=? AND status IN ('committed','blocked')`).get(planId,fingerprint) as any).n;
  const status=repeats>=2?'blocked':'pending',requestId=id();this.db.prepare('INSERT INTO replan_requests(id,plan_id,fingerprint,reason,trigger_type,status,created_at)VALUES(?,?,?,?,?,?,?)').run(requestId,planId,fingerprint,reason,triggerType,status,now());
  if(status==='blocked')return{request_id:requestId,status,reason:'repeated_reason'};
  createExecutionCheckpoint(this.db,planId,'replan_requested');return{request_id:requestId,status};
 }
 commitReplan(requestId:string,draft:PlanDraft){
  const req=this.db.prepare(`SELECT r.*,p.project_id,p.version,p.replan_count,p.orchestration_run_id FROM replan_requests r JOIN execution_plans p ON p.id=r.plan_id WHERE r.id=?`).get(requestId) as any;
  if(!req)throw new Error('REPLAN_REQUEST_NOT_FOUND');if(req.status!=='pending')throw new Error('REPLAN_REQUEST_NOT_PENDING');if(draft.project_id!==req.project_id)throw new Error('REPLAN_PROJECT_MISMATCH');
  const tx=this.db.transaction(()=>{
   createExecutionCheckpoint(this.db,req.plan_id,'before_replan_commit');
   const next=new ExecutionGraphService(this.db).createValidated({...draft,orchestration_run_id:draft.orchestration_run_id??req.orchestration_run_id});
   this.db.prepare('UPDATE execution_plans SET version=?,parent_plan_id=?,replan_count=?,updated_at=? WHERE id=?').run(Number(req.version)+1,req.plan_id,Number(req.replan_count)+1,now(),next.id);
   const oldCompleted=this.db.prepare(`SELECT id,key,goal FROM execution_steps WHERE plan_id=? AND status='completed'`).all(req.plan_id) as any[];
   for(const old of oldCompleted){const fresh=this.db.prepare('SELECT id,goal FROM execution_steps WHERE plan_id=? AND key=?').get(next.id,old.key) as any;if(!fresh||fresh.goal!==old.goal)continue;this.db.prepare(`UPDATE execution_steps SET status='completed',resume_state='completed',updated_at=? WHERE id=?`).run(now(),fresh.id);const artifacts=this.db.prepare('SELECT type,uri,payload_json,created_at FROM execution_artifacts WHERE plan_id=? AND step_id=?').all(req.plan_id,old.id) as any[];for(const a of artifacts)this.db.prepare('INSERT INTO execution_artifacts(id,plan_id,step_id,type,uri,payload_json,created_at)VALUES(?,?,?,?,?,?,?)').run(id(),next.id,fresh.id,a.type,a.uri,a.payload_json,a.created_at)}
   this.db.prepare(`UPDATE execution_plans SET status='superseded',updated_at=? WHERE id=?`).run(now(),req.plan_id);
   this.db.prepare(`UPDATE replan_requests SET status='committed',proposed_plan_id=?,resolved_at=? WHERE id=?`).run(next.id,now(),requestId);
   createExecutionCheckpoint(this.db,next.id,'replan_committed');
   new ActivityRepository(this.db).append({project_id:req.project_id,type:'plan.updated',title:'Plano atualizado',detail:'Um novo plano versionado foi criado sem apagar o histórico anterior.',payload:{previous_plan_id:req.plan_id,plan_id:next.id,version:Number(req.version)+1}});
   return new ExecutionGraphService(this.db).getPlan(next.id);
  });
  return tx();
 }
 markWaitingProvider(stepId:string){
  const row=this.db.prepare('SELECT plan_id FROM execution_steps WHERE id=?').get(stepId) as any;if(!row)throw new Error('EXECUTION_STEP_NOT_FOUND');
  this.db.prepare(`UPDATE execution_steps SET status='blocked',resume_state='waiting_provider',updated_at=? WHERE id=?`).run(now(),stepId);createExecutionCheckpoint(this.db,row.plan_id,'provider_waiting');
 }
 resumeProvider(stepId:string){
  const row=this.db.prepare(`SELECT s.plan_id,a.enabled agent_enabled,p.enabled provider_enabled,m.enabled model_enabled FROM execution_steps s LEFT JOIN agents a ON a.id=s.assigned_agent_id LEFT JOIN providers p ON p.id=a.provider_id LEFT JOIN provider_models m ON m.id=a.model_id WHERE s.id=?`).get(stepId) as any;if(!row)throw new Error('EXECUTION_STEP_NOT_FOUND');if(!row.agent_enabled||!row.provider_enabled||!row.model_enabled)return false;
  this.db.prepare(`UPDATE execution_steps SET status='queued',resume_state='queued',updated_at=? WHERE id=? AND resume_state='waiting_provider'`).run(now(),stepId);createExecutionCheckpoint(this.db,row.plan_id,'provider_resumed');return true;
 }
 manualReviewResolve(stepId:string,action:'retry'|'cancel'){
  const row=this.db.prepare('SELECT plan_id,resume_state FROM execution_steps WHERE id=?').get(stepId) as any;if(!row)throw new Error('EXECUTION_STEP_NOT_FOUND');if(row.resume_state!=='blocked_manual_review')throw new Error('EXECUTION_STEP_NOT_MANUAL_REVIEW');
  this.db.prepare('UPDATE execution_steps SET status=?,resume_state=?,updated_at=? WHERE id=?').run(action==='retry'?'queued':'cancelled',action==='retry'?'queued':'cancelled',now(),stepId);createExecutionCheckpoint(this.db,row.plan_id,'manual_review_resolved');
 }
}
