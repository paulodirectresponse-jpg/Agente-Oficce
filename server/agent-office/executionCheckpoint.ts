import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
const now=()=>new Date().toISOString();
export function createExecutionCheckpoint(db:Database,planId:string,reason:string){
 const plan=db.prepare('SELECT id,project_id,version,status,replan_count FROM execution_plans WHERE id=?').get(planId) as any;
 if(!plan)throw new Error('EXECUTION_PLAN_NOT_FOUND');
 const steps=db.prepare('SELECT id,key,status,resume_state FROM execution_steps WHERE plan_id=? ORDER BY key').all(planId) as any[];
 const attempts=db.prepare(`SELECT a.id,a.step_id,a.attempt_number,a.status FROM step_attempts a JOIN execution_steps s ON s.id=a.step_id WHERE s.plan_id=? ORDER BY a.step_id,a.attempt_number`).all(planId) as any[];
 const approvals=db.prepare(`SELECT id,status,execution_step_id,tool_invocation_id FROM tool_approvals WHERE execution_plan_id=? AND status IN ('pending','approved') ORDER BY created_at`).all(planId) as any[];
 const locks=db.prepare(`SELECT id,resource_key,mode,owner_step_id,status FROM resource_locks WHERE project_id=? AND status='active' ORDER BY resource_key`).all(plan.project_id) as any[];
 const artifacts=db.prepare('SELECT id,step_id,type,uri FROM execution_artifacts WHERE plan_id=? ORDER BY created_at').all(planId) as any[];
 const teamSnapshots=(db.prepare('SELECT id,step_id,team_kind,team_id,team_version_id,snapshot_json FROM execution_team_snapshots WHERE plan_id=? ORDER BY step_id').all(planId) as any[]).map(r=>({...r,snapshot:JSON.parse(r.snapshot_json||'{}')}));
 const delegations=(db.prepare(`SELECT id,step_id,team_kind,team_id,parent_agent_id,child_agent_id,ancestor_chain_json,depth,delegation_scope_json,status,budget_snapshot_json FROM runtime_delegations WHERE plan_id=? ORDER BY created_at`).all(planId) as any[]).map(r=>({...r,ancestor_chain:JSON.parse(r.ancestor_chain_json||'[]'),delegation_scope:JSON.parse(r.delegation_scope_json||'[]'),budget_snapshot:JSON.parse(r.budget_snapshot_json||'{}')}));
 const usageRows=db.prepare(`SELECT a.usage_json FROM step_attempts a JOIN execution_steps s ON s.id=a.step_id WHERE s.plan_id=?`).all(planId) as any[];
 const consumed=usageRows.reduce((a,r)=>{let u:any={};try{u=JSON.parse(r.usage_json||'{}')}catch{}a.cost_usd+=Number(u.cost_usd||0);a.tokens+=Number(u.tokens||0);a.tool_calls+=Number(u.tool_calls||0);return a},{cost_usd:0,tokens:0,tool_calls:0});
 const snapshot={plan:{id:plan.id,version:plan.version,status:plan.status,replan_count:plan.replan_count},steps,attempts,pending_approvals:approvals,locks,consumed_budgets:consumed,artifact_refs:artifacts,team_snapshots:teamSnapshots,delegations,last_event_sequence:null};
 const tx=db.transaction(()=>{const row=db.prepare('SELECT COALESCE(MAX(sequence),0)+1 next FROM execution_checkpoints WHERE plan_id=?').get(planId) as any;const checkpointId=crypto.randomUUID(),createdAt=now();db.prepare('INSERT INTO execution_checkpoints(id,plan_id,sequence,reason,snapshot_json,created_at)VALUES(?,?,?,?,?,?)').run(checkpointId,planId,row.next,reason,JSON.stringify(snapshot),createdAt);db.prepare(`INSERT INTO activity_events(id,project_id,conversation_id,run_id,agent_id,type,severity,title,detail,payload_json,created_at)VALUES(?,?,NULL,NULL,NULL,'checkpoint.created','info','Checkpoint criado','Estado durável da execução persistido.',?,?)`).run(crypto.randomUUID(),plan.project_id,JSON.stringify({plan_id:planId,checkpoint_id:checkpointId,sequence:Number(row.next),reason}),createdAt);return{checkpoint_id:checkpointId,sequence:Number(row.next),snapshot}});
 return tx.immediate();
}
