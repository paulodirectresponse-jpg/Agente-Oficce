import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { AssetCategory, AssetInteraction, AssetLayer, AssetRecord, AssetRegistryData } from '../../src/agent-office/assets/assetRegistry.js';
import { AssetRegistrySchema } from '../../src/agent-office/assets/assetRegistry.js';

type Args={source:string;output:string;includeScenes:boolean;dryRun:boolean};
type ImportFile={pack:string;absolute:string;relative:string};

const DEFAULT_OUTPUT='public/office-assets/licensed';

function args():Args{
  const argv=process.argv.slice(2);
  const read=(key:string)=>{const i=argv.indexOf(key);return i>=0?argv[i+1]:undefined};
  const source=read('--source')??process.env.AGENT_OFFICE_ASSET_SOURCE;
  if(!source)throw new Error('Missing --source <folder-with-zips-or-extracted-packs> or AGENT_OFFICE_ASSET_SOURCE.');
  return{
    source:resolve(source),
    output:resolve(read('--output')??DEFAULT_OUTPUT),
    includeScenes:argv.includes('--include-scenes'),
    dryRun:argv.includes('--dry-run'),
  };
}
function walk(root:string){
  const out:string[]=[];
  for(const name of readdirSync(root)){
    const p=join(root,name);const s=statSync(p);
    if(s.isDirectory())out.push(...walk(p));else out.push(p);
  }
  return out;
}
function slug(v:string){return v.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
function norm(v:string){return v.toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()}
function sha256(path:string){return createHash('sha256').update(readFileSync(path)).digest('hex')}
function pngSize(path:string){
  const b=readFileSync(path);
  if(b.length<24||b.toString('ascii',1,4)!=='PNG')throw new Error(`Invalid PNG: ${path}`);
  return{width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
}
function unzip(zip:string,dest:string){
  mkdirSync(dest,{recursive:true});
  if(process.platform==='win32'){
    const escaped=(v:string)=>v.replace(/'/g,"''");
    const cmd=`Expand-Archive -LiteralPath '${escaped(zip)}' -DestinationPath '${escaped(dest)}' -Force`;
    const r=spawnSync('powershell',['-NoProfile','-NonInteractive','-Command',cmd],{stdio:'inherit'});
    if(r.status!==0)throw new Error(`Expand-Archive failed for ${zip}`);
  }else{
    const r=spawnSync('unzip',['-qq','-o',zip,'-d',dest],{stdio:'inherit'});
    if(r.status!==0)throw new Error(`unzip failed for ${zip}`);
  }
}
function isScene(path:string){
  const v=norm(path);
  return /(scene|preview|example|sample|showcase|furnished|populated|empty room|full office|map)/.test(v);
}
function classify(path:string):AssetCategory{
  const v=norm(path);
  const rules:[RegExp,AssetCategory][]=[
    [/(wall|corner|join|column|pillar|partition|architecture|baseboard|trim|structure)/,'architecture'],
    [/(glass)/,'glass'],[/(door|entrance|gate)/,'door'],[/(window)/,'window'],[/(floor|tile|wood|carpet base)/,'floor'],
    [/(rug|carpet)/,'rug'],[/(whiteboard|board|kanban)/,'whiteboard'],[/(server|rack|network|router|switch|ups)/,'server'],
    [/(monitor|screen|display|tv|dashboard)/,'monitor'],[/(computer|pc|laptop|keyboard|mouse|workstation tech)/,'computer'],
    [/(printer|phone|tablet|camera|cctv|speaker|microphone|electronics|device)/,'electronics'],
    [/(desk|workstation|reception counter)/,'desk'],[/(meeting table|conference table|coffee table|side table|table)/,'table'],
    [/(chair|stool)/,'chair'],[/(sofa|couch|bench|armchair|seat)/,'seating'],[/(cabinet|shelf|shelv|locker|drawer|storage|bookcase)/,'storage'],
    [/(lamp|light|lighting)/,'lighting'],[/(plant|tree|flower|planter)/,'plant'],[/(coffee|espresso|water dispenser|vending)/,'coffee'],
    [/(kitchen|fridge|microwave|sink)/,'kitchen'],[/(sign|logo|wayfinding|poster|plaque)/,'signage'],
    [/(character|worker|employee|person|people|male|female|pose|sprite)/,'character'],[/(car|vehicle|bike)/,'vehicle'],
    [/(decor|clock|painting|picture|book|trash|bin|prop|accessor)/,'decor'],
  ];
  return rules.find(([r])=>r.test(v))?.[1]??'misc';
}
function interaction(c:AssetCategory,path:string):AssetInteraction{
  const v=norm(path);
  if(c==='desk'||/workstation/.test(v))return'workstation';
  if(c==='chair'||c==='seating')return /meeting|conference/.test(v)?'meeting':'seat';
  if(c==='whiteboard')return'whiteboard';if(c==='server')return'server';if(c==='coffee'||c==='kitchen')return'coffee';
  if(c==='storage')return'storage';if(c==='monitor'||c==='signage')return'display';if(c==='door')return'door';
  if(/reception/.test(v))return'reception';return'none';
}
function layer(c:AssetCategory,path:string):AssetLayer{
  const v=norm(path);
  if(c==='floor'||c==='rug')return'floor';
  if(['architecture','window','glass'].includes(c))return /front|lower/.test(v)?'wall_front':'wall_back';
  if(c==='door')return'wall_front';
  if(c==='character')return'character';
  if(/foreground|front/.test(v))return'furniture_front';
  if(['monitor','computer','electronics','coffee','decor','whiteboard','signage'].includes(c))return'surface';
  if(['plant','chair','seating','desk','table','server','storage','lighting','kitchen'].includes(c))return'furniture_back';
  return'furniture_back';
}
function roomTags(path:string,pack:string){
  const v=norm(path+' '+pack);const out=new Set<string>();
  const map:[RegExp,string][]=[
    [/(dev|computer|workstation|corporate office)/,'development'],[/(server|network|it |infra)/,'infra'],
    [/(research|qa|whiteboard|testing)/,'research'],[/(dispatch|call center|operations|trading)/,'operations'],
    [/(headquarter|executive|luxury|law firm)/,'leadership'],[/(meeting|training|conference|strategy)/,'strategy'],
    [/(newsroom|studio|broadcast|editorial|design)/,'design'],[/(lobby|reception|visitor)/,'lobby'],
    [/(lounge|break|coffee|kitchen)/,'lounge'],
  ];
  for(const [r,t] of map)if(r.test(v))out.add(t);
  if(!out.size)out.add('general');
  return[...out];
}
function teamTags(rooms:string[]){
  const map:Record<string,string[]>={
    development:['development','engineering'],infra:['infra','devops'],research:['research','qa'],
    operations:['operations'],leadership:['leadership'],strategy:['strategy'],design:['design','content'],
    lobby:['reception'],lounge:['general'],
  };
  return [...new Set(rooms.flatMap(r=>map[r]??['general']))];
}
function tags(path:string,c:AssetCategory){
  const v=norm(path);const out=new Set<string>(['modern','corporate',c]);
  const keys=['glass','wood','dark','light','blue','cyan','green','black','white','premium','tech','executive','meeting','lounge','modular','double','single','large','small','corner','front','back','left','right'];
  for(const k of keys)if(v.includes(k))out.add(k);
  if(/server|monitor|computer|network|screen/.test(v))out.add('tech');
  if(/desk|workstation/.test(v))out.add('work');
  if(/plant|green/.test(v))out.add('biophilic');
  return[...out];
}
function familyFor(path:string,c:AssetCategory){
  let b=norm(basename(path,extname(path)));
  b=b.replace(/\b(v|variant|frame|pose|front|back|left|right|top|bottom)\s*\d*\b/g,'').replace(/\b\d+\b/g,'').trim();
  return slug(`${c}.${b||c}`).replace(/-/g,'.');
}
function variantFor(path:string){
  const v=norm(basename(path,extname(path)));const found=['front','back','left','right','corner','dark','light','blue','green','black','white'].filter(k=>v.includes(k));
  const n=v.match(/(?:variant|v|frame|pose)?\s*(\d+)$/)?.[1];
  return slug([...found,n].filter(Boolean).join('-')||'default');
}
function footprint(width:number,height:number,c:AssetCategory){
  const tile=32;
  const w=Math.max(1,Math.round(width/tile)),h=Math.max(1,Math.round(height/tile));
  if(c==='architecture'||c==='glass'||c==='door'||c==='window')return{width:w,height:h,unit:'tile' as const};
  return{width:Math.min(w,12),height:Math.min(h,12),unit:'tile' as const};
}
function collision(c:AssetCategory){
  if(['floor','rug','decor','lighting','signage','monitor','computer','electronics'].includes(c))return'none' as const;
  if(['plant','chair','seating','door'].includes(c))return'partial' as const;
  return'solid' as const;
}
function assetId(pack:string,path:string,c:AssetCategory){
  const base=slug(basename(path,extname(path))).slice(0,48)||c;
  // IDs are based on source identity, not PNG bytes, so updating artwork does not break RoomLayout references.
  const stable=createHash('sha256').update(`${pack}|${path}`).digest('hex').slice(0,8);
  return slug(`${c}.${base}.${stable}`).replace(/-/g,'.');
}
function sourceRoots(source:string){
  const tmp=mkdtempSync(join(tmpdir(),'agent-office-assets-'));const roots:{pack:string;root:string;temp:boolean}[]=[];
  for(const p of walk(source)){
    if(extname(p).toLowerCase()!=='.zip')continue;
    const name=basename(p,'.zip');const out=join(tmp,slug(name));unzip(p,out);roots.push({pack:name,root:out,temp:true});
  }
  const dirs=readdirSync(source).map(n=>join(source,n)).filter(p=>statSync(p).isDirectory());
  for(const d of dirs)roots.push({pack:basename(d),root:d,temp:false});
  return{roots,tmp};
}
function discover(roots:{pack:string;root:string}[],includeScenes:boolean){
  const files:ImportFile[]=[];
  for(const r of roots)for(const p of walk(r.root)){
    if(extname(p).toLowerCase()!=='.png')continue;
    const rel=relative(r.root,p).split(sep).join('/');
    if(!includeScenes&&isScene(rel))continue;
    files.push({pack:r.pack,absolute:p,relative:rel});
  }
  return files;
}
function main(){
  const cfg=args();
  if(!existsSync(cfg.source))throw new Error(`Source not found: ${cfg.source}`);
  const {roots,tmp}=sourceRoots(cfg.source);
  if(!roots.length)throw new Error('No ZIPs or extracted pack folders found.');
  const input=discover(roots,cfg.includeScenes);
  const hashes=new Map<string,string>();
  const assets:AssetRecord[]=[];const skipped:{path:string;reason:string}[]=[];
  const runtimeDir=join(cfg.output,'files');

  for(const f of input){
    try{
      const {width,height}=pngSize(f.absolute);const hash=sha256(f.absolute);
      if(hashes.has(hash)){skipped.push({path:`${f.pack}/${f.relative}`,reason:`duplicate-of:${hashes.get(hash)}`});continue}
      const category=classify(f.relative);const rooms=roomTags(f.relative,f.pack);const id=assetId(f.pack,f.relative,category);
      hashes.set(hash,id);
      const runtimeName=`${id}.png`;const uri=`/office-assets/licensed/files/${runtimeName}`;
      const record:AssetRecord={
        id,name:norm(basename(f.relative,extname(f.relative))),category,
        family:familyFor(f.relative,category),variant:variantFor(f.relative),
        source:{pack:f.pack,originalPath:f.relative,sha256:hash},
        runtime:{
          uri,widthPx:width,heightPx:height,tileSize:32,anchor:{x:.5,y:1},
          footprint:footprint(width,height,category),layer:layer(category,f.relative),zBias:0,collision:collision(category),
        },
        interaction:interaction(category,f.relative),tags:tags(f.relative,category),roomTags:rooms,teamTags:teamTags(rooms),
        styleTags:['pixel-art','top-down','modern-office'],rotation:/front|back|left|right/i.test(f.relative)?'4-way':'none',
        animation:/spritesheet|animation|frame/i.test(f.relative)?{kind:'spritesheet',frames:1}:{kind:'none',frames:0},
        license:{
          licenseId:'lennox-commercial-pack',sourcePack:f.pack,commercialUse:true,modificationAllowed:true,
          sourceRedistributionAllowed:false,runtimeBundlingAllowed:true,aiTrainingAllowed:false,
          notes:['Licensed source asset. Do not redistribute as a standalone asset library.','AI-training disabled conservatively for the whole imported bundle.'],
        },
        enabled:true,priority:rooms.includes('development')?20:10,
      };
      assets.push(record);
      if(!cfg.dryRun){mkdirSync(runtimeDir,{recursive:true});cpSync(f.absolute,join(runtimeDir,runtimeName));}
    }catch(error){skipped.push({path:`${f.pack}/${f.relative}`,reason:error instanceof Error?error.message:String(error)})}
  }

  const registry:AssetRegistryData={schemaVersion:1,generatedAt:new Date().toISOString(),tileSize:32,source:{provider:'local-import',bundle:'Office Pixel Art Mega Bundle'},assets};
  AssetRegistrySchema.parse(registry);
  const byCategory=Object.fromEntries([...new Set(assets.map(a=>a.category))].sort().map(c=>[c,assets.filter(a=>a.category===c).length]));
  const byRoom=Object.fromEntries([...new Set(assets.flatMap(a=>a.roomTags))].sort().map(r=>[r,assets.filter(a=>a.roomTags.includes(r)).length]));
  const packs=Object.fromEntries(roots.map(r=>[r.pack,assets.filter(a=>a.source.pack===r.pack).length]));
  const report={schemaVersion:1,generatedAt:registry.generatedAt,source:cfg.source,output:cfg.output,totalAssets:assets.length,skippedCount:skipped.length,byCategory,byRoom,packs,skipped};

  if(!cfg.dryRun){
    mkdirSync(cfg.output,{recursive:true});
    writeFileSync(join(cfg.output,'registry.json'),JSON.stringify(registry,null,2));
    writeFileSync(join(cfg.output,'import-report.json'),JSON.stringify(report,null,2));
    writeFileSync(join(cfg.output,'README.private.txt'),'Generated from licensed local source packs. DO NOT COMMIT this directory.\n');
  }
  console.log(JSON.stringify(report,null,2));
  rmSync(tmp,{recursive:true,force:true});
}
main();
