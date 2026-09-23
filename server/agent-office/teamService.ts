import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { CapabilityRepository, type CapabilityRequirement } from './capabilityCore.js';
import { ActivityRepository } from './v2DataModel.js';
import { AgentOperationsService } from './agentOperations.js';

export type TeamType='permanent'|'system';
export type TeamKind='permanent'|'dynamic';
export interface TeamPolicyInput {
  allowed_tools?: string[];
  permissions?: string[];
  delegation_permissions?: string[];
  approval_mode?: 'safe'|'manual'|'auto';
  budget_defaults?: Record<string,number>;
  metadata?: Record<string,unknown>;
}
export interface TeamInput {
  name:string; slug:string; purpose?:string; type?:TeamType; owner_agent_id?:string|null; lead_agent_id?:string|null;
  enabled?:boolean; max_parallelism?:number; max_delegation_depth?:number;
  allow_external_borrowing?:boolean; proposal_policy?:'manual'|'approval_required'|'disabled';
  metadata?:Record<string,unknown>; policy?:TeamPolicyInput;
}
export interface TeamMemberInput {agent_id:string;role_name?:string;priority?:number;enabled?:boolean;metadata?:Record<string,unknown>}
export interface DynamicTeamInput {
  orchestration_run_id?:string|null; execution_plan_id?:string|null; purpose?:string; lead_agent_id?:string|null;
  member_ids:string[]; max_parallelism?:number; max_delegation_depth?:number; allow_external_borrowing?:boolean; policy?:TeamPolicyInput;
}
const id=()=>crypto.randomUUID(), now=()=>new Date().toISOString();
const parse=<T>(v:string|undefined|null,f:T):T=>{try{return v?JSON.parse(v):f}catch{return f}};
const uniq=(v:unknown)=>[...new Set(Array.isArray(v)?v.filter(x=>typeof x==='string').map(x=>x.trim()).filter(Boolean):[])];
const SLUG=/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
function normalizePolicy(input:TeamPolicyInput={}){
 return {
  allowed_tools:uniq(input.allowed_tools),
  permissions:uniq(input.permissions),
  delegation_permissions:uniq(input.delegation_permissions),
  approval_mode:['safe','manual','auto'].includes(String(input.approval_mode))?input.approval_mode!:'safe',
  budget_defaults:input.budget_defaults&&typeof input.budget_defaults==='object'?input.budget_defaults:{},
  metadata:input.metadata&&typeof input.metadata==='object'?input.metadata:{},
 };
}
function enabledAgent(db:Database,agentId:string){
 return db.prepare(`SELECT a.id,a.enabled,p.enabled provider_enabled,m.enabled model_enabled
   FROM agents a LEFT JOIN providers p ON p.id=a.provider_id LEFT JOIN provider_models m ON m.id=a.model_id WHERE a.id=?`).get(agentId) as any;
}
export class TeamService {
 constructor(private db:Database,private caps=new CapabilityRepository(db)){}
 list(){return (this.db.prepare('SELECT * FROM teams ORDER BY name,id').all() as any[]).map(r=>this.hydrate(r))}
 get(teamId:string){const row=this.db.prepare('SELECT * FROM teams WHERE id=?').get(teamId) as any;return row?this.hydrate(row):null}
 getBySlug(slug:string){const row=this.db.prepare('SELECT * FROM teams WHERE slug=?').get(slug) as any;return row?this.hydrate(row):null}
 getOwnedByAgent(agentId:string){const row=this.db.prepare("SELECT * FROM teams WHERE owner_agent_id=? AND type='permanent' ORDER BY created_at LIMIT 1").get(agentId) as any;return row?this.hydrate(row):null}
 createOwnedTeam(ownerAgentId:string,input:Omit<TeamInput,'owner_agent_id'|'lead_agent_id'|'type'>,actor='user:manual'){
  this.validateOwner(ownerAgentId);if(this.getOwnedByAgent(ownerAgentId))throw new Error('AGENT_TEAM_ALREADY_EXISTS');
  return this.createPermanent({...input,owner_agent_id:ownerAgentId,lead_agent_id:ownerAgentId,type:'permanent'},actor);
 }
 getRoom(teamId:string){
  if(!this.get(teamId))throw new Error('TEAM_NOT_FOUND');this.ensureRoom(teamId);
  const room=this.db.prepare('SELECT * FROM team_rooms WHERE team_id=?').get(teamId) as any;
  const entries=(this.db.prepare('SELECT * FROM team_room_entries WHERE team_id=? ORDER BY created_at DESC LIMIT 100').all(teamId) as any[]).map(x=>({...x,payload:parse(x.payload_json,{})}));
  return{team_id:teamId,instructions:room.instructions,shared_context:parse(room.shared_context_json,{}),memory:parse(room.memory_json,{}),updated_at:room.updated_at,entries};
 }
 updateRoom(teamId:string,input:{instructions?:string;shared_context?:Record<string,unknown>;memory?:Record<string,unknown>}){
  if(!this.get(teamId))throw new Error('TEAM_NOT_FOUND');this.ensureRoom(teamId);const cur=this.getRoom(teamId);
  this.db.prepare('UPDATE team_rooms SET instructions=?,shared_context_json=?,memory_json=?,updated_at=? WHERE team_id=?').run(
   input.instructions===undefined?cur.instructions:String(input.instructions),
   JSON.stringify(input.shared_context??cur.shared_context),
   JSON.stringify(input.memory??cur.memory),
   now(),teamId
  );this.appendRoomEntry(teamId,{entry_type:'memory',content:'Contexto do Team Room atualizado.'});return this.getRoom(teamId);
 }
 appendRoomEntry(teamId:string,input:{agent_id?:string|null;entry_type?:string;content?:string;payload?:Record<string,unknown>}){
  if(!this.get(teamId))throw new Error('TEAM_NOT_FOUND');this.ensureRoom(teamId);
  const type=['activity','decision','memory','note','delegation','result'].includes(String(input.entry_type))?String(input.entry_type):'activity';
  const entry={id:id(),team_id:teamId,agent_id:input.agent_id??null,entry_type:type,content:String(input.content??''),payload:input.payload??{},created_at:now()};
  this.db.prepare('INSERT INTO team_room_entries(id,team_id,agent_id,entry_type,content,payload_json,created_at)VALUES(?,?,?,?,?,?,?)').run(entry.id,entry.team_id,entry.agent_id,entry.entry_type,entry.content,JSON.stringify(entry.payload),entry.created_at);return entry;
 }
 listWorkforces(limit=100){return (this.db.prepare('SELECT * FROM dynamic_team_instances ORDER BY created_at DESC LIMIT ?').all(Math.max(1,Math.min(250,limit))) as any[]).map(r=>this.getDynamic(r.id))}
 createWorkforce(input:DynamicTeamInput){return this.createDynamic(input)}
 getWorkforce(id:string){return this.getDynamic(id)}

 createPermanent(input:TeamInput,actor='user:manual'){
  const type=input.type??'permanent';if(type!=='permanent'&&type!=='system')throw new Error('TEAM_TYPE_INVALID');
  if(type==='permanent'&&!actor.startsWith('user:'))throw new Error('PERMANENT_TEAM_REQUIRES_EXPLICIT_USER_ACTION');
  const name=String(input.name||'').trim(),slug=String(input.slug||'').trim().toLowerCase();
  if(!name)throw new Error('TEAM_NAME_REQUIRED');if(!SLUG.test(slug))throw new Error('TEAM_SLUG_INVALID');
  if(input.owner_agent_id)this.validateOwner(input.owner_agent_id);
  else this.validateLead(input.lead_agent_id??null);
  if(input.owner_agent_id&&this.getOwnedByAgent(input.owner_agent_id))throw new Error('AGENT_TEAM_ALREADY_EXISTS');
  const teamId=id(),t=now(),policy=normalizePolicy(input.policy);
  const tx=this.db.transaction(()=>{
   this.db.prepare(`INSERT INTO teams(id,name,slug,purpose,type,owner_agent_id,lead_agent_id,enabled,max_parallelism,max_delegation_depth,allow_external_borrowing,proposal_policy,metadata_json,current_version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(teamId,name,slug,input.purpose??'',type,input.owner_agent_id??null,input.owner_agent_id??input.lead_agent_id??null,input.enabled===false?0:1,Math.max(1,Math.floor(input.max_parallelism??3)),Math.max(0,Math.floor(input.max_delegation_depth??2)),input.allow_external_borrowing?1:0,input.proposal_policy??'manual',JSON.stringify(input.metadata??{}),t,t);
   this.writePolicy(teamId,policy,t);this.ensureRoom(teamId,t);this.snapshot(teamId);
  });tx.immediate();return this.get(teamId)!;
 }
 update(teamId:string,input:Partial<TeamInput>){
  const current=this.get(teamId);if(!current)throw new Error('TEAM_NOT_FOUND');
  if(input.type&&input.type!==current.type)throw new Error('TEAM_TYPE_IMMUTABLE');
  if(input.owner_agent_id!==undefined){
   if(current.owner_agent_id&&input.owner_agent_id!==current.owner_agent_id)throw new Error('TEAM_OWNER_IMMUTABLE');
   if(input.owner_agent_id){this.validateOwner(input.owner_agent_id);const owned=this.getOwnedByAgent(input.owner_agent_id);if(owned&&owned.id!==teamId)throw new Error('AGENT_TEAM_ALREADY_EXISTS')}
  }
  if(input.lead_agent_id!==undefined)this.validateLead(input.lead_agent_id);
  const name=input.name===undefined?current.name:String(input.name).trim(),slug=input.slug===undefined?current.slug:String(input.slug).trim().toLowerCase();
  if(!name)throw new Error('TEAM_NAME_REQUIRED');if(!SLUG.test(slug))throw new Error('TEAM_SLUG_INVALID');
  const tx=this.db.transaction(()=>{
   const owner=input.owner_agent_id===undefined?current.owner_agent_id:input.owner_agent_id;
   this.db.prepare(`UPDATE teams SET name=?,slug=?,purpose=?,owner_agent_id=?,lead_agent_id=?,enabled=?,max_parallelism=?,max_delegation_depth=?,allow_external_borrowing=?,proposal_policy=?,metadata_json=?,updated_at=? WHERE id=?`)
    .run(name,slug,input.purpose??current.purpose,owner,owner??(input.lead_agent_id===undefined?current.lead_agent_id:input.lead_agent_id),input.enabled===undefined?(current.enabled?1:0):(input.enabled?1:0),Math.max(1,Math.floor(input.max_parallelism??current.max_parallelism)),Math.max(0,Math.floor(input.max_delegation_depth??current.max_delegation_depth)),input.allow_external_borrowing===undefined?(current.allow_external_borrowing?1:0):(input.allow_external_borrowing?1:0),input.proposal_policy??current.proposal_policy,JSON.stringify(input.metadata??current.metadata),now(),teamId);
   if(input.policy)this.writePolicy(teamId,normalizePolicy({...current.policy,...input.policy}),now());
   this.bumpVersion(teamId);
  });tx.immediate();return this.get(teamId)!;
 }
 disable(teamId:string){return this.update(teamId,{enabled:false})}
 replaceMembers(teamId:string,members:TeamMemberInput[]){
  const team=this.get(teamId);if(!team)throw new Error('TEAM_NOT_FOUND');
  const seen=new Set<string>();for(const m of members){if(seen.has(m.agent_id))throw new Error('TEAM_MEMBER_DUPLICATE');seen.add(m.agent_id);if(!this.db.prepare('SELECT 1 FROM agents WHERE id=?').get(m.agent_id))throw new Error('AGENT_NOT_FOUND');if(team.owner_agent_id&&m.agent_id===team.owner_agent_id)throw new Error('TEAM_OWNER_CANNOT_BE_MEMBER')}
  if(!team.owner_agent_id&&team.lead_agent_id&&!seen.has(team.lead_agent_id))throw new Error('TEAM_LEAD_MUST_BE_MEMBER');
  if(team.owner_agent_id)this.validateSubagents(team.owner_agent_id,members.map(m=>m.agent_id));
  const tx=this.db.transaction(()=>{this.db.prepare('DELETE FROM team_members WHERE team_id=?').run(teamId);const ins=this.db.prepare(`INSERT INTO team_members(team_id,agent_id,role_name,priority,enabled,metadata_json,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?)`);const t=now();for(const m of members)ins.run(teamId,m.agent_id,m.role_name??'',Math.floor(m.priority??0),m.enabled===false?0:1,JSON.stringify(m.metadata??{}),t,t);if(team.owner_agent_id)this.syncRelations(team.owner_agent_id,members);this.bumpVersion(teamId)});tx.immediate();this.appendRoomEntry(teamId,{agent_id:team.owner_agent_id??null,entry_type:'activity',content:'Composição da equipe atualizada.',payload:{subagents:members.map(m=>m.agent_id)}});return this.get(teamId)!;
 }
 listMembers(teamId:string){return (this.db.prepare(`SELECT tm.*,a.name,a.slug,a.enabled agent_enabled,p.enabled provider_enabled,m.enabled model_enabled FROM team_members tm JOIN agents a ON a.id=tm.agent_id LEFT JOIN providers p ON p.id=a.provider_id LEFT JOIN provider_models m ON m.id=a.model_id WHERE tm.team_id=? ORDER BY tm.priority DESC,a.name`).all(teamId) as any[]).map(r=>({...r,enabled:Boolean(r.enabled),agent_enabled:Boolean(r.agent_enabled),provider_enabled:Boolean(r.provider_enabled),model_enabled:Boolean(r.model_enabled),metadata:parse(r.metadata_json,{})}))}
 listAgentTeams(agentId:string){return (this.db.prepare(`SELECT DISTINCT t.* FROM teams t LEFT JOIN team_members tm ON tm.team_id=t.id WHERE t.owner_agent_id=? OR tm.agent_id=? ORDER BY t.name`).all(agentId,agentId) as any[]).map(r=>this.hydrate(r))}
 versions(teamId:string){return (this.db.prepare('SELECT id,team_id,version,snapshot_json,created_at FROM team_versions WHERE team_id=? ORDER BY version DESC').all(teamId) as any[]).map(r=>({...r,snapshot:parse(r.snapshot_json,{})}))}
 capabilities(teamId:string,requirements:CapabilityRequirement[]=[]){
  const team=this.get(teamId);if(!team)throw new Error('TEAM_NOT_FOUND');this.caps.seed();
  const ops=new AgentOperationsService(this.db);const memberIds=[...(team.owner_agent_id?[team.owner_agent_id]:[]),...this.listMembers(teamId).filter(m=>m.enabled).map(m=>m.agent_id)];const active=[...new Set(memberIds)].filter(agent_id=>ops.isEligible(agent_id)).map(agent_id=>({agent_id} as any));
  const defs=new Map(this.caps.list().map(d=>[d.key,d]));const rows=new Map<string,{capability:string;coverage:boolean;specialists:string[];redundancy:number;tool_coverage:string[];confidence:number;evidence_count:number}>();
  for(const member of active)for(const cap of this.caps.listAgent(member.agent_id).filter(c=>c.enabled)){const score=(cap.verified_score??cap.declared_score)*Math.max(.25,cap.confidence);const cur=rows.get(cap.capability_key)??{capability:cap.capability_key,coverage:false,specialists:[],redundancy:0,tool_coverage:[],confidence:0,evidence_count:0};if(score>0){cur.coverage=true;cur.specialists.push(member.agent_id);cur.redundancy=cur.specialists.length;cur.confidence=Math.max(cur.confidence,cap.confidence);cur.evidence_count+=cap.evidence_count}rows.set(cap.capability_key,cur)}
  const policies=this.db.prepare('SELECT agent_id,enabled,allowed_tools_json FROM agent_tool_policies').all() as any[];const pmap=new Map(policies.map(p=>[p.agent_id,p])),teamTools=new Set<string>(team.policy?.allowed_tools??[]);
  for(const cur of rows.values()){const tools=new Set<string>();for(const aid of cur.specialists){const p=pmap.get(aid);if(p?.enabled)for(const x of parse<string[]>(p.allowed_tools_json,[]))if(!teamTools.size||teamTools.has(x))tools.add(x)}cur.tool_coverage=[...tools].sort()}
  const missing=requirements.filter(r=>!active.some(m=>this.agentCovers(m.agent_id,r,defs))).map(r=>r.key);
  return{team_id:teamId,active_members:active.map(m=>m.agent_id),capabilities:[...rows.values()].sort((a,b)=>a.capability.localeCompare(b.capability)),missing_capabilities:missing};
 }
 createDynamic(input:DynamicTeamInput){
  if(!Array.isArray(input.member_ids)||!input.member_ids.length)throw new Error('DYNAMIC_TEAM_MEMBERS_REQUIRED');
  const members=[...new Set(input.member_ids)];const ops=new AgentOperationsService(this.db);for(const a of members){if(!ops.isEligible(a))throw new Error('DYNAMIC_TEAM_MEMBER_UNAVAILABLE')}
  if(input.lead_agent_id&&!members.includes(input.lead_agent_id))throw new Error('DYNAMIC_TEAM_LEAD_MUST_BE_MEMBER');
  if(input.execution_plan_id&&!this.db.prepare('SELECT 1 FROM execution_plans WHERE id=?').get(input.execution_plan_id))throw new Error('EXECUTION_PLAN_NOT_FOUND');
  if(input.orchestration_run_id&&!this.db.prepare('SELECT 1 FROM orchestration_runs WHERE id=?').get(input.orchestration_run_id))throw new Error('ORCHESTRATION_RUN_NOT_FOUND');
  const teamId='dyn-'+id(),t=now(),policy=normalizePolicy(input.policy);
  const tx=this.db.transaction(()=>{this.db.prepare(`INSERT INTO dynamic_team_instances(id,orchestration_run_id,execution_plan_id,purpose,lead_agent_id,max_parallelism,max_delegation_depth,allow_external_borrowing,policy_json,status,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)`).run(teamId,input.orchestration_run_id??null,input.execution_plan_id??null,input.purpose??'',input.lead_agent_id??null,Math.max(1,Math.floor(input.max_parallelism??3)),Math.max(0,Math.floor(input.max_delegation_depth??2)),input.allow_external_borrowing?1:0,JSON.stringify(policy),t,t);const ins=this.db.prepare('INSERT INTO dynamic_team_members(dynamic_team_id,agent_id,role_name,priority,enabled,metadata_json,created_at)VALUES(?,?,\'\',0,1,\'{}\',?)');for(const a of members)ins.run(teamId,a,t)});tx.immediate();return this.getDynamic(teamId)!;
 }
 getDynamic(teamId:string){const row=this.db.prepare('SELECT * FROM dynamic_team_instances WHERE id=?').get(teamId) as any;if(!row)return null;const members=(this.db.prepare('SELECT * FROM dynamic_team_members WHERE dynamic_team_id=? ORDER BY priority DESC,agent_id').all(teamId) as any[]).map(x=>({...x,enabled:Boolean(x.enabled),metadata:parse(x.metadata_json,{})}));return{...row,allow_external_borrowing:Boolean(row.allow_external_borrowing),policy:parse(row.policy_json,{}),members}}
 snapshotForExecution(planId:string,stepId:string,kind:TeamKind,teamId:string){
  const existing=this.db.prepare('SELECT * FROM execution_team_snapshots WHERE step_id=?').get(stepId) as any;if(existing)return{...existing,snapshot:parse(existing.snapshot_json,{})};
  let snapshot:any,versionId:string|null=null;
  if(kind==='permanent'){const team=this.get(teamId);if(!team||!team.enabled)throw new Error('EXECUTION_TEAM_INVALID');const v=this.db.prepare('SELECT * FROM team_versions WHERE team_id=? ORDER BY version DESC LIMIT 1').get(teamId) as any;if(!v)throw new Error('TEAM_VERSION_NOT_FOUND');versionId=v.id;snapshot=parse(v.snapshot_json,{})}
  else{const team=this.getDynamic(teamId);if(!team||team.status!=='active')throw new Error('EXECUTION_DYNAMIC_TEAM_INVALID');snapshot=team}
  const sid=id(),t=now();this.db.prepare('INSERT INTO execution_team_snapshots(id,plan_id,step_id,team_kind,team_id,team_version_id,snapshot_json,created_at)VALUES(?,?,?,?,?,?,?,?)').run(sid,planId,stepId,kind,teamId,versionId,JSON.stringify(snapshot),t);return{ id:sid,plan_id:planId,step_id:stepId,team_kind:kind,team_id:teamId,team_version_id:versionId,snapshot,created_at:t};
 }
 private hydrate(row:any){const policyRow=this.db.prepare('SELECT * FROM team_policies WHERE team_id=?').get(row.id) as any;return{...row,enabled:Boolean(row.enabled),allow_external_borrowing:Boolean(row.allow_external_borrowing),metadata:parse(row.metadata_json,{}),policy:policyRow?{allowed_tools:parse(policyRow.allowed_tools_json,[]),permissions:parse(policyRow.permissions_json,[]),delegation_permissions:parse(policyRow.delegation_permissions_json,[]),approval_mode:policyRow.approval_mode,budget_defaults:parse(policyRow.budget_defaults_json,{}),metadata:parse(policyRow.metadata_json,{})}:normalizePolicy(),members:this.listMembers(row.id)}}
 private writePolicy(teamId:string,p:any,t:string){this.db.prepare(`INSERT INTO team_policies(team_id,allowed_tools_json,permissions_json,delegation_permissions_json,approval_mode,budget_defaults_json,metadata_json,updated_at)VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(team_id) DO UPDATE SET allowed_tools_json=excluded.allowed_tools_json,permissions_json=excluded.permissions_json,delegation_permissions_json=excluded.delegation_permissions_json,approval_mode=excluded.approval_mode,budget_defaults_json=excluded.budget_defaults_json,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`).run(teamId,JSON.stringify(p.allowed_tools),JSON.stringify(p.permissions),JSON.stringify(p.delegation_permissions),p.approval_mode,JSON.stringify(p.budget_defaults),JSON.stringify(p.metadata),t)}
 private ensureRoom(teamId:string,t=now()){this.db.prepare("INSERT OR IGNORE INTO team_rooms(team_id,instructions,shared_context_json,memory_json,created_at,updated_at)VALUES(?,'','{}','{}',?,?)").run(teamId,t,t)}
 private validateOwner(agentId:string){if(!this.db.prepare('SELECT 1 FROM agents WHERE id=?').get(agentId))throw new Error('TEAM_OWNER_NOT_FOUND')}
 private validateSubagents(owner:string,children:string[]){
  const unique=[...new Set(children)];if(unique.length!==children.length)throw new Error('TEAM_MEMBER_DUPLICATE');if(unique.includes(owner))throw new Error('TEAM_OWNER_CANNOT_BE_MEMBER');
  for(const child of unique){
   const permanent=this.db.prepare(`SELECT t.owner_agent_id FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE tm.agent_id=? AND t.owner_agent_id IS NOT NULL AND t.owner_agent_id<>? LIMIT 1`).get(child,owner) as any;
   const other=this.db.prepare("SELECT parent_agent_id FROM agent_relations WHERE child_agent_id=? AND relation_type='supervises' AND enabled=1 AND parent_agent_id<>? LIMIT 1").get(child,owner) as any;
   if(permanent||other)throw new Error('SUBAGENT_ALREADY_ASSIGNED')
  }
  const edges=this.db.prepare("SELECT parent_agent_id,child_agent_id FROM agent_relations WHERE relation_type='supervises' AND enabled=1 AND parent_agent_id<>?").all(owner) as any[];const graph=new Map<string,string[]>();for(const e of edges)graph.set(e.parent_agent_id,[...(graph.get(e.parent_agent_id)??[]),e.child_agent_id]);graph.set(owner,unique);
  const visit=(node:string,path:Set<string>,depth:number)=>{if(depth>12)throw new Error('AGENT_RELATION_MAX_DEPTH');if(path.has(node))throw new Error('AGENT_RELATION_CYCLE');const next=new Set(path);next.add(node);for(const child of graph.get(node)??[])visit(child,next,depth+1)};for(const node of graph.keys())visit(node,new Set(),0);
 }
 private syncRelations(owner:string,members:TeamMemberInput[]){const t=now();this.db.prepare("DELETE FROM agent_relations WHERE parent_agent_id=? AND relation_type='supervises'").run(owner);const ins=this.db.prepare("INSERT INTO agent_relations(parent_agent_id,child_agent_id,relation_type,enabled,priority,metadata_json,created_at,updated_at)VALUES(?,?,'supervises',?,?,?, ?,?)");members.forEach((m,i)=>ins.run(owner,m.agent_id,m.enabled===false?0:1,Math.floor(m.priority??i),JSON.stringify({source:'owned_team'}),t,t))}
 private validateLead(agentId:string|null){if(!agentId)return;const r=enabledAgent(this.db,agentId);if(!r)throw new Error('TEAM_LEAD_NOT_FOUND');if(!r.enabled||!r.provider_enabled||!r.model_enabled)throw new Error('TEAM_LEAD_UNAVAILABLE')}
 private bumpVersion(teamId:string){this.db.prepare('UPDATE teams SET current_version=current_version+1,updated_at=? WHERE id=?').run(now(),teamId);this.snapshot(teamId)}
 private snapshot(teamId:string){const team=this.db.prepare('SELECT * FROM teams WHERE id=?').get(teamId) as any;if(!team)throw new Error('TEAM_NOT_FOUND');const policy=this.db.prepare('SELECT * FROM team_policies WHERE team_id=?').get(teamId) as any;const members=this.db.prepare('SELECT team_id,agent_id,role_name,priority,enabled,metadata_json,created_at,updated_at FROM team_members WHERE team_id=? ORDER BY priority DESC,agent_id').all(teamId);const snap={team:{id:team.id,name:team.name,slug:team.slug,purpose:team.purpose,type:team.type,owner_agent_id:team.owner_agent_id??null,lead_agent_id:team.lead_agent_id,enabled:Boolean(team.enabled),max_parallelism:team.max_parallelism,max_delegation_depth:team.max_delegation_depth,allow_external_borrowing:Boolean(team.allow_external_borrowing),proposal_policy:team.proposal_policy,metadata:parse(team.metadata_json,{})},policy:policy?{allowed_tools:parse(policy.allowed_tools_json,[]),permissions:parse(policy.permissions_json,[]),delegation_permissions:parse(policy.delegation_permissions_json,[]),approval_mode:policy.approval_mode,budget_defaults:parse(policy.budget_defaults_json,{}),metadata:parse(policy.metadata_json,{})}:normalizePolicy(),members:(members as any[]).map(m=>({...m,enabled:Boolean(m.enabled),metadata:parse(m.metadata_json,{})}))};this.db.prepare('INSERT INTO team_versions(id,team_id,version,snapshot_json,created_at)VALUES(?,?,?,?,?)').run(id(),teamId,team.current_version,JSON.stringify(snap),now())}
 private agentCovers(agentId:string,r:CapabilityRequirement,defs:Map<string,any>){const min=r.minimum??0;for(const cap of this.caps.listAgent(agentId).filter(x=>x.enabled)){const score=(cap.verified_score??cap.declared_score)*Math.max(.25,cap.confidence);if(score<min)continue;if(cap.capability_key===r.key)return true;if(r.allow_hierarchy!==false){let d=defs.get(cap.capability_key),seen=new Set<string>();while(d?.parent_key&&!seen.has(d.parent_key)){if(d.parent_key===r.key)return true;seen.add(d.parent_key);d=defs.get(d.parent_key)}}}return false}
}
export function emitTeamEvent(db:Database,projectId:string,type:string,title:string,payload:Record<string,unknown>,agentId?:string|null){
 return new ActivityRepository(db).append({project_id:projectId,agent_id:agentId??null,type,title,detail:'',payload});
}
