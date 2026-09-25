import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AssetRegistry } from '../../src/agent-office/assets/assetRegistry.js';
import { AssetCalibrationCatalog, calibrateRegistryCoverage } from '../../src/agent-office/assets/assetCalibration.js';
import { compileDevelopment52B } from '../../src/agent-office/room/developmentPrefabRoom.js';
import { requiredDevelopment52BAssetIds } from '../../src/agent-office/room/developmentPrefabRenderer.js';
import { DEVELOPMENT_V3_AGENT_SPRITES } from '../../src/agent-office/room/developmentV3.js';

const root=resolve(process.argv[2]??'public/office-assets/licensed');
const registryPath=join(root,'registry.json');
const calibrationPath=join(root,'calibration.json');
const filesRoot=join(root,'files');
const errors:string[]=[];

if(!existsSync(registryPath))errors.push('registry.json');
if(!existsSync(calibrationPath))errors.push('calibration.json');
if(!existsSync(filesRoot))errors.push('files/');
if(errors.length)throw new Error(`Stage 5.2B private runtime incomplete: ${errors.join(', ')}`);

const registry=new AssetRegistry(JSON.parse(readFileSync(registryPath,'utf8')));
const calibrations=new AssetCalibrationCatalog(JSON.parse(readFileSync(calibrationPath,'utf8')));
const coverage=calibrateRegistryCoverage(registry,calibrations);
if(!coverage.ok){
  errors.push(...coverage.missing.map(id=>`missing-calibration:${id}`));
  errors.push(...coverage.orphan.map(id=>`orphan-calibration:${id}`));
}

if(registry.has('scene.development.approved.v1')){
  errors.push('static-approved-backdrop-must-not-be-present');
}

let runtime;
try{
  runtime=compileDevelopment52B(registry,calibrations);
}catch(error){
  errors.push(error instanceof Error?error.message:String(error));
}

if(runtime){
  const ids=new Set([
    ...requiredDevelopment52BAssetIds(runtime),
    ...DEVELOPMENT_V3_AGENT_SPRITES.flatMap(sprite=>[sprite.idle,sprite.working]),
  ]);
  for(const id of ids){
    const asset=registry.get(id);
    if(!asset){errors.push(`missing-required-asset:${id}`);continue}
    if(!calibrations.has(id))errors.push(`missing-required-calibration:${id}`);
    const file=join(filesRoot,asset.runtime.uri.split('/').pop()??'');
    if(!existsSync(file))errors.push(`missing-runtime-file:${id}`);
  }

  if(runtime.workSockets.length!==6)errors.push(`work-sockets:${runtime.workSockets.length}`);
  if(runtime.workSockets.some(socket=>socket.source!=='asset')){
    errors.push('work-sockets-not-calibrated');
  }
}

console.log(JSON.stringify({
  ok:errors.length===0,
  registryAssets:registry.stats().total,
  calibration:calibrations.stats(),
  workSockets:runtime?.workSockets.length??0,
  prefabs:runtime?.room.prefabs.map(p=>p.instance.id)??[],
  staticBackdrop:registry.has('scene.development.approved.v1'),
  errors,
},null,2));

if(errors.length)process.exitCode=1;
