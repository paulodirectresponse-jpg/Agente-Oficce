import fs from 'node:fs';
import type { Database } from 'better-sqlite3';
import { getProjectRootSetting } from './appSettings.js';
import { getFullAccessToolHealth } from './fullAccessTools.js';

export interface ReleasePreflightCheck {
  id:string;
  label:string;
  status:'pass'|'warn'|'fail';
  detail:string;
  blocking:boolean;
}

export interface ReleasePreflightReport {
  generated_at:string;
  ready:boolean;
  migration_version:number;
  checks:ReleasePreflightCheck[];
}

export async function runReleasePreflight(db:Database,activeTools=false,options:{toolHealth?:Array<Record<string,unknown>>}={}):Promise<ReleasePreflightReport>{
  const checks:ReleasePreflightCheck[]=[];
  const add=(id:string,label:string,status:ReleasePreflightCheck['status'],detail:string,blocking:boolean)=>checks.push({id,label,status,detail,blocking});

  const quick=db.prepare('PRAGMA quick_check').get() as any;
  add('database.integrity','Database integrity',quick?.quick_check==='ok'?'pass':'fail',String(quick?.quick_check??'unknown'),true);

  const fk=db.prepare('PRAGMA foreign_key_check').all();
  add('database.foreign_keys','Foreign keys',fk.length?'fail':'pass',fk.length?String(fk.length)+' violations':'No violations',true);

  const migration=Number((db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as any)?.version??0);
  add('database.migrations','Migrations',migration>=22?'pass':'fail','Schema migration '+migration,true);

  const root=getProjectRootSetting(db);
  const rootExists=fs.existsSync(root.path);
  add('projects.root','Project root',root.configured&&rootExists?'pass':'warn',
    root.configured?root.path:'Not explicitly configured; suggested path: '+root.path,false);

  const providers=Number((db.prepare('SELECT COUNT(*) n FROM providers WHERE enabled=1').get() as any)?.n??0);
  add('providers.enabled','Enabled providers',providers>0?'pass':'warn',String(providers)+' enabled',false);

  const models=Number((db.prepare('SELECT COUNT(*) n FROM provider_models WHERE enabled=1').get() as any)?.n??0);
  add('models.enabled','Enabled models',models>0?'pass':'warn',String(models)+' enabled',false);

  const agents=Number((db.prepare('SELECT COUNT(*) n FROM agents WHERE enabled=1').get() as any)?.n??0);
  add('agents.enabled','Enabled agents',agents>0?'pass':'warn',String(agents)+' enabled',false);

  const tools=options.toolHealth??await getFullAccessToolHealth(root.path,activeTools);
  for(const id of ['files','shell','git']){
    const tool=tools.find(x=>x.id===id) as any;
    add('runtime.'+id,'Runtime '+id,tool?.status==='healthy'?'pass':'fail',String(tool?.detail??'Unavailable'),true);
  }
  for(const id of ['github','browser','computer']){
    const tool=tools.find(x=>x.id===id) as any;
    add('runtime.'+id,'Runtime '+id,tool?.status==='healthy'?'pass':'warn',String(tool?.detail??'Unavailable'),false);
  }

  return{
    generated_at:new Date().toISOString(),
    ready:!checks.some(x=>x.blocking&&x.status==='fail'),
    migration_version:migration,
    checks,
  };
}
