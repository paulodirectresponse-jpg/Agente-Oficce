import { Router } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { AnalyticsService, type AnalyticsRange } from '../agent-office/analyticsService.js';

export const v3AnalyticsRouter = Router();

v3AnalyticsRouter.get('/analytics', (req,res) => {
  const db=openAgentOfficeDatabase();
  try {
    const range=String(req.query.range??'7d') as AnalyticsRange;
    if(!['24h','7d','30d','all','custom'].includes(range)) {
      res.status(400).json({ok:false,error:{code:'ANALYTICS_RANGE_INVALID',message:'ANALYTICS_RANGE_INVALID'}});return;
    }
    const data=new AnalyticsService(db.connection).snapshot({
      range,
      from:typeof req.query.from==='string'?req.query.from:null,
      to:typeof req.query.to==='string'?req.query.to:null,
      project_id:typeof req.query.project_id==='string'&&req.query.project_id?req.query.project_id:null,
      agent_id:typeof req.query.agent_id==='string'&&req.query.agent_id?req.query.agent_id:null,
      subagent_id:typeof req.query.subagent_id==='string'&&req.query.subagent_id?req.query.subagent_id:null,
      provider_id:typeof req.query.provider_id==='string'&&req.query.provider_id?req.query.provider_id:null,
      model_id:typeof req.query.model_id==='string'&&req.query.model_id?req.query.model_id:null,
    });
    res.json({ok:true,data});
  } catch(e) {
    const code=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'ANALYTICS_FAILED';
    res.status(code.endsWith('_NOT_FOUND')?404:400).json({ok:false,error:{code,message:code}});
  } finally { db.connection.close(); }
});
