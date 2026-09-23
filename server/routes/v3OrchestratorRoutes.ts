import { Router } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { OrchestratorGateway } from '../agent-office/orchestratorGateway.js';
import {
  UniversalOrchestratorLLM,
  getOrchestratorSettings,
  saveOrchestratorSettings,
  getOrchestratorStatus,
} from '../agent-office/orchestratorRuntime.js';

export const v3OrchestratorRouter = Router();

function parseRun(row:any){
  return {
    ...row,
    decision: row.decision_json ? JSON.parse(row.decision_json) : null,
    error: row.error_json ? JSON.parse(row.error_json) : null,
  };
}

v3OrchestratorRouter.get('/settings', (_req,res) => {
  const db=openAgentOfficeDatabase();
  try { res.json({ok:true,data:getOrchestratorSettings(db.connection)}); }
  finally { db.connection.close(); }
});

v3OrchestratorRouter.put('/settings', (req,res) => {
  const db=openAgentOfficeDatabase();
  try {
    res.json({ok:true,data:saveOrchestratorSettings(db.connection,req.body??{})});
  } catch(e) {
    const code=e instanceof Error?e.message:'ORCHESTRATOR_SETTINGS_SAVE_FAILED';
    res.status(400).json({ok:false,error:{code,message:code}});
  } finally { db.connection.close(); }
});

v3OrchestratorRouter.get('/status', (_req,res) => {
  const db=openAgentOfficeDatabase();
  try { res.json({ok:true,data:getOrchestratorStatus(db.connection)}); }
  finally { db.connection.close(); }
});

v3OrchestratorRouter.post('/route', async(req,res) => {
  const db=openAgentOfficeDatabase();
  try {
    const body=req.body??{},project=String(body.project_id||'');
    if(!db.connection.prepare('SELECT 1 FROM projects WHERE id=?').get(project)){
      res.status(404).json({ok:false,error:{code:'PROJECT_NOT_FOUND',message:'PROJECT_NOT_FOUND'}});return;
    }
    const gateway=new OrchestratorGateway(db.connection,new UniversalOrchestratorLLM(db.connection));
    const result=await gateway.route({
      project_id:project,
      conversation_id:typeof body.conversation_id==='string'?body.conversation_id:null,
      user_message_id:typeof body.user_message_id==='string'?body.user_message_id:null,
      message:String(body.message||''),
      target:typeof body.target==='string'?body.target:'auto',
      continuation_agent_id:typeof body.continuation_agent_id==='string'?body.continuation_agent_id:null,
    });
    res.json({ok:true,data:result});
  } catch(e) {
    const code=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'ORCHESTRATOR_ROUTE_FAILED';
    res.status(code.endsWith('UNAVAILABLE')?409:400).json({ok:false,error:{code,message:code}});
  } finally { db.connection.close(); }
});

v3OrchestratorRouter.get('/runs', (req,res) => {
  const db=openAgentOfficeDatabase();
  try {
    const limit=Math.max(1,Math.min(250,Number(req.query.limit)||100));
    const rows=db.connection.prepare(`SELECT o.*,p.name provider_name,m.model_id effective_model_id,m.display_name model_name FROM orchestration_runs o LEFT JOIN providers p ON p.id=o.provider_id LEFT JOIN provider_models m ON m.id=o.model_id ORDER BY o.created_at DESC LIMIT ?`).all(limit) as any[];
    res.json({ok:true,data:rows.map(parseRun)});
  } finally { db.connection.close(); }
});

v3OrchestratorRouter.get('/runs/:projectId', (req,res) => {
  const db=openAgentOfficeDatabase();
  try {
    const rows=db.connection.prepare(`SELECT o.*,p.name provider_name,m.model_id effective_model_id,m.display_name model_name FROM orchestration_runs o LEFT JOIN providers p ON p.id=o.provider_id LEFT JOIN provider_models m ON m.id=o.model_id WHERE o.project_id=? ORDER BY o.created_at DESC LIMIT 100`).all(req.params.projectId) as any[];
    res.json({ok:true,data:rows.map(parseRun)});
  } finally { db.connection.close(); }
});

v3OrchestratorRouter.get('/events', (req,res) => {
  const db=openAgentOfficeDatabase();
  try {
    const limit=Math.max(1,Math.min(500,Number(req.query.limit)||200));
    const rows=db.connection.prepare('SELECT * FROM orchestration_events ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
    res.json({ok:true,data:rows.map(row=>({...row,payload:row.payload_json?JSON.parse(row.payload_json):{}}))});
  } finally { db.connection.close(); }
});

v3OrchestratorRouter.get('/events/run/:runId', (req,res) => {
  const db=openAgentOfficeDatabase();
  try {
    const rows=db.connection.prepare('SELECT * FROM orchestration_events WHERE orchestration_run_id=? ORDER BY created_at ASC').all(req.params.runId) as any[];
    res.json({ok:true,data:rows.map(row=>({...row,payload:row.payload_json?JSON.parse(row.payload_json):{}}))});
  } finally { db.connection.close(); }
});
