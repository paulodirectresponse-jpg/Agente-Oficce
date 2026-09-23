import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { CapabilityMatcher, type CapabilityRequirement } from './capabilityCore.js';
import { TeamService, type TeamKind, emitTeamEvent } from './teamService.js';
import { AgentOperationsService } from './agentOperations.js';

const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const parse=<T>(v:string|undefined|null,f:T):T=>{try{return v?JSON.parse(v):f}catch{return f}};
const set=(v:unknown)=>new Set(Array.isArray(v)?v.filter(x=>typeof x==='string'):[]);
export interface PermissionLayers {
 user?:string[]; project?:string[]; team?:string[]; delegation?:string[]; agent?:string[]; tool?:string[];
}
export function intersectPermissions(layers:PermissionLayers){
 const present=Object.values(layers).filter((x):x is string[]=>Array.isArray(x));
 if(!present.length)return[];let out=new Set(present[0]);
 for(const layer of present.slice(1)){const allowed=new Set(layer);out=new Set([...out].filter(x=>allowed.has(x)))}
 return[...out].sort();
}
export interface DelegationRequest {
 plan_id:string; step_id?:string|null; team_kind?:TeamKind|null; team_id?:string|null;
 parent_agent_id?:string|null; child_agent_id:string; ancestor_chain?:string[];
 required_capabilities?:CapabilityRequirement[]; required_tools?:string[];
 delegation_scope?:string[]; user_permissions?:string[]; project_permissions?:string[];
 remaining_budget?:{agents?:number;cost_usd?:number;tokens?:number;tool_calls?:number};
}
export class DelegationService{
 private teams:TeamService;private matcher:CapabilityMatcher;
 constructor(private db:Database){this.teams=new TeamService(db);this.matcher=new CapabilityMatcher(db)}
 validate(req:DelegationRequest){
  const plan=this.db.prepare('SELECT project_id,budget_json,status FROM execution_plans WHERE id=?').get(req.plan_id) as any;if(!plan)throw new Error('EXECUTION_PLAN_NOT_FOUND');if(['completed','failed','cancelled','superseded'].includes(plan.status))throw new Error('DELEGATION_PLAN_TERMINAL');
  const child=this.db.prepare('SELECT id,enabled,paused FROM agents WHERE id=?').get(req.child_agent_id) as any;if(!child||!child.enabled)throw new Error('DELEGATION_AGENT_DISABLED');if(child.paused)throw new Error('DELEGATION_AGENT_PAUSED');if(!new AgentOperationsService(this.db).isEligible(req.child_agent_id))throw new Error('DELEGATION_AGENT_UNAVAILABLE');
  const chain=[...(req.ancestor_chain??[])];if(req.parent_agent_id&&!chain.includes(req.parent_agent_id))chain.push(req.parent_agent_id);if(chain.includes(req.child_agent_id))throw new Error('DELEGATION_CYCLE');
  this.assertEffectiveGraphAcyclic(req.parent_agent_id??null,req.child_agent_id,chain);
  let maxDepth=2,allowBorrow=false,teamPolicy:any={allowed_tools:[],permissions:[],delegation_permissions:[]},members:string[]=[];
  if(req.team_id){if(req.team_kind==='dynamic'){const team=this.teams.getDynamic(req.team_id);if(!team)throw new Error('DYNAMIC_TEAM_NOT_FOUND');maxDepth=team.max_delegation_depth;allowBorrow=team.allow_external_borrowing;teamPolicy=team.policy??{};members=team.members.filter((m:any)=>m.enabled).map((m:any)=>m.agent_id)}
   else{const team=this.teams.get(req.team_id);if(!team||!team.enabled)throw new Error('TEAM_NOT_FOUND');maxDepth=team.max_delegation_depth;allowBorrow=team.allow_external_borrowing;teamPolicy=team.policy??{};members=[...(team.owner_agent_id?[team.owner_agent_id]:[]),...team.members.filter((m:any)=>m.enabled).map((m:any)=>m.agent_id)]}
   if(!members.includes(req.child_agent_id)&&!allowBorrow)throw new Error('DELEGATION_EXTERNAL_BORROWING_DISABLED');
  }
  const depth=chain.length;if(depth>maxDepth)throw new Error('DELEGATION_DEPTH_EXCEEDED');
  const match=this.matcher.match(req.required_capabilities??[],req.required_tools??[]).find(x=>x.agent_id===req.child_agent_id);if(!match?.eligible)throw new Error(match?.blockers.some(x=>x.startsWith('tool:'))?'DELEGATION_TOOL_MISMATCH':'DELEGATION_CAPABILITY_MISMATCH');
  const agentPolicy=this.db.prepare('SELECT enabled,allowed_tools_json FROM agent_tool_policies WHERE agent_id=?').get(req.child_agent_id) as any;
  if((req.required_tools??[]).some(t=>!agentPolicy?.enabled||!set(parse(agentPolicy.allowed_tools_json,[])).has(t)))throw new Error('DELEGATION_TOOL_MISMATCH');
  if(req.team_id&&(req.required_tools??[]).some(t=>!Array.isArray(teamPolicy.allowed_tools)||!teamPolicy.allowed_tools.includes(t)))throw new Error('DELEGATION_TEAM_TOOL_BLOCKED');
  const remaining=req.remaining_budget??{};if(remaining.agents!==undefined&&remaining.agents<=0)throw new Error('DELEGATION_BUDGET_EXHAUSTED');if(remaining.cost_usd!==undefined&&remaining.cost_usd<=0)throw new Error('DELEGATION_BUDGET_EXHAUSTED');if(remaining.tokens!==undefined&&remaining.tokens<=0)throw new Error('DELEGATION_BUDGET_EXHAUSTED');if(remaining.tool_calls!==undefined&&remaining.tool_calls<(req.required_tools?.length??0))throw new Error('DELEGATION_BUDGET_EXHAUSTED');
  const agentMeta=parse<any>((this.db.prepare('SELECT metadata_json FROM agents WHERE id=?').get(req.child_agent_id) as any)?.metadata_json,{});
  const effective=intersectPermissions({user:req.user_permissions??[],project:req.project_permissions??[],team:teamPolicy.permissions??[],delegation:req.delegation_scope??[],agent:Array.isArray(agentMeta.permissions)?agentMeta.permissions:[]});
  return{allowed:true,depth,max_depth:maxDepth,external_borrowed:Boolean(req.team_id&&!members.includes(req.child_agent_id)),effective_permissions:effective,ancestor_chain:chain};
 }
 delegate(req:DelegationRequest){
  let checked:ReturnType<DelegationService['validate']>;try{checked=this.validate(req)}catch(error){const plan=this.db.prepare('SELECT project_id FROM execution_plans WHERE id=?').get(req.plan_id) as any;if(plan)emitTeamEvent(this.db,plan.project_id,'delegation.blocked','Delegação bloqueada',{plan_id:req.plan_id,step_id:req.step_id,team_id:req.team_id,parent_agent_id:req.parent_agent_id,child_agent_id:req.child_agent_id,code:error instanceof Error?error.message:'DELEGATION_BLOCKED'},req.child_agent_id);throw error}const tx=this.db.transaction(()=>{
   if(req.team_id){const limit=req.team_kind==='dynamic'?(this.teams.getDynamic(req.team_id)?.max_parallelism??1):(this.teams.get(req.team_id)?.max_parallelism??1);const active=(this.db.prepare(`SELECT COUNT(*) n FROM runtime_delegations WHERE plan_id=? AND team_id=? AND status='active'`).get(req.plan_id,req.team_id) as any).n;if(active>=limit)throw new Error('DELEGATION_TEAM_PARALLELISM_EXCEEDED')}
   const dId=id();this.db.prepare(`INSERT INTO runtime_delegations(id,plan_id,step_id,team_kind,team_id,parent_agent_id,child_agent_id,ancestor_chain_json,depth,delegation_scope_json,required_capabilities_json,required_tools_json,status,budget_snapshot_json,created_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`).run(dId,req.plan_id,req.step_id??null,req.team_kind??null,req.team_id??null,req.parent_agent_id??null,req.child_agent_id,JSON.stringify(checked.ancestor_chain),checked.depth,JSON.stringify(req.delegation_scope??[]),JSON.stringify(req.required_capabilities??[]),JSON.stringify(req.required_tools??[]),JSON.stringify(req.remaining_budget??{}),now());
   const project=(this.db.prepare('SELECT project_id FROM execution_plans WHERE id=?').get(req.plan_id) as any).project_id;emitTeamEvent(this.db,project,'agent.delegated','Agente delegado',{delegation_id:dId,plan_id:req.plan_id,step_id:req.step_id,team_id:req.team_id,parent_agent_id:req.parent_agent_id,child_agent_id:req.child_agent_id,depth:checked.depth,external_borrowed:checked.external_borrowed},req.child_agent_id);return{id:dId,...checked};
  });return tx.immediate();
 }
 returned(delegationId:string){
  const row=this.db.prepare(`SELECT d.*,p.project_id FROM runtime_delegations d JOIN execution_plans p ON p.id=d.plan_id WHERE d.id=?`).get(delegationId) as any;if(!row)throw new Error('DELEGATION_NOT_FOUND');if(row.status!=='active')throw new Error('DELEGATION_NOT_ACTIVE');
  this.db.prepare(`UPDATE runtime_delegations SET status='returned',returned_at=? WHERE id=?`).run(now(),delegationId);emitTeamEvent(this.db,row.project_id,'agent.returned','Agente retornou',{delegation_id:delegationId,plan_id:row.plan_id,team_id:row.team_id,child_agent_id:row.child_agent_id},row.child_agent_id);return true;
 }
 private assertEffectiveGraphAcyclic(parent:string|null,child:string,chain:string[]){
  if(!parent)return;const edges=new Map<string,Set<string>>(),add=(a:string,b:string)=>{if(!edges.has(a))edges.set(a,new Set());edges.get(a)!.add(b)};
  for(const r of this.db.prepare(`SELECT parent_agent_id,child_agent_id FROM agent_relations WHERE enabled=1`).all() as any[])add(r.parent_agent_id,r.child_agent_id);
  for(const t of this.db.prepare(`SELECT COALESCE(owner_agent_id,lead_agent_id) lead_agent_id,id FROM teams WHERE enabled=1 AND COALESCE(owner_agent_id,lead_agent_id) IS NOT NULL`).all() as any[]){for(const m of this.db.prepare(`SELECT agent_id FROM team_members WHERE team_id=? AND enabled=1`).all(t.id) as any[])if(m.agent_id!==t.lead_agent_id)add(t.lead_agent_id,m.agent_id)}
  for(const t of this.db.prepare(`SELECT lead_agent_id,id FROM dynamic_team_instances WHERE status='active' AND lead_agent_id IS NOT NULL`).all() as any[]){for(const m of this.db.prepare(`SELECT agent_id FROM dynamic_team_members WHERE dynamic_team_id=? AND enabled=1`).all(t.id) as any[])if(m.agent_id!==t.lead_agent_id)add(t.lead_agent_id,m.agent_id)}
  for(const d of this.db.prepare(`SELECT parent_agent_id,child_agent_id FROM runtime_delegations WHERE status='active' AND parent_agent_id IS NOT NULL`).all() as any[])add(d.parent_agent_id,d.child_agent_id);
  add(parent,child);for(let i=0;i<chain.length-1;i++)add(chain[i],chain[i+1]);
  const visiting=new Set<string>(),visited=new Set<string>();const dfs=(n:string):boolean=>{if(visiting.has(n))return true;if(visited.has(n))return false;visiting.add(n);for(const x of edges.get(n)??[])if(dfs(x))return true;visiting.delete(n);visited.add(n);return false};for(const n of edges.keys())if(dfs(n))throw new Error('DELEGATION_CYCLE');
 }
}
