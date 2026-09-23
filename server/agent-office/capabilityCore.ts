import type { Database } from 'better-sqlite3';
export type CapabilitySource='manual'|'seed'|'learned';
export interface CapabilityDefinition{key:string;label:string;domain:string;parent_key:string|null;description:string;version:number;status:'active'|'deprecated';metadata:Record<string,unknown>}
export interface AgentCapability{agent_id:string;capability_key:string;declared_score:number;verified_score:number|null;confidence:number;evidence_count:number;source:CapabilitySource;enabled:boolean;updated_at:string}
export interface CapabilityRequirement{key:string;importance?:number;minimum?:number;mandatory?:boolean;allow_hierarchy?:boolean}
export interface CapabilityMatch{agent_id:string;eligible:boolean;coverage:number;weighted_score:number;missing:string[];blockers:string[];matched:Array<{required:string;actual:string;score:number}>}
const KEY=/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/; const now=()=>new Date().toISOString(); const parse=(v:string)=>{try{return JSON.parse(v||'{}')}catch{return {}}};
export const CAPABILITY_SEEDS=[
 ['software','Software','software',null,'Software engineering'],['software.frontend','Frontend','software','software','Frontend engineering'],['software.frontend.react','React','software','software.frontend','React development'],['software.backend','Backend','software','software','Backend engineering'],['software.testing','Testing','software','software','Software testing'],
 ['marketing','Marketing','marketing',null,'Marketing'],['marketing.copywriting','Copywriting','marketing','marketing','Marketing copy'],['video','Video','video',null,'Video production'],['video.editing','Video Editing','video','video','Video editing'],['research','Research','research',null,'Research'],['operations','Operations','operations',null,'Operations'],['data','Data','data',null,'Data work'],['design','Design','design',null,'Design'],['security','Security','security',null,'Security'],
] as const;
export class CapabilityRepository{
 constructor(private db:Database){}
 seed(){const ins=this.db.prepare(`INSERT OR IGNORE INTO capability_definitions(key,label,domain,parent_key,description,version,status,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,1,'active','{}',?,?)`);this.db.transaction(()=>{for(const s of CAPABILITY_SEEDS){const t=now();ins.run(...s,t,t)}})()}
 list(domain?:string):CapabilityDefinition[]{const rows=(domain?this.db.prepare('SELECT * FROM capability_definitions WHERE domain=? ORDER BY key').all(domain):this.db.prepare('SELECT * FROM capability_definitions ORDER BY domain,key').all()) as any[];return rows.map(r=>({...r,metadata:parse(r.metadata_json)}))}
 get(key:string){return this.list().find(x=>x.key===key)??null}
 create(input:{key:string;label:string;domain:string;parent_key?:string|null;description?:string;metadata?:Record<string,unknown>}){const key=input.key.trim().toLowerCase(),domain=input.domain.trim().toLowerCase();if(!KEY.test(key)||!KEY.test(domain))throw new Error('CAPABILITY_KEY_INVALID');if(input.parent_key&&!this.get(input.parent_key))throw new Error('CAPABILITY_PARENT_NOT_FOUND');if(input.parent_key&&(input.parent_key===key||input.parent_key.startsWith(key+'.')))throw new Error('CAPABILITY_HIERARCHY_INVALID');const t=now();this.db.prepare(`INSERT INTO capability_definitions(key,label,domain,parent_key,description,version,status,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,1,'active',?,?,?)`).run(key,input.label.trim()||key,domain,input.parent_key??null,input.description??'',JSON.stringify(input.metadata??{}),t,t);return this.get(key)!}
 listAgent(agentId:string):AgentCapability[]{return (this.db.prepare('SELECT * FROM agent_capabilities WHERE agent_id=? ORDER BY capability_key').all(agentId) as any[]).map(r=>({...r,enabled:Boolean(r.enabled)}))}
 replaceAgent(agentId:string,items:Array<{capability_key:string;declared_score?:number;enabled?:boolean;source?:CapabilitySource}>){if(!this.db.prepare('SELECT 1 FROM agents WHERE id=?').get(agentId))throw new Error('AGENT_NOT_FOUND');const seen=new Set<string>();for(const x of items){if(seen.has(x.capability_key))throw new Error('AGENT_CAPABILITY_DUPLICATE');seen.add(x.capability_key);if(!this.get(x.capability_key))throw new Error('CAPABILITY_NOT_FOUND')}this.db.transaction(()=>{const existing=new Map(this.listAgent(agentId).map(x=>[x.capability_key,x]));this.db.prepare('DELETE FROM agent_capabilities WHERE agent_id=?').run(agentId);const ins=this.db.prepare(`INSERT INTO agent_capabilities(agent_id,capability_key,declared_score,verified_score,confidence,evidence_count,source,enabled,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`);for(const x of items){const prev=existing.get(x.capability_key);const learned=prev?.source==='learned';ins.run(agentId,x.capability_key,Math.max(0,Math.min(1,x.declared_score??prev?.declared_score??0.5)),prev?.verified_score??null,prev?.confidence??0,prev?.evidence_count??0,learned?'learned':(x.source??prev?.source??'manual'),x.enabled===false?0:1,now())}})();return this.listAgent(agentId)}
 inferAgent(agentId:string){
    this.seed();
    const agent=this.db.prepare('SELECT name,role,description,system_prompt FROM agents WHERE id=?').get(agentId) as any;
    if(!agent)throw new Error('AGENT_NOT_FOUND');
    const text=`${agent.name??''} ${agent.role??''} ${agent.description??''} ${agent.system_prompt??''}`.toLowerCase();
    const defs=new Map(this.list().map(d=>[d.key,d]));
    const rules:Array<[string,RegExp,number]>=[
      ['software.frontend.react',/\breact\b|next\.?js|jsx|tsx/i,.9],
      ['software.frontend',/frontend|front-end|interface|ui\b|css|html|landing page/i,.8],
      ['software.backend',/backend|back-end|api\b|server|node\.?js|express|fastify|database|banco de dados/i,.85],
      ['software.testing',/test|testing|qa\b|review|revis|debug|bug|quality assurance/i,.8],
      ['software',/software|c[oó]digo|code\b|program|developer|engenheiro|engineer|aplicativo|app\b|site|sistema/i,.7],
      ['marketing.copywriting',/copywriting|copywriter|copy\b|direct response|vsl|criativo|an[uú]ncio/i,.9],
      ['marketing',/marketing|growth|tr[aá]fego|campaign|campanha/i,.75],
      ['video.editing',/edi[cç][aã]o de v[ií]deo|video editing|editor de v[ií]deo|premiere|capcut|after effects/i,.9],
      ['video',/v[ií]deo|video|ugc|cinematic|storyboard/i,.7],
      ['research',/research|pesquisa|investigar|investigation|buscar fontes|fontes/i,.8],
      ['operations',/opera[cç][oõ]es|operations|workflow|processo|gest[aã]o|coordena[cç][aã]o/i,.75],
      ['data',/dados|data\b|analytics|sql\b|planilha|spreadsheet|estat[ií]stica/i,.8],
      ['design',/design|designer|figma|ux\b|ui\b|visual|layout/i,.8],
      ['security',/seguran[cç]a|security|auth|authentication|oauth|permission|vulnerab/i,.85],
    ];
    const inferred=new Map<string,number>();
    for(const [key,regex,score] of rules)if(defs.has(key)&&regex.test(text))inferred.set(key,Math.max(inferred.get(key)??0,score));
    const addParents=(key:string,score:number)=>{let cur=defs.get(key);while(cur?.parent_key){if(!inferred.has(cur.parent_key))inferred.set(cur.parent_key,Math.max(.55,score-.15));cur=defs.get(cur.parent_key)}};
    for(const [key,score] of [...inferred])addParents(key,score);
    const existing=new Map(this.listAgent(agentId).map(x=>[x.capability_key,x]));
    const merged=[...existing.values()]
      .filter(x=>x.source!=='seed')
      .map(x=>({capability_key:x.capability_key,declared_score:x.declared_score,enabled:x.enabled,source:x.source}));
    for(const [key,score] of inferred){
      const prev=existing.get(key);
      if(prev&&prev.source!=='seed')continue;
      merged.push({capability_key:key,declared_score:prev?.declared_score??score,enabled:true,source:'seed' as CapabilitySource});
    }
    return this.replaceAgent(agentId,merged);
  }
 seedAgents(){this.seed();const agents=this.db.prepare('SELECT id,role,description FROM agents').all() as any[];const infer=(s:string)=>{const x=s.toLowerCase(),o:string[]=[];if(/architect|executor|develop|code|program|builder/.test(x))o.push('software');if(/review|test/.test(x))o.push('software.testing');if(/market|copy/.test(x))o.push('marketing');if(/video|edit/.test(x))o.push('video');if(/research/.test(x))o.push('research');return [...new Set(o)]};const ins=this.db.prepare(`INSERT OR IGNORE INTO agent_capabilities(agent_id,capability_key,declared_score,verified_score,confidence,evidence_count,source,enabled,updated_at) VALUES(?,?,0.45,NULL,0.35,0,'seed',1,?)`);this.db.transaction(()=>{for(const a of agents)for(const k of infer(`${a.role} ${a.description}`))ins.run(a.id,k,now())})()}
}
function ancestors(defs:Map<string,CapabilityDefinition>,key:string){const o:string[]=[];let c=defs.get(key);const seen=new Set<string>();while(c?.parent_key&&!seen.has(c.parent_key)){seen.add(c.parent_key);o.push(c.parent_key);c=defs.get(c.parent_key)}return o}
export class CapabilityMatcher{
 constructor(private db:Database,private repo=new CapabilityRepository(db)){}
 match(required:CapabilityRequirement[],requiredTools:string[]=[]):CapabilityMatch[]{const defs=new Map(this.repo.list().map(d=>[d.key,d]));for(const r of required)if(!defs.has(r.key))throw new Error('CAPABILITY_NOT_FOUND');const agents=this.db.prepare('SELECT id FROM agents WHERE enabled=1 ORDER BY id').all() as Array<{id:string}>;const ps=this.db.prepare('SELECT agent_id,enabled,allowed_tools_json FROM agent_tool_policies').all() as any[];const policies=new Map(ps.map(p=>[p.agent_id,{enabled:Boolean(p.enabled),tools:new Set<string>(JSON.parse(p.allowed_tools_json||'[]'))}]));return agents.map(a=>{const caps=this.repo.listAgent(a.id).filter(c=>c.enabled),by=new Map(caps.map(c=>[c.capability_key,c]));const missing:string[]=[],blockers:string[]=[],matched:CapabilityMatch['matched']=[];let weighted=0,total=0,covered=0;for(const req of required){const w=Math.max(0,req.importance??1);total+=w;let actual=req.key,cap=by.get(req.key);if(!cap&&req.allow_hierarchy!==false){for(const c of caps)if(ancestors(defs,c.capability_key).includes(req.key)){cap=c;actual=c.capability_key;break}}const score=cap?(cap.verified_score??cap.declared_score)*Math.max(.25,cap.confidence):0,min=req.minimum??0;if(cap&&score>=min){covered+=w;weighted+=w*score;matched.push({required:req.key,actual,score})}else{missing.push(req.key);if(req.mandatory!==false)blockers.push(`missing:${req.key}`)}}const p=policies.get(a.id);for(const tool of requiredTools)if(!p?.enabled||!p.tools.has(tool))blockers.push(`tool:${tool}`);return{agent_id:a.id,eligible:blockers.length===0,coverage:total?covered/total:1,weighted_score:total?weighted/total:1,missing,blockers,matched}}).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.weighted_score-a.weighted_score||a.agent_id.localeCompare(b.agent_id))}
}
export function normalizedModelCapabilities(raw:Record<string,unknown>){const out:Record<string,boolean|number>={};for(const[k,v]of Object.entries(raw))if(typeof v==='boolean'||typeof v==='number')out[k]=v;return out}
export const TOOL_CAPABILITIES:Record<string,string[]>={list_files:['filesystem.read'],read_file:['filesystem.read'],search_files:['filesystem.read'],write_file:['filesystem.write'],apply_patch:['filesystem.write'],git_status:['git.inspect'],git_diff:['git.diff'],npm_test:['tests.run'],run_tests:['tests.run'],npm_build:['build.run'],npm_install:['dependencies.install'],node_script:['code.execute'],run_command:['command.restricted']};
