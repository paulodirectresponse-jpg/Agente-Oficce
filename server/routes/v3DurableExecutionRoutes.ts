import { Router } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { DurableExecutionService } from '../agent-office/durableExecution.js';

export const v3DurableExecutionRouter=Router();
const code=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'DURABLE_EXECUTION_FAILED';
const status=(c:string)=>c.endsWith('_NOT_FOUND')?404:c.includes('TERMINAL')||c.includes('LIMIT')||c.includes('NOT_PENDING')?409:400;

v3DurableExecutionRouter.get('/plans/:planId/checkpoints',(req,res)=>{const db=openAgentOfficeDatabase();try{const rows=db.connection.prepare('SELECT id,plan_id,sequence,reason,snapshot_json,created_at FROM execution_checkpoints WHERE plan_id=? ORDER BY sequence DESC LIMIT 100').all(req.params.planId) as any[];res.json({ok:true,data:rows.map(r=>({...r,snapshot:JSON.parse(r.snapshot_json)}))})}finally{db.connection.close()}});

v3DurableExecutionRouter.post('/plans/:planId/commands',(req,res)=>{const db=openAgentOfficeDatabase();try{const type=req.body?.type;if(!['orient','enqueue_message','cancel','request_replan'].includes(type)){res.status(400).json({ok:false,error:{code:'EXECUTION_COMMAND_INVALID',message:'EXECUTION_COMMAND_INVALID'}});return}const data=new DurableExecutionService(db.connection).enqueueCommand(req.params.planId,type,req.body?.payload&&typeof req.body.payload==='object'?req.body.payload:{});res.status(201).json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}finally{db.connection.close()}});

v3DurableExecutionRouter.get('/plans/:planId/commands',(req,res)=>{const db=openAgentOfficeDatabase();try{const rows=db.connection.prepare('SELECT * FROM execution_commands WHERE plan_id=? ORDER BY created_at').all(req.params.planId) as any[];res.json({ok:true,data:rows.map(r=>({...r,payload:JSON.parse(r.payload_json||'{}')}))})}finally{db.connection.close()}});

v3DurableExecutionRouter.post('/plans/:planId/replans',(req,res)=>{const db=openAgentOfficeDatabase();try{const data=new DurableExecutionService(db.connection).requestReplan(req.params.planId,String(req.body?.reason||''),String(req.body?.trigger_type||'user_orientation'));res.status(201).json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}finally{db.connection.close()}});

v3DurableExecutionRouter.post('/replans/:requestId/commit',(req,res)=>{const db=openAgentOfficeDatabase();try{const data=new DurableExecutionService(db.connection).commitReplan(req.params.requestId,req.body?.plan??req.body);res.json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}finally{db.connection.close()}});

v3DurableExecutionRouter.post('/steps/:stepId/provider-resume',(req,res)=>{const db=openAgentOfficeDatabase();try{const resumed=new DurableExecutionService(db.connection).resumeProvider(req.params.stepId);res.json({ok:true,data:{resumed}})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}finally{db.connection.close()}});

v3DurableExecutionRouter.post('/steps/:stepId/manual-review',(req,res)=>{const db=openAgentOfficeDatabase();try{const action=req.body?.action==='cancel'?'cancel':req.body?.action==='retry'?'retry':null;if(!action){res.status(400).json({ok:false,error:{code:'MANUAL_REVIEW_ACTION_INVALID',message:'MANUAL_REVIEW_ACTION_INVALID'}});return}new DurableExecutionService(db.connection).manualReviewResolve(req.params.stepId,action);res.json({ok:true,data:{step_id:req.params.stepId,action}})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}finally{db.connection.close()}});
