import { Router } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { DelegationService } from '../agent-office/delegationService.js';
import { TeamService } from '../agent-office/teamService.js';

export const v3TeamsRouter=Router();
const code=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'TEAM_REQUEST_FAILED';
const status=(c:string)=>c.endsWith('_NOT_FOUND')?404:c.includes('DUPLICATE')||c.includes('PARALLELISM')||c.includes('REQUIRES_EXPLICIT')?409:400;
function withDb(res:any,fn:(db:any)=>unknown){const d=openAgentOfficeDatabase();try{return fn(d.connection)}catch(e){const c=code(e);res.status(status(c)).json({ok:false,error:{code:c,message:c}});return undefined}finally{d.connection.close()}}

v3TeamsRouter.get('/teams',(_req,res)=>withDb(res,db=>res.json({ok:true,data:new TeamService(db).list()})));
v3TeamsRouter.post('/teams',(req,res)=>withDb(res,db=>{
 const body=req.body??{},owner=String(body.owner_agent_id||'');
 if(!owner){res.status(400).json({ok:false,error:{code:'TEAM_OWNER_REQUIRED',message:'TEAM_OWNER_REQUIRED'}});return}
 res.status(201).json({ok:true,data:new TeamService(db).createOwnedTeam(owner,body,'user:api')})
}));
v3TeamsRouter.get('/teams/:id',(req,res)=>withDb(res,db=>{const x=new TeamService(db).get(req.params.id);if(!x){res.status(404).json({ok:false,error:{code:'TEAM_NOT_FOUND',message:'TEAM_NOT_FOUND'}});return}res.json({ok:true,data:x})}));
v3TeamsRouter.patch('/teams/:id',(req,res)=>withDb(res,db=>res.json({ok:true,data:new TeamService(db).update(req.params.id,req.body??{})})));
v3TeamsRouter.delete('/teams/:id',(req,res)=>withDb(res,db=>res.json({ok:true,data:new TeamService(db).disable(req.params.id)})));
v3TeamsRouter.get('/teams/:id/members',(req,res)=>withDb(res,db=>res.json({ok:true,data:new TeamService(db).listMembers(req.params.id)})));
v3TeamsRouter.put('/teams/:id/members',(req,res)=>withDb(res,db=>res.json({ok:true,data:new TeamService(db).replaceMembers(req.params.id,Array.isArray(req.body?.members)?req.body.members:[])})));
v3TeamsRouter.get('/teams/:id/capabilities',(req,res)=>withDb(res,db=>res.json({ok:true,data:new TeamService(db).capabilities(req.params.id)})));
v3TeamsRouter.get('/teams/:id/versions',(req,res)=>withDb(res,db=>res.json({ok:true,data:new TeamService(db).versions(req.params.id)})));
v3TeamsRouter.get('/agents/:agentId/team',(req,res)=>withDb(res,db=>res.json({ok:true,data:new TeamService(db).getOwnedByAgent(req.params.agentId)})));
v3TeamsRouter.post('/agents/:agentId/team',(req,res)=>withDb(res,db=>res.status(201).json({ok:true,data:new TeamService(db).createOwnedTeam(req.params.agentId,req.body??{},'user:api')})));
v3TeamsRouter.put('/agents/:agentId/team/subagents',(req,res)=>withDb(res,db=>{
 const svc=new TeamService(db),team=svc.getOwnedByAgent(req.params.agentId);if(!team){res.status(404).json({ok:false,error:{code:'TEAM_NOT_FOUND',message:'TEAM_NOT_FOUND'}});return}
 res.json({ok:true,data:svc.replaceMembers(team.id,Array.isArray(req.body?.members)?req.body.members:[])})
}));
v3TeamsRouter.get('/agents/:agentId/teams',(req,res)=>withDb(res,db=>res.json({ok:true,data:new TeamService(db).listAgentTeams(req.params.agentId)})));

v3TeamsRouter.get('/teams/:id/room',(req,res)=>withDb(res,db=>res.json({ok:true,data:new TeamService(db).getRoom(req.params.id)})));
v3TeamsRouter.patch('/teams/:id/room',(req,res)=>withDb(res,db=>res.json({ok:true,data:new TeamService(db).updateRoom(req.params.id,req.body??{})})));
v3TeamsRouter.post('/teams/:id/room/entries',(req,res)=>withDb(res,db=>res.status(201).json({ok:true,data:new TeamService(db).appendRoomEntry(req.params.id,req.body??{})})));

v3TeamsRouter.get('/workforces',(req,res)=>withDb(res,db=>res.json({ok:true,data:new TeamService(db).listWorkforces(Number(req.query.limit)||100)})));
v3TeamsRouter.post('/workforces',(req,res)=>withDb(res,db=>res.status(201).json({ok:true,data:new TeamService(db).createWorkforce(req.body??{})})));
v3TeamsRouter.get('/workforces/:id',(req,res)=>withDb(res,db=>{const x=new TeamService(db).getWorkforce(req.params.id);if(!x){res.status(404).json({ok:false,error:{code:'WORKFORCE_NOT_FOUND',message:'WORKFORCE_NOT_FOUND'}});return}res.json({ok:true,data:x})}));

v3TeamsRouter.post('/dynamic-teams',(req,res)=>withDb(res,db=>res.status(201).json({ok:true,data:new TeamService(db).createDynamic(req.body??{})})));
v3TeamsRouter.get('/dynamic-teams/:id',(req,res)=>withDb(res,db=>{const x=new TeamService(db).getDynamic(req.params.id);if(!x){res.status(404).json({ok:false,error:{code:'DYNAMIC_TEAM_NOT_FOUND',message:'DYNAMIC_TEAM_NOT_FOUND'}});return}res.json({ok:true,data:x})}));

v3TeamsRouter.post('/delegations/validate',(req,res)=>withDb(res,db=>res.json({ok:true,data:new DelegationService(db).validate(req.body??{})})));
v3TeamsRouter.post('/delegations',(req,res)=>withDb(res,db=>res.status(201).json({ok:true,data:new DelegationService(db).delegate(req.body??{})})));
v3TeamsRouter.post('/delegations/:id/return',(req,res)=>withDb(res,db=>res.json({ok:true,data:{returned:new DelegationService(db).returned(req.params.id)}})));
