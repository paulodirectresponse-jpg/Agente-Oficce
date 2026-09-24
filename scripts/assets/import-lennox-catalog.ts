import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { AssetCategory, AssetInteraction, AssetLayer, AssetRecord, AssetRegistryData } from '../../src/agent-office/assets/assetRegistry.js';
import { AssetRegistrySchema } from '../../src/agent-office/assets/assetRegistry.js';

type PackProfile={match:string;id:string;priority:number;rooms:string[];teams:string[];tags:string[]};
type ProfilesFile={schemaVersion:number;bundle:string;licensePolicy:{licenseId:string;commercialUse:boolean;modificationAllowed:boolean;sourceRedistributionAllowed:boolean;runtimeBundlingAllowed:boolean;aiTrainingAllowed:boolean};packs:PackProfile[]};
type ManifestRow=Record<string,string>;
type SourceRoot={zipPath:string;packName:string;profile:PackProfile;root:string;manifest:Map<string,ManifestRow>};

const CATEGORY_ORDER:AssetCategory[]=[
  'floor','rug','glass','access_control','door','window','whiteboard','server','monitor','computer','tool','plant','coffee','appliance',
  'kitchen','lighting','signage','supply','desk','table','chair','seating','storage','electronics','decor','architecture','vehicle','character','misc',
];

const TEAM_BY_ROOM:Record<string,string[]>={
  development:['development','engineering'],infra:['infra','devops'],research:['research','qa'],operations:['operations'],
  strategy:['strategy'],leadership:['leadership'],design:['design','content','media'],lobby:['reception'],lounge:['general'],general:['general'],
};

function args(){
  const argv=process.argv.slice(2);
  const read=(key:string)=>{const i=argv.indexOf(key);return i>=0?argv[i+1]:undefined};
  const source=read('--source')??process.env.AGENT_OFFICE_ASSET_SOURCE;
  if(!source)throw new Error('Missing --source <folder containing the 18 Lennox ZIPs>.');
  return{
    source:resolve(source),
    output:resolve(read('--output')??'public/office-assets/licensed'),
    profiles:resolve(read('--profiles')??'scripts/assets/lennox-pack-profiles.json'),
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
function slug(v:string){return v.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'asset'}
function norm(v:string){return v.toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()}
function sha(data:Buffer|string){return createHash('sha256').update(data).digest('hex')}
function pngSize(path:string){
  const b=readFileSync(path);
  if(b.length<24||b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error(`Invalid PNG: ${path}`);
  return{width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
}
function unzip(zip:string,dest:string){
  mkdirSync(dest,{recursive:true});
  if(process.platform==='win32'){
    const q=(v:string)=>v.replace(/'/g,"''");
    const r=spawnSync('powershell',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath '${q(zip)}' -DestinationPath '${q(dest)}' -Force`],{stdio:'inherit'});
    if(r.status!==0)throw new Error(`Expand-Archive failed: ${zip}`);
  }else{
    const r=spawnSync('unzip',['-qq','-o',zip,'-d',dest],{stdio:'inherit'});
    if(r.status!==0)throw new Error(`unzip failed: ${zip}`);
  }
}
function csvRows(text:string){
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++;continue}
    if(ch==='"'){quoted=!quoted;continue}
    if(ch===','&&!quoted){row.push(cell);cell='';continue}
    if((ch==='\n'||ch==='\r')&&!quoted){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';continue;
    }
    cell+=ch;
  }
  if(cell||row.length){row.push(cell);rows.push(row)}
  if(rows.length<2)return[];
  const header=rows[0].map(v=>v.trim());
  return rows.slice(1).map(r=>Object.fromEntries(header.map((h,i)=>[h,(r[i]??'').trim()])));
}
function manifest(root:string){
  const result=new Map<string,ManifestRow>();
  for(const p of walk(root)){
    if(!/asset_manifest\.csv$/i.test(p))continue;
    for(const row of csvRows(readFileSync(p,'utf8').replace(/^\uFEFF/,''))){
      const filename=(row.filename||row.file||row.path||'').replace(/\\/g,'/').toLowerCase();
      if(filename)result.set(filename,row);
    }
  }
  return result;
}
function logicalPath(root:string,path:string){
  const parts=relative(root,path).split(sep);
  const idx=parts.findIndex(p=>/^(0\d_|\d+_)/.test(p.toLowerCase())||['characters','props','architecture','furniture','equipment'].includes(p.toLowerCase()));
  return parts.slice(idx>=0?idx:0).join('/');
}
function isReference(path:string,pack:string){
  const v=norm(path),p=pack.toLowerCase();
  if(['master scene','master scenes','reference scene','reference scenes','01 scenes','01 master scenes','00 preview','itch screenshot','screenshots','example layout','demo and engine files','01 static scene','palette 32'].some(x=>v.includes(x)))return true;
  if(/(^|\/)(scene|scenes)[_/ ]/i.test(path))return true;
  if(/with characters|environment only|architecture only|furnished without|scene office|scene reconstructed|scene static|scene frames|master only transparent/i.test(v))return true;
  if(/prop sheets|decoration sheets|transparent sheet|character sheet|office assets part/i.test(v)&&!v.includes('spritesheet'))return true;
  if(p.includes('animated_corporate')&&v.includes('large source png'))return true;
  if(p.includes('luxury')&&v.includes('transparent sprite sheets'))return true;
  return false;
}
function classify(path:string):AssetCategory{
  const v=norm(path),f=norm(basename(path,extname(path)));
  if(v.includes('character')||/\b(worker|employee|manager|receptionist|presenter|participant|operator|analyst|anchor|editor|journalist|technician|officer|staff|trader|trainee|supervisor)\b/.test(f))return'character';
  if(v.includes('tiles and landscaping')&&/^tile /.test(f))return'floor';
  const rules:[AssetCategory,RegExp][]=[
    ['plant',/\b(plant|tree|flower|planter|greenery|succulent|palm|leaf .*pot)\b/],
    ['lighting',/\b(lamp|sconce|lighting|softbox|ceiling light|task light|floor light)\b/],
    ['access_control',/\b(access control|security access|badge reader|turnstile|accessible gate)\b/],
    ['whiteboard',/\b(whiteboard|notice board|noticeboard|kanban|planning board|cork bulletin board|corkboard)\b/],
    ['server',/\b(server|server rack|router|network switch|network cabinet|ups|patch panel)\b/],
    ['monitor',/\b(monitor|monitors|display|screen|tv|dashboard|video wall|analytics)\b/],
    ['computer',/\b(computer|pc\b|laptop|keyboard|mouse|docking station)\b/],
    ['tool',/\b(pliers|wrench|screwdriver|hammer|wire stripper|cable spool|cable coil|tool|repair)\b/],
    ['coffee',/\b(coffee|espresso|water dispenser|water cooler|drink dispenser|vending|snack|kettle|mug|cup|bottle|carafe)\b/],
    ['appliance',/\b(fridge|refrigerator|microwave|sink|toaster|appliance|shredder|soap dispenser)\b/],
    ['signage',/\b(sign|logo|wayfinding|directory|poster|plaque|label|certificate|badge)\b/],
    ['supply',/\b(notebook|folder|binders?|pen holder|clipboard|sticky notes|marker|paper|plates|books and folders|file stack|notepad|organizer|brochure stand|utensil)\b/],
    ['electronics',/\b(printer|copier|copy machine|phone|telephone|tablet|camera|cctv|speaker|microphone|speakerphone|console|terminal|scanner|projector|headset|communicator|control panel|motherboard|power adapter|remote|device)\b/],
    ['seating',/\b(sofa|couch|bench|armchair|loveseat|beanbag)\b/],
    ['chair',/\b(chair|stool)\b/],
    ['storage',/\b(cabinet|shelf|shelves|shelving|locker|drawer|storage|bookcase|bookshelf|credenza|filing|cubby|sorter|sideboard|archive cart|recycling station|caddy|rack)\b/],
    ['desk',/\b(desk|workstation|workbench|reception counter|security counter|operator station|trading station|work counter)\b/],
    ['table',/\b(table|conference table|meeting table|countertop slab|island counter|dining set|lectern)\b/],
    ['kitchen',/\b(kitchen|pantry|breakroom|break room)\b/],
    ['decor',/\b(decor|clock|painting|picture|art|framed|book|trash|waste|bin|magazine|document|tray|box|accessor|centerpiece|mat|cushion|bowl|sculpture|bell|pillow|fire extinguisher|queue post|queue tape)\b/],
    ['rug',/\b(rug|carpet)\b/],
    ['floor',/\b(floor|flooring|pavement|paving|grass tile|walkway|sidewalk|ceramic tile|utility tile)\b/],
    ['glass',/\bglass\b/],
    ['door',/\b(door|entrance gate|double entrance|single entrance)\b/],
    ['window',/\bwindow\b/],
    ['architecture',/\b(wall|divider|corner|join|column|pillar|partition|structure|baseboard|trim|ceiling|opening|border|elevator|ventilation grille|air vent)\b/],
    ['vehicle',/\b(car|vehicle|bike|bicycle)\b/],
  ];
  for(const [category,rule] of rules)if(rule.test(f))return category;
  if(v.includes('architecture'))return'architecture';
  if(v.includes('electronics')||v.includes('equipment'))return'electronics';
  if(v.includes('storage'))return'storage';
  if(v.includes('nature'))return'plant';
  if(v.includes('decorations'))return'decor';
  if(v.includes('tools and parts'))return'tool';
  if(v.includes('office supplies'))return'supply';
  if(v.includes('furniture'))return'decor';
  return'misc';
}
function interaction(c:AssetCategory,path:string):AssetInteraction{
  const v=norm(path);
  if(c==='desk')return'workstation';if(c==='chair'||c==='seating')return/meeting|conference|training/.test(v)?'meeting':'seat';
  if(c==='whiteboard')return'whiteboard';if(c==='server')return'server';
  if(['coffee','kitchen','appliance'].includes(c)&&/coffee|water|drink|kettle|microwave|fridge|snack|pantry/.test(v))return'coffee';
  if(c==='storage')return'storage';if(['monitor','signage','electronics'].includes(c)&&/monitor|display|screen|dashboard|tv|directory/.test(v))return'display';
  if(c==='door')return'door';if(c==='access_control'||v.includes('reception'))return'reception';return'none';
}
function layer(c:AssetCategory,path:string):AssetLayer{
  const v=norm(path);
  if(c==='floor'||c==='rug')return'floor';if(['architecture','window','glass'].includes(c))return/front|lower/.test(v)?'wall_front':'wall_back';
  if(c==='door')return'wall_front';if(c==='character')return'character';if(/foreground|front\b/.test(v))return'furniture_front';
  if(['monitor','computer','electronics','coffee','decor','whiteboard','signage','tool','supply','access_control'].includes(c))return'surface';
  return'furniture_back';
}
function collision(c:AssetCategory){
  if(['floor','rug','decor','lighting','signage','monitor','computer','electronics','whiteboard','tool','supply'].includes(c))return'none' as const;
  if(['plant','chair','seating','door','coffee','access_control','appliance'].includes(c))return'partial' as const;
  return'solid' as const;
}
function extraRooms(path:string,base:string[]){
  const v=norm(path),out=new Set(base);
  const rules:[RegExp,string][]=[
    [/server|network|router|rack|ups/,'infra'],[/studio|broadcast|camera|softbox|editorial|news/,'design'],[/lobby|reception|visitor|turnstile|directory/,'lobby'],
    [/meeting|conference|training|whiteboard/,'strategy'],[/executive|manager|luxury|law|private office/,'leadership'],[/trading|dispatch|call center|operator|dashboard/,'operations'],
    [/qa|research|testing|lab/,'research'],[/coffee|lounge|sofa|break room|pantry|snack/,'lounge'],[/workstation|desk|computer|monitor/,'development'],
  ];
  for(const [r,t] of rules)if(r.test(v))out.add(t);
  return[...out].sort();
}
function assetTags(path:string,c:AssetCategory,profile:PackProfile){
  const v=norm(path),out=new Set([...profile.tags,'pixel-art','top-down','modern-office',c]);
  for(const k of ['glass','wood','gray','blue','cyan','teal','green','black','white','orange','premium','tech','executive','meeting','lounge','modular','double','single','large','small','corner','front','back','left','right','dark','light','standing','seated','animated'])if(v.includes(k))out.add(k);
  if(['monitor','computer','electronics','server'].includes(c))out.add('tech');if(['desk','chair'].includes(c))out.add('work');if(c==='plant')out.add('biophilic');
  return[...out].sort();
}
function findManifestRow(rows:Map<string,ManifestRow>,logical:string){
  const low=logical.toLowerCase();
  for(const [k,v] of rows)if(low.endsWith(k)||k.endsWith(low))return v;
  return undefined;
}
function packRoots(source:string,profiles:ProfilesFile){
  const tmp=mkdtempSync(join(tmpdir(),'agent-office-lennox-'));const roots:SourceRoot[]=[];
  for(const zip of walk(source).filter(p=>extname(p).toLowerCase()==='.zip')){
    const name=basename(zip,'.zip');const profile=profiles.packs.find(p=>new RegExp(p.match,'i').test(name));
    if(!profile)continue;
    const root=join(tmp,slug(profile.id));unzip(zip,root);roots.push({zipPath:zip,packName:name,profile,root,manifest:manifest(root)});
  }
  return{roots,tmp};
}
function stableId(profile:PackProfile,path:string,c:AssetCategory){
  const suffix=sha(`${profile.id}|${path.toLowerCase()}`).slice(0,10);
  return slug(`${c}.${slug(basename(path,extname(path))).slice(0,64)}.${suffix}`).replace(/-/g,'.');
}
function recipe(room:string,assets:AssetRecord[],slots:Record<string,AssetCategory[]>){
  const result:Record<string,string[]>={};
  for(const [slot,cats] of Object.entries(slots)){
    result[slot]=assets.filter(a=>a.roomTags.includes(room)&&cats.includes(a.category)).sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)).slice(0,12).map(a=>a.id);
  }
  return{room,slots:result};
}
function main(){
  const cfg=args();
  if(!existsSync(cfg.source))throw new Error(`Source not found: ${cfg.source}`);
  const profiles=JSON.parse(readFileSync(cfg.profiles,'utf8')) as ProfilesFile;
  const {roots,tmp}=packRoots(cfg.source,profiles);
  if(roots.length!==18)throw new Error(`Expected 18 recognized Lennox packs, found ${roots.length}.`);
  const assets:AssetRecord[]=[];const excluded:{pack:string;path:string;reason:string}[]=[];const seen=new Set<string>();
  const filesDir=join(cfg.output,'files');
  for(const root of roots){
    for(const path of walk(root.root).filter(p=>extname(p).toLowerCase()==='.png')){
      const logical=logicalPath(root.root,path);
      if(isReference(logical,root.packName)){excluded.push({pack:root.profile.id,path:logical,reason:'reference-or-sheet'});continue}
      const hash=sha(readFileSync(path));if(seen.has(hash)){excluded.push({pack:root.profile.id,path:logical,reason:'exact-duplicate'});continue}seen.add(hash);
      const c=classify(logical),size=pngSize(path),rooms=extraRooms(logical,root.profile.rooms);
      const teams=[...new Set([...root.profile.teams,...rooms.flatMap(r=>TEAM_BY_ROOM[r]??['general'])])].sort();
      const row=findManifestRow(root.manifest,logical);let tileSize=32,anchor={x:.5,y:1};let col=collision(c);
      if(row){
        const grid=Number(row.grid_px);if(Number.isFinite(grid)&&grid>0)tileSize=grid;
        const px=Number(row.pivot_x),py=Number(row.pivot_y);
        if(Number.isFinite(px)&&Number.isFinite(py)&&size.width&&size.height)anchor={x:px/size.width,y:py/size.height};
        const hint=(row.collision_hint??'').toLowerCase();if(hint==='none')col='none';else if(hint.includes('footprint'))col='solid';
      }
      const id=stableId(root.profile,logical,c),runtimeName=`${id}.png`,v=norm(logical);
      const asset:AssetRecord={
        id,name:norm(basename(logical,extname(logical))),category:c,
        family:`${c}.${slug(norm(basename(logical,extname(logical))).replace(/\b(front|back|left|right|variant|pose|standing|seated|large|small|\d+)\b/g,'').trim())}`.replace(/-/g,'.'),
        variant:'default',source:{pack:root.profile.id,originalPath:logical,sha256:hash},
        runtime:{uri:`/office-assets/licensed/files/${runtimeName}`,widthPx:size.width,heightPx:size.height,tileSize,anchor,footprint:{width:Math.max(1,Math.min(16,Math.ceil(size.width/tileSize))),height:Math.max(1,Math.min(16,Math.ceil(size.height/tileSize))),unit:'tile'},layer:layer(c,logical),zBias:0,collision:col},
        interaction:interaction(c,logical),tags:assetTags(logical,c,root.profile),roomTags:rooms,teamTags:teams,styleTags:['pixel-art','top-down','agent-office-compatible'],
        rotation:/front|back|left|right|three view|direction/.test(v)?'4-way':'none',
        animation:v.includes('spritesheet')?{kind:'spritesheet',frames:4}:{kind:'none',frames:0},
        license:{...profiles.licensePolicy,sourcePack:root.profile.id,notes:['Licensed source asset. Keep source ZIPs and runtime PNGs out of the public repository.','Do not use source art for AI/ML training or dataset creation.']},
        enabled:true,priority:root.profile.priority+(c==='architecture'||c==='glass'||c==='door'||c==='floor'||c==='desk'||c==='monitor'||c==='chair'||c==='plant'||c==='storage'||c==='server'||c==='whiteboard'?5:0)+(root.profile.id==='top-down-modern-corporate-office-v1.2'&&rooms.includes('development')?12:0),
      };
      assets.push(asset);
      if(!cfg.dryRun){mkdirSync(filesDir,{recursive:true});cpSync(path,join(filesDir,runtimeName));}
    }
  }
  const registry:AssetRegistryData={schemaVersion:1,generatedAt:new Date().toISOString(),tileSize:32,source:{provider:'private-lennox-import',bundle:profiles.bundle},assets};
  AssetRegistrySchema.parse(registry);
  const count=(fn:(a:AssetRecord)=>string[])=>Object.fromEntries([...new Set(assets.flatMap(fn))].sort().map(k=>[k,assets.filter(a=>fn(a).includes(k)).length]));
  const byCategory=Object.fromEntries(CATEGORY_ORDER.filter(c=>assets.some(a=>a.category===c)).map(c=>[c,assets.filter(a=>a.category===c).length]));
  const report={schemaVersion:1,generatedAt:registry.generatedAt,totalAssets:assets.length,excluded:excluded.length,byCategory,byRoom:count(a=>a.roomTags),byTeam:count(a=>a.teamTags),byPack:count(a=>[a.source.pack]),byInteraction:count(a=>[a.interaction]),byLayer:count(a=>[a.runtime.layer])};
  const recipes={
    'workstation.modern':recipe('development',assets,{desk:['desk'],monitor:['monitor'],chair:['chair'],computer:['computer'],plant:['plant']}),
    'meeting.modern':recipe('strategy',assets,{table:['table'],chair:['chair'],whiteboard:['whiteboard'],display:['monitor'],plant:['plant']}),
    'lounge.modern':recipe('lounge',assets,{seating:['seating'],table:['table'],plant:['plant'],coffee:['coffee'],lighting:['lighting']}),
    'server.bay':recipe('infra',assets,{server:['server'],electronics:['electronics'],storage:['storage'],tool:['tool']}),
    'reception.premium':recipe('lobby',assets,{desk:['desk'],seating:['seating'],access:['access_control'],plant:['plant'],signage:['signage']}),
    'media.station':recipe('design',assets,{desk:['desk'],monitor:['monitor'],electronics:['electronics'],lighting:['lighting'],storage:['storage']}),
    'ops.command':recipe('operations',assets,{desk:['desk'],monitor:['monitor'],electronics:['electronics'],storage:['storage'],whiteboard:['whiteboard']}),
  };
  if(!cfg.dryRun){
    mkdirSync(cfg.output,{recursive:true});
    writeFileSync(join(cfg.output,'registry.json'),JSON.stringify(registry,null,2));
    writeFileSync(join(cfg.output,'import-report.json'),JSON.stringify(report,null,2));
    writeFileSync(join(cfg.output,'recipes.json'),JSON.stringify(recipes,null,2));
    writeFileSync(join(cfg.output,'README.private.txt'),'Private licensed runtime catalog. DO NOT COMMIT OR REDISTRIBUTE AS AN ASSET LIBRARY.\n');
  }
  console.log(JSON.stringify({...report,recipes:Object.keys(recipes)},null,2));
  rmSync(tmp,{recursive:true,force:true});
}
main();
