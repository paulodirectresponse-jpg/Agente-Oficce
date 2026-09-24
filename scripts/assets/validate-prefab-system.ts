import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AssetRegistry } from '../../src/agent-office/assets/assetRegistry.js';
import { AssetCalibrationCatalog, calibrateRegistryCoverage } from '../../src/agent-office/assets/assetCalibration.js';
import { DEVELOPMENT_PREFABS } from '../../src/agent-office/assets/developmentPrefabs.js';
import { PrefabLibrary, compilePrefab } from '../../src/agent-office/assets/prefabSystem.js';

const root=resolve(process.argv[2]??'public/office-assets/licensed');
const registryPath=join(root,'registry.json');
const calibrationPath=join(root,'calibration.json');

if(!existsSync(registryPath))throw new Error(`Registry not found: ${registryPath}`);
if(!existsSync(calibrationPath))throw new Error(`Calibration catalog not found: ${calibrationPath}. Run npm run assets:calibrate first.`);

const registry=new AssetRegistry(JSON.parse(readFileSync(registryPath,'utf8')));
const calibrations=new AssetCalibrationCatalog(JSON.parse(readFileSync(calibrationPath,'utf8')));
const library=new PrefabLibrary(DEVELOPMENT_PREFABS);
const errors:string[]=[];

const coverage=calibrateRegistryCoverage(registry,calibrations);
if(!coverage.ok){
  errors.push(...coverage.missing.map(id=>`missing-calibration:${id}`));
  errors.push(...coverage.orphan.map(id=>`orphan-calibration:${id}`));
}

for(const prefab of library.list()){
  for(const placement of prefab.placements){
    if(!registry.has(placement.assetId))errors.push(`missing-prefab-asset:${prefab.id}:${placement.assetId}`);
    if(!calibrations.has(placement.assetId))errors.push(`missing-prefab-calibration:${prefab.id}:${placement.assetId}`);
  }
  try{
    compilePrefab({id:`validate-${prefab.id}`,prefabId:prefab.id,x:1000,y:1000},library,registry,calibrations);
  }catch(error){
    errors.push(`compile:${prefab.id}:${error instanceof Error?error.message:String(error)}`);
  }
}

const duplicateSocketIds:string[]=[];
for(const prefab of library.list()){
  const seen=new Set<string>();
  for(const socket of prefab.sockets){
    if(seen.has(socket.id))duplicateSocketIds.push(`${prefab.id}:${socket.id}`);
    seen.add(socket.id);
  }
}
errors.push(...duplicateSocketIds.map(id=>`duplicate-socket:${id}`));

const summary={
  ok:errors.length===0,
  registryAssets:registry.stats().total,
  calibration:calibrations.stats(),
  prefabs:library.list().map(p=>({id:p.id,placements:p.placements.length,sockets:p.sockets.length})),
  errors,
};

console.log(JSON.stringify(summary,null,2));
if(errors.length)process.exitCode=1;
