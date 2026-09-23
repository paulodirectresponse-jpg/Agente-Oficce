import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';

export interface SubagentInput {
  name:string;
  slug?:string;
  role?:string;
  description?:string;
  avatar_key?:string;
  provider_id?:string|null;
  model_id?:string|null;
  system_prompt?:string;
  enabled?:boolean;
  paused?:boolean;
  sort_order?:number;
  metadata?:Record<string,unknown>;
}

const now=()=>new Date().toISOString();
const id=()=>crypto.randomUUID();
const parse=(v:string|undefined|null)=>{try{return v?JSON.parse(v):{}}catch{return{}}};
const slugify=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

export class SubagentService {
  constructor(private readonly db: Database) {}

  list(teamId:string){
    return (this.db.prepare('SELECT * FROM subagents WHERE team_id=? ORDER BY sort_order,name').all(teamId) as any[]).map(row=>this.hydrate(row));
  }

  get(subagentId:string){
    const row=this.db.prepare('SELECT * FROM subagents WHERE id=?').get(subagentId) as any;
    return row?this.hydrate(row):null;
  }

  create(teamId:string,input:SubagentInput){
    const team=this.db.prepare("SELECT id,owner_agent_id,type FROM teams WHERE id=?").get(teamId) as any;
    if(!team)throw new Error('TEAM_NOT_FOUND');
    if(team.type!=='permanent'||!team.owner_agent_id)throw new Error('SUBAGENT_REQUIRES_OWNED_TEAM');
    const name=String(input.name||'').trim();if(!name)throw new Error('SUBAGENT_NAME_REQUIRED');
    const slug=String(input.slug||slugify(name)).trim().toLowerCase();if(!slug)throw new Error('SUBAGENT_SLUG_REQUIRED');
    this.validateBrain(input.provider_id??null,input.model_id??null);
    const sid=id(),t=now();
    this.db.prepare(`INSERT INTO subagents(
      id,team_id,owner_agent_id,name,slug,role,description,avatar_key,provider_id,model_id,system_prompt,enabled,paused,sort_order,metadata_json,created_at,updated_at
    )VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      sid,teamId,team.owner_agent_id,name,slug,input.role??'',input.description??'',input.avatar_key??'default',
      input.provider_id??null,input.model_id??null,input.system_prompt??'',input.enabled===false?0:1,input.paused?1:0,
      Math.floor(input.sort_order??0),JSON.stringify(input.metadata??{}),t,t
    );
    this.inferCapabilities(sid);
    return this.get(sid)!;
  }

  update(subagentId:string,input:Partial<SubagentInput>){
    const current=this.get(subagentId);if(!current)throw new Error('SUBAGENT_NOT_FOUND');
    const provider=input.provider_id===undefined?current.provider_id:input.provider_id;
    const model=input.model_id===undefined?current.model_id:input.model_id;
    this.validateBrain(provider,model);
    const name=input.name===undefined?current.name:String(input.name).trim();
    const slug=input.slug===undefined?current.slug:String(input.slug).trim().toLowerCase();
    if(!name)throw new Error('SUBAGENT_NAME_REQUIRED');if(!slug)throw new Error('SUBAGENT_SLUG_REQUIRED');
    this.db.prepare(`UPDATE subagents SET name=?,slug=?,role=?,description=?,avatar_key=?,provider_id=?,model_id=?,system_prompt=?,enabled=?,paused=?,sort_order=?,metadata_json=?,updated_at=? WHERE id=?`).run(
      name,slug,input.role??current.role,input.description??current.description,input.avatar_key??current.avatar_key,provider,model,
      input.system_prompt??current.system_prompt,input.enabled===undefined?(current.enabled?1:0):(input.enabled?1:0),
      input.paused===undefined?(current.paused?1:0):(input.paused?1:0),Math.floor(input.sort_order??current.sort_order),
      JSON.stringify(input.metadata??current.metadata),now(),subagentId
    );
    if(['name','role','description','system_prompt'].some(k=>Object.prototype.hasOwnProperty.call(input,k)))this.inferCapabilities(subagentId);
    return this.get(subagentId)!;
  }

  remove(subagentId:string){
    const current=this.get(subagentId);if(!current)throw new Error('SUBAGENT_NOT_FOUND');
    this.db.prepare('DELETE FROM subagents WHERE id=?').run(subagentId);
    return true;
  }

  readiness(subagentId:string){
    const s=this.get(subagentId);if(!s)return{status:'missing',reason:'Subagent inexistente.'};
    if(!s.enabled)return{status:'inactive',reason:'Subagent desativado.'};
    if(s.paused)return{status:'paused',reason:'Subagent pausado.'};
    if(!s.provider_id||!s.model_id)return{status:'incomplete',reason:'Configure provider e modelo.'};
    const p=this.db.prepare('SELECT enabled,health_status FROM providers WHERE id=?').get(s.provider_id) as any;
    const m=this.db.prepare('SELECT enabled,model_id FROM provider_models WHERE id=?').get(s.model_id) as any;
    if(!p?.enabled)return{status:'provider_unavailable',reason:'Provider indisponível.'};
    if(!m?.enabled)return{status:'model_unavailable',reason:'Modelo indisponível.'};
    const pr=this.db.prepare('SELECT operational_status FROM provider_runtime_state WHERE provider_id=?').get(s.provider_id) as any;
    const mr=this.db.prepare('SELECT operational_status FROM provider_model_runtime_state WHERE provider_id=? AND model_id=?').get(s.provider_id,m.model_id) as any;
    const ps=String(pr?.operational_status??p.health_status??'unknown'),ms=String(mr?.operational_status??'unknown');
    if(['auth_error','misconfigured','unavailable'].includes(ps))return{status:'provider_unavailable',reason:'Provider: '+ps};
    if(['auth_error','misconfigured','unavailable'].includes(ms))return{status:'model_unavailable',reason:'Modelo: '+ms};
    if(['degraded','rate_limited'].includes(ps)||['degraded','rate_limited'].includes(ms))return{status:'degraded',reason:`Runtime degradado: ${ps}/${ms}`};
    return{status:'ready',reason:'Subagent pronto para execução.'};
  }

  isEligible(subagentId:string){return ['ready','degraded'].includes(this.readiness(subagentId).status)}

  listCapabilities(subagentId:string){
    return (this.db.prepare('SELECT * FROM subagent_capabilities WHERE subagent_id=? ORDER BY capability_key').all(subagentId) as any[]).map(row=>({...row,enabled:Boolean(row.enabled)}));
  }

  replaceCapabilities(subagentId:string,items:Array<{capability_key:string;declared_score?:number;enabled?:boolean;source?:string}>){
    if(!this.get(subagentId))throw new Error('SUBAGENT_NOT_FOUND');
    const existing=new Map(this.listCapabilities(subagentId).map(x=>[x.capability_key,x]));
    const tx=this.db.transaction(()=>{
      this.db.prepare('DELETE FROM subagent_capabilities WHERE subagent_id=?').run(subagentId);
      const ins=this.db.prepare(`INSERT INTO subagent_capabilities(subagent_id,capability_key,declared_score,verified_score,confidence,evidence_count,source,enabled,updated_at)VALUES(?,?,?,?,?,?,?,?,?)`);
      for(const item of items){
        if(!this.db.prepare('SELECT 1 FROM capability_definitions WHERE key=?').get(item.capability_key))throw new Error('CAPABILITY_NOT_FOUND');
        const prev=existing.get(item.capability_key) as any;
        ins.run(subagentId,item.capability_key,Math.max(0,Math.min(1,item.declared_score??prev?.declared_score??.5)),prev?.verified_score??null,prev?.confidence??0,prev?.evidence_count??0,prev?.source==='learned'?'learned':(item.source??prev?.source??'manual'),item.enabled===false?0:1,now());
      }
    });tx.immediate();return this.listCapabilities(subagentId);
  }

  inferCapabilities(subagentId:string){
    const s=this.get(subagentId);if(!s)throw new Error('SUBAGENT_NOT_FOUND');
    const text=`${s.name} ${s.role} ${s.description} ${s.system_prompt}`.toLowerCase();
    const rules:Array<[string,RegExp,number]>=[
      ['software.frontend.react',/\breact\b|next\.?js|jsx|tsx/i,.9],['software.frontend',/frontend|front-end|interface|ui\b|css|html/i,.8],
      ['software.backend',/backend|back-end|api\b|server|node\.?js|database|banco de dados/i,.85],['software.testing',/test|testing|qa\b|review|debug|bug/i,.8],
      ['software',/software|c[oó]digo|code\b|program|developer|engenheiro|engineer|aplicativo|app\b|site|sistema/i,.7],
      ['marketing.copywriting',/copywriting|copywriter|copy\b|direct response|vsl|criativo|an[uú]ncio/i,.9],['marketing',/marketing|growth|tr[aá]fego|campaign|campanha/i,.75],
      ['video.editing',/edi[cç][aã]o de v[ií]deo|video editing|editor de v[ií]deo|premiere|capcut|after effects/i,.9],['video',/v[ií]deo|video|ugc|storyboard/i,.7],
      ['research',/research|pesquisa|investigar|buscar fontes/i,.8],['operations',/opera[cç][oõ]es|operations|workflow|processo|gest[aã]o/i,.75],
      ['data',/dados|data\b|analytics|sql\b|planilha/i,.8],['design',/design|designer|figma|ux\b|ui\b|visual|layout/i,.8],['security',/seguran[cç]a|security|auth|oauth|permission|vulnerab/i,.85],
    ];
    const existing=this.listCapabilities(subagentId);
    const keep=existing.filter(x=>x.source!=='seed').map(x=>({capability_key:x.capability_key,declared_score:x.declared_score,enabled:x.enabled,source:x.source}));
    const inferred=rules.filter(([key,re])=>re.test(text)&&this.db.prepare('SELECT 1 FROM capability_definitions WHERE key=?').get(key)).map(([key,,score])=>({capability_key:key,declared_score:score,enabled:true,source:'seed'}));
    const seen=new Set(keep.map(x=>x.capability_key));return this.replaceCapabilities(subagentId,[...keep,...inferred.filter(x=>!seen.has(x.capability_key))]);
  }

  private validateBrain(providerId:string|null,modelPk:string|null){
    if(!providerId&&!modelPk)return;
    if(!providerId||!modelPk)throw new Error('SUBAGENT_PROVIDER_MODEL_REQUIRED');
    const row=this.db.prepare('SELECT 1 FROM provider_models WHERE id=? AND provider_id=?').get(modelPk,providerId);
    if(!row)throw new Error('SUBAGENT_MODEL_PROVIDER_MISMATCH');
  }

  private hydrate(row:any){
    const ready=this.readinessRaw(row);
    return {...row,enabled:Boolean(row.enabled),paused:Boolean(row.paused),metadata:parse(row.metadata_json),readiness:ready.status,readiness_reason:ready.reason,capabilities:this.listCapabilities(row.id)};
  }
  private readinessRaw(row:any){
    if(!row.enabled)return{status:'inactive',reason:'Subagent desativado.'};if(row.paused)return{status:'paused',reason:'Subagent pausado.'};if(!row.provider_id||!row.model_id)return{status:'incomplete',reason:'Configure provider e modelo.'};return{status:'configured',reason:'Configuração disponível.'};
  }
}
