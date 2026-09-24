import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DEVELOPMENT_V3_AGENT_SPRITES, DEVELOPMENT_V3_PLACEMENTS, requiredDevelopmentV3AssetIds, validateDevelopmentV3Composition } from '../../src/agent-office/room/developmentV3.js';
import { AssetRegistry } from '../../src/agent-office/assets/assetRegistry.js';
import { validateRoomLayoutAssets } from '../../src/agent-office/assets/officeSpec.js';
import { DEVELOPMENT_V3_ROOM_LAYOUT } from '../../src/agent-office/room/developmentV3.js';

const root=resolve(process.argv[2]??'public/office-assets/licensed');
const registryPath=join(root,'registry.json');
if(!existsSync(registryPath))throw new Error(`Private registry not found: ${registryPath}`);
const registry=new AssetRegistry(JSON.parse(readFileSync(registryPath,'utf8')));
const required=requiredDevelopmentV3AssetIds();
const errors:string[]=[];

for(const id of required){
  const asset=registry.get(id);
  if(!asset){errors.push(`missing-asset:${id}`);continue}
  const file=join(root,'files',basename(asset.runtime.uri));
  if(!existsSync(file)){errors.push(`missing-file:${id}`);continue}
  if(statSync(file).size<=0)errors.push(`empty-file:${id}`);
}

const layoutGate=validateRoomLayoutAssets(registry,DEVELOPMENT_V3_ROOM_LAYOUT);
if(!layoutGate.valid){
  errors.push(...layoutGate.missing.map(id=>`layout-missing:${id}`));
  errors.push(...layoutGate.duplicatePlacementIds.map(id=>`duplicate-placement:${id}`));
}

if(DEVELOPMENT_V3_PLACEMENTS.filter(p=>p.assetId.includes('workstation')).length!==6)errors.push('workstation-count');
if(DEVELOPMENT_V3_AGENT_SPRITES.length<6)errors.push('character-variants');
const composition=validateDevelopmentV3Composition();
errors.push(...composition.errors.map(error=>`composition:${error}`));

const majorFurniture=DEVELOPMENT_V3_PLACEMENTS.filter(p=>
  p.id.startsWith('ws-')||
  ['storage-bookcase','storage-cabinet','meeting-table','meeting-chair-north','meeting-chair-south','meeting-chair-west','meeting-chair-east','lounge-sofa','lounge-table'].includes(p.id)
);
const box=(p:(typeof majorFurniture)[number])=>{
  const asset=registry.get(p.assetId);
  if(!asset)return null;
  const w=asset.runtime.widthPx*p.scale*.68;
  const h=asset.runtime.heightPx*p.scale*.68;
  const ax=p.anchorX??asset.runtime.anchor.x??.5;
  const ay=p.anchorY??asset.runtime.anchor.y??1;
  return{x1:p.x-w*ax,y1:p.y-h*ay,x2:p.x+w*(1-ax),y2:p.y+h*(1-ay)};
};
const overlaps=(a:ReturnType<typeof box>,b:ReturnType<typeof box>)=>Boolean(a&&b&&a.x1<b.x2&&a.x2>b.x1&&a.y1<b.y2&&a.y2>b.y1);
const allowedOverlap=(a:string,b:string)=>{
  const pair=new Set([a,b]);
  if(pair.has('meeting-table')&&[...pair].some(id=>id.startsWith('meeting-chair-')))return true;
  return false;
};
for(let i=0;i<majorFurniture.length;i++){
  for(let j=i+1;j<majorFurniture.length;j++){
    const a=majorFurniture[i],b=majorFurniture[j];
    if(allowedOverlap(a.id,b.id))continue;
    if(overlaps(box(a),box(b)))errors.push(`major-furniture-overlap:${a.id}:${b.id}`);
  }
}

console.log(JSON.stringify({
  ok:errors.length===0,
  registryAssets:registry.stats().total,
  requiredAssets:required.length,
  placements:DEVELOPMENT_V3_PLACEMENTS.length,
  characterSets:DEVELOPMENT_V3_AGENT_SPRITES.length,
  interactions:DEVELOPMENT_V3_ROOM_LAYOUT.interactions.length,
  compositionChecks:composition.errors.length===0,
  majorFurnitureChecked:majorFurniture.length,
  errors,
},null,2));

if(errors.length)process.exitCode=1;
