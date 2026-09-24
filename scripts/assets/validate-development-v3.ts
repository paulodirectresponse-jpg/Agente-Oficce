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

console.log(JSON.stringify({
  ok:errors.length===0,
  registryAssets:registry.stats().total,
  requiredAssets:required.length,
  placements:DEVELOPMENT_V3_PLACEMENTS.length,
  characterSets:DEVELOPMENT_V3_AGENT_SPRITES.length,
  interactions:DEVELOPMENT_V3_ROOM_LAYOUT.interactions.length,
  errors,
},null,2));

if(errors.length)process.exitCode=1;
