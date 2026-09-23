import type { Database } from 'better-sqlite3';
import { CapabilityRepository, type CapabilityRequirement, type AgentCapability } from './capabilityCore.js';
import { TeamService, type WorkerRef } from './teamService.js';
import { AgentOperationsService } from './agentOperations.js';
import { SubagentService } from './subagentService.js';
import { ToolRegistry } from './toolRegistry.js';
import { IntegrationRegistryService } from './integrationRegistry.js';

export type GapResolution='active_agent'|'active_subagent'|'dynamic_team'|'existing_team'|'inactive_agent_available'|'missing_tool'|'missing_integration'|'missing_capability';
export interface CapabilityGap{
  key:string;domain:string;required_level:number;reason:string;blocking:boolean;frequency_hint:number;
  candidate_alternatives:string[];missing_tool?:string;missing_integration?:string;confidence:number;discovered_at:'preflight'|'runtime';
}
export interface GapAnalysisResult{
  resolution:GapResolution;
  selected_agent_ids:string[];
  selected_subagent_ids:string[];
  selected_team_id?:string;
  workforce_resources:WorkerRef[];
  inactive_agent_ids:string[];
  uncovered_requirements:string[];
  gaps:CapabilityGap[];
  explanation:string;
}
type Candidate={
  kind:'agent'|'subagent';
  id:string;
  enabled:boolean;
  healthy:boolean;
  caps:AgentCapability[]|any[];
  quality:number;
  source_team_id?:string;
  source_owner_id?:string;
};
const score=(c:any)=>(c.verified_score??c.declared_score)*Math.max(.25,c.confidence??0);

export class GapAnalysisService{
  private caps:CapabilityRepository;
  constructor(private db:Database){this.caps=new CapabilityRepository(db)}

  analyze(requirements:CapabilityRequirement[],requiredTools:string[]=[],options:{project_id?:string|null}={}):GapAnalysisResult{
    this.caps.seed();
    const registeredTools=new Set(new ToolRegistry().listDefinitions().map(tool=>tool.name));
    const missingTools=[...new Set(requiredTools.filter(tool=>!registeredTools.has(tool)))];
    if(missingTools.length){
      return{
        resolution:'missing_tool',selected_agent_ids:[],selected_subagent_ids:[],workforce_resources:[],inactive_agent_ids:[],
        uncovered_requirements:missingTools,
        gaps:missingTools.map(tool=>({key:'tool:'+tool,domain:'tools',required_level:1,reason:'Required tool is not registered.',blocking:true,frequency_hint:0,candidate_alternatives:[],missing_tool:tool,confidence:1,discovered_at:'preflight'})),
        explanation:'One or more required Tools are not registered in the Agent Office.'
      };
    }
    const integrations=new IntegrationRegistryService(this.db);
    const missingIntegrations=requiredTools.map(tool=>({tool,availability:integrations.availabilityForTool(tool,options.project_id)})).filter(item=>item.availability.managed&&!item.availability.available);
    if(missingIntegrations.length){
      return{
        resolution:'missing_integration',selected_agent_ids:[],selected_subagent_ids:[],workforce_resources:[],inactive_agent_ids:[],
        uncovered_requirements:missingIntegrations.map(item=>String(item.availability.driver)),
        gaps:missingIntegrations.map(item=>({key:'integration:'+String(item.availability.driver),domain:'integrations',required_level:1,reason:'Required Integration is unavailable, disabled or needs authentication.',blocking:true,frequency_hint:0,candidate_alternatives:[],missing_tool:item.tool,missing_integration:String(item.availability.driver),confidence:1,discovered_at:'preflight'})),
        explanation:'A required external Integration is not available for this Project.'
      };
    }
    const defs=new Map(this.caps.list().map(d=>[d.key,d]));
    for(const r of requirements)if(!defs.has(r.key))throw new Error('CAPABILITY_NOT_FOUND');
    const mandatory=requirements.filter(r=>r.mandatory!==false),candidates=this.candidates();
    const active=candidates.filter(c=>c.enabled&&c.healthy),inactive=candidates.filter(c=>!c.enabled&&c.healthy);
    const covers=(c:Candidate,r:CapabilityRequirement)=>this.covers(c.caps,r,defs);
    const matching=(c:Candidate)=>mandatory.every(r=>covers(c,r));

    const single=active.filter(matching).sort((a,b)=>b.quality-a.quality||a.id.localeCompare(b.id))[0];
    if(single){
      const ref=this.ref(single,mandatory.filter(r=>covers(single,r)).map(r=>r.key));
      return{
        resolution:single.kind==='agent'?'active_agent':'active_subagent',
        selected_agent_ids:single.kind==='agent'?[single.id]:[],
        selected_subagent_ids:single.kind==='subagent'?[single.id]:[],
        workforce_resources:[ref],inactive_agent_ids:[],uncovered_requirements:[],gaps:[],
        explanation:`One active ${single.kind} covers all mandatory requirements.`,
      };
    }

    const existing=this.findExistingTeam(mandatory);
    const minimum=this.minimumSet(active,mandatory,covers);
    if(existing&&(!minimum.length||existing.worker_count<=minimum.length)){
      return{resolution:'existing_team',selected_agent_ids:[],selected_subagent_ids:[],selected_team_id:existing.id,workforce_resources:[{kind:'team',id:existing.id,reason:'Permanent Team covers all mandatory capabilities.',capability_keys:mandatory.map(r=>r.key),score:existing.quality}],inactive_agent_ids:[],uncovered_requirements:[],gaps:[],explanation:'An enabled permanent Agent Team covers the request with an efficient existing composition.'};
    }
    if(minimum.length&&mandatory.every(r=>minimum.some(c=>covers(c,r)))){
      const refs=minimum.map(c=>this.ref(c,mandatory.filter(r=>covers(c,r)).map(r=>r.key)));
      return{resolution:'dynamic_team',selected_agent_ids:minimum.filter(x=>x.kind==='agent').map(x=>x.id),selected_subagent_ids:minimum.filter(x=>x.kind==='subagent').map(x=>x.id),workforce_resources:refs,inactive_agent_ids:[],uncovered_requirements:[],gaps:[],explanation:'Minimum eligible Worker set covers all mandatory requirements.'};
    }
    if(existing){
      return{resolution:'existing_team',selected_agent_ids:[],selected_subagent_ids:[],selected_team_id:existing.id,workforce_resources:[{kind:'team',id:existing.id,reason:'Permanent Team covers all mandatory capabilities.',capability_keys:mandatory.map(r=>r.key),score:existing.quality}],inactive_agent_ids:[],uncovered_requirements:[],gaps:[],explanation:'An enabled permanent Agent Team covers all mandatory requirements.'};
    }

    const inactiveSingle=inactive.filter(matching).sort((a,b)=>b.quality-a.quality||a.id.localeCompare(b.id))[0];
    if(inactiveSingle?.kind==='agent')return{resolution:'inactive_agent_available',selected_agent_ids:[],selected_subagent_ids:[],workforce_resources:[],inactive_agent_ids:[inactiveSingle.id],uncovered_requirements:[],gaps:[],explanation:'An inactive Agent could cover all requirements; activation requires user action.'};

    const uncovered=mandatory.filter(r=>!active.some(c=>covers(c,r))),inactiveIds=[...new Set(uncovered.flatMap(r=>inactive.filter(c=>c.kind==='agent'&&covers(c,r)).map(c=>c.id)))];
    const gaps:CapabilityGap[]=uncovered.map(r=>{
      const def=defs.get(r.key)!;const capable=candidates.filter(c=>covers(c,r));
      return{key:r.key,domain:def.domain,required_level:r.minimum??0,reason:'No eligible existing Worker covers this capability.',blocking:r.mandatory!==false,frequency_hint:0,candidate_alternatives:capable.map(c=>`${c.kind}:${c.id}`),confidence:.9,discovered_at:'preflight'};
    });
    if(!gaps.length&&requiredTools.length){
      // Full Access is not an allowlist. Required tools are execution requirements,
      // not candidate restrictions, so they do not invalidate capable Workers here.
    }
    return{resolution:'missing_capability',selected_agent_ids:[],selected_subagent_ids:[],workforce_resources:[],inactive_agent_ids:inactiveIds,uncovered_requirements:uncovered.map(r=>r.key),gaps,explanation:'A required capability is genuinely uncovered by existing Agents, Subagents and Teams.'};
  }

  private candidates():Candidate[]{
    const out:Candidate[]=[],ops=new AgentOperationsService(this.db),subs=new SubagentService(this.db);
    for(const row of this.db.prepare('SELECT id,enabled,paused FROM agents').all() as any[]){
      const caps=this.caps.listAgent(row.id),eligible=ops.isEligible(row.id);
      out.push({kind:'agent',id:row.id,enabled:Boolean(row.enabled)&&!Boolean(row.paused),healthy:eligible||(!row.enabled&&this.hasConfiguredAgentRuntime(row.id)),caps,quality:this.agentQuality(row.id,caps)});
    }
    for(const row of this.db.prepare('SELECT id,team_id,owner_agent_id,enabled,paused FROM subagents').all() as any[]){
      const caps=subs.listCapabilities(row.id),eligible=subs.isEligible(row.id);
      out.push({kind:'subagent',id:row.id,enabled:Boolean(row.enabled)&&!Boolean(row.paused),healthy:eligible,caps,quality:this.subagentQuality(row.id,caps),source_team_id:row.team_id,source_owner_id:row.owner_agent_id});
    }
    return out;
  }

  private hasConfiguredAgentRuntime(agentId:string){return Boolean(this.db.prepare(`SELECT 1 FROM agents a JOIN providers p ON p.id=a.provider_id AND p.enabled=1 JOIN provider_models m ON m.id=a.model_id AND m.enabled=1 WHERE a.id=?`).get(agentId))}
  private covers(caps:any[],r:CapabilityRequirement,defs:Map<string,any>){
    const min=r.minimum??0;
    for(const cap of caps){
      if(!cap.enabled||score(cap)<min)continue;
      if(cap.capability_key===r.key)return true;
      if(r.allow_hierarchy!==false){let d=defs.get(cap.capability_key),seen=new Set<string>();while(d?.parent_key&&!seen.has(d.parent_key)){if(d.parent_key===r.key)return true;seen.add(d.parent_key);d=defs.get(d.parent_key)}}
    }
    return false;
  }
  private minimumSet(active:Candidate[],reqs:CapabilityRequirement[],covers:(c:Candidate,r:CapabilityRequirement)=>boolean){
    let remaining=[...reqs],pool=[...active],selected:Candidate[]=[];
    while(remaining.length){
      const ranked=pool.map(c=>({c,n:remaining.filter(r=>covers(c,r)).length,q:c.quality})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n||b.q-a.q||a.c.id.localeCompare(b.c.id));
      if(!ranked.length)break;const best=ranked[0].c;selected.push(best);pool=pool.filter(c=>!(c.kind===best.kind&&c.id===best.id));remaining=remaining.filter(r=>!covers(best,r));
    }
    for(let i=selected.length-1;i>=0;i--){const trial=selected.filter((_,j)=>j!==i);if(reqs.every(r=>trial.some(c=>covers(c,r))))selected=trial}
    return selected;
  }
  private findExistingTeam(reqs:CapabilityRequirement[]){
    const teams=new TeamService(this.db);
    const eligible=teams.list().filter((t:any)=>t.enabled&&t.type==='permanent'&&t.owner_agent_id).map((t:any)=>{
      const c=teams.capabilities(t.id,reqs),quality=this.teamQuality(t.id);
      return{id:t.id,worker_count:(c.active_members??[]).length,ok:!(c.missing_capabilities??[]).length,quality};
    }).filter((x:any)=>x.ok&&x.worker_count>0).sort((a:any,b:any)=>a.worker_count-b.worker_count||b.quality-a.quality||a.id.localeCompare(b.id));
    return eligible[0]??null;
  }
  private ref(c:Candidate,keys:string[]):WorkerRef{return{kind:c.kind,id:c.id,reason:`${c.kind} selected for ${keys.join(', ')||'general execution'}.`,capability_keys:keys,score:c.quality}}
  private agentQuality(agentId:string,caps:any[]){
    const perf=this.db.prepare(`SELECT event_type,COUNT(*) n FROM agent_performance_events WHERE agent_id=? GROUP BY event_type`).all(agentId) as any[];
    return this.qualityFromSignals(caps,perf);
  }
  private subagentQuality(subagentId:string,caps:any[]){
    const perf=this.db.prepare(`SELECT event_type,COUNT(*) n FROM subagent_performance_events WHERE subagent_id=? GROUP BY event_type`).all(subagentId) as any[];
    return this.qualityFromSignals(caps,perf);
  }
  private teamQuality(teamId:string){
    const row=this.db.prepare(`SELECT owner_agent_id FROM teams WHERE id=?`).get(teamId) as any;if(!row?.owner_agent_id)return 0;
    const owner=this.agentQuality(row.owner_agent_id,this.caps.listAgent(row.owner_agent_id));
    const subs=new SubagentService(this.db).list(teamId).map(s=>this.subagentQuality(s.id,s.capabilities));
    return subs.length?(owner+subs.reduce((a,b)=>a+b,0))/(subs.length+1):owner;
  }
  private qualityFromSignals(caps:any[],perf:any[]){
    const capScore=caps.length?caps.reduce((s,x)=>s+score(x),0)/caps.length:0;
    const counts=new Map(perf.map(x=>[x.event_type,Number(x.n)]));
    const good=(counts.get('accepted')??0)+(counts.get('execution_success')??0)+(counts.get('validation_passed')??0);
    const bad=(counts.get('rework_requested')??0)+(counts.get('rejected')??0)+(counts.get('quality_failure')??0)+(counts.get('operational_failure')??0);
    const perfScore=good+bad?good/(good+bad):.5;
    return capScore*.7+perfScore*.3;
  }
}
