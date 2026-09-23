import { Router } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { WorkspaceService } from '../agent-office/workspaceService.js';
import { PreviewService } from '../agent-office/previewService.js';
import { chatRunControls } from '../agent-office/runtimeControls.js';

export const v3WorkspaceRouter=Router();
const code=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'WORKSPACE_FAILED';
const status=(c:string)=>c.endsWith('_NOT_FOUND')?404:c.includes('OUTSIDE')||c.includes('TOO_LARGE')||c.includes('INVALID')||c.includes('REQUIRED')?400:500;
function withDb(res:any,fn:(db:any)=>unknown){const db=openAgentOfficeDatabase();try{return fn(db.connection)}finally{db.connection.close()}}

v3WorkspaceRouter.get('/projects/:projectId/snapshot',(req,res)=>{try{const data=withDb(res,db=>new WorkspaceService(db).snapshot(req.params.projectId));res.json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}});
v3WorkspaceRouter.get('/projects/:projectId/files',(req,res)=>{try{const data=withDb(res,db=>new WorkspaceService(db).files(req.params.projectId,typeof req.query.path==='string'?req.query.path:'.'));res.json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}});
v3WorkspaceRouter.get('/projects/:projectId/file',(req,res)=>{try{const p=String(req.query.path||'');const data=withDb(res,db=>new WorkspaceService(db).file(req.params.projectId,p));res.json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}});
v3WorkspaceRouter.get('/projects/:projectId/git/status',(req,res)=>{try{const data=withDb(res,db=>new WorkspaceService(db).gitStatus(req.params.projectId));res.json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}});
v3WorkspaceRouter.get('/projects/:projectId/git/diff',(req,res)=>{try{const file=typeof req.query.path==='string'?req.query.path:undefined;const data=withDb(res,db=>new WorkspaceService(db).gitDiff(req.params.projectId,file));res.json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}});
v3WorkspaceRouter.get('/projects/:projectId/runs',(req,res)=>{try{const data=withDb(res,db=>new WorkspaceService(db).listRuns(req.params.projectId));res.json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}});
v3WorkspaceRouter.get('/runs/:runId',(req,res)=>{try{const data=withDb(res,db=>new WorkspaceService(db).runInspection(req.params.runId));res.json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}});
v3WorkspaceRouter.get('/plans/:planId',(req,res)=>{try{const data=withDb(res,db=>new WorkspaceService(db).plan(req.params.planId));if(!data){res.status(404).json({ok:false,error:{code:'EXECUTION_PLAN_NOT_FOUND',message:'EXECUTION_PLAN_NOT_FOUND'}});return}res.json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}});

v3WorkspaceRouter.post('/projects/:projectId/commands',(req,res)=>{
  const db=openAgentOfficeDatabase();
  try{
    const type=req.body?.command_type;if(!['orient','enqueue','interrupt'].includes(type)){res.status(400).json({ok:false,error:{code:'WORKSPACE_COMMAND_INVALID',message:'WORKSPACE_COMMAND_INVALID'}});return}
    const message=String(req.body?.message||'').trim();if(!message){res.status(400).json({ok:false,error:{code:'WORKSPACE_COMMAND_MESSAGE_REQUIRED',message:'WORKSPACE_COMMAND_MESSAGE_REQUIRED'}});return}
    const service=new WorkspaceService(db.connection),snap=service.snapshot(req.params.projectId),runId=typeof req.body?.chat_run_id==='string'?req.body.chat_run_id:snap.active_run?.id??null,planId=typeof req.body?.execution_plan_id==='string'?req.body.execution_plan_id:snap.active_plan?.id??null;
    const data=service.queueCommand({project_id:req.params.projectId,chat_run_id:runId,execution_plan_id:planId,command_type:type,message,target:String(req.body?.target||'auto')});
    if(type==='interrupt'&&runId)chatRunControls.cancel(runId);
    res.status(201).json({ok:true,data});
  }catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}finally{db.connection.close()}
});

v3WorkspaceRouter.post('/commands/:commandId/dispatched',(req,res)=>{const db=openAgentOfficeDatabase();try{new WorkspaceService(db.connection).markCommand(req.params.commandId,'dispatched');res.json({ok:true,data:{id:req.params.commandId,status:'dispatched'}})}finally{db.connection.close()}});
v3WorkspaceRouter.post('/commands/:commandId/cancel',(req,res)=>{const db=openAgentOfficeDatabase();try{new WorkspaceService(db.connection).markCommand(req.params.commandId,'cancelled');res.json({ok:true,data:{id:req.params.commandId,status:'cancelled'}})}finally{db.connection.close()}});

v3WorkspaceRouter.get('/projects/:projectId/preview',(req,res)=>{const db=openAgentOfficeDatabase();try{res.json({ok:true,data:new PreviewService(db.connection).status(req.params.projectId)})}finally{db.connection.close()}});
v3WorkspaceRouter.get('/projects/:projectId/preview/logs',(req,res)=>{const db=openAgentOfficeDatabase();try{res.json({ok:true,data:new PreviewService(db.connection).logs(req.params.projectId)})}finally{db.connection.close()}});
v3WorkspaceRouter.post('/projects/:projectId/preview/start',async(req,res)=>{const db=openAgentOfficeDatabase();try{const data=await new PreviewService(db.connection).start(req.params.projectId,{chat_run_id:req.body?.chat_run_id??null,command:typeof req.body?.command==='string'?req.body.command:undefined});res.status(201).json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}finally{db.connection.close()}});
v3WorkspaceRouter.post('/projects/:projectId/preview/stop',async(req,res)=>{const db=openAgentOfficeDatabase();try{res.json({ok:true,data:await new PreviewService(db.connection).stop(req.params.projectId)})}finally{db.connection.close()}});
v3WorkspaceRouter.post('/projects/:projectId/preview/restart',async(req,res)=>{const db=openAgentOfficeDatabase();try{const data=await new PreviewService(db.connection).restart(req.params.projectId);res.json({ok:true,data})}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}})}finally{db.connection.close()}});
