import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { AssetRegistry } from '../../src/agent-office/assets/assetRegistry.js';
import {
  AssetCalibrationCatalogSchema,
  deriveCalibration,
  type CalibrationOverride,
} from '../../src/agent-office/assets/assetCalibration.js';
import { pngAlphaBounds } from './png-alpha-bounds.js';

type OverrideFile={schemaVersion?:number;overrides:CalibrationOverride[]};

function args(){
  const argv=process.argv.slice(2);
  const read=(key:string)=>{const i=argv.indexOf(key);return i>=0?argv[i+1]:undefined};
  const root=resolve(read('--root')??'public/office-assets/licensed');
  return{
    root,
    registry:resolve(read('--registry')??join(root,'registry.json')),
    output:resolve(read('--output')??join(root,'calibration.json')),
    overrides:read('--overrides')?resolve(read('--overrides')!):undefined,
  };
}

function loadOverrides(path?:string){
  const map=new Map<string,CalibrationOverride>();
  if(!path)return map;
  if(!existsSync(path))throw new Error(`Calibration overrides not found: ${path}`);
  const parsed=JSON.parse(readFileSync(path,'utf8')) as OverrideFile|CalibrationOverride[];
  const rows=Array.isArray(parsed)?parsed:parsed.overrides;
  for(const row of rows){
    if(!row.assetId)throw new Error('Calibration override missing assetId');
    map.set(row.assetId,row);
  }
  return map;
}

function main(){
  const cfg=args();
  if(!existsSync(cfg.registry))throw new Error(`Registry not found: ${cfg.registry}`);
  const registry=new AssetRegistry(JSON.parse(readFileSync(cfg.registry,'utf8')));
  const overrides=loadOverrides(cfg.overrides);
  const calibrations=[];

  for(const asset of registry.list()){
    const file=join(cfg.root,'files',basename(asset.runtime.uri));
    if(!existsSync(file))throw new Error(`Runtime asset missing: ${asset.id} -> ${file}`);
    const scanned=pngAlphaBounds(readFileSync(file));
    const calibration=deriveCalibration(asset,{
      x:scanned.x,y:scanned.y,width:scanned.width,height:scanned.height,
    },registry.data.tileSize,overrides.get(asset.id));
    calibrations.push(calibration);
  }

  const data=AssetCalibrationCatalogSchema.parse({
    schemaVersion:1,
    generatedAt:new Date().toISOString(),
    canonicalTileSize:registry.data.tileSize,
    assets:calibrations,
  });
  writeFileSync(cfg.output,JSON.stringify(data,null,2));

  const summary={
    ok:true,
    output:cfg.output,
    assets:calibrations.length,
    fullyOpaque:calibrations.filter(c=>c.alphaBounds.x===0&&c.alphaBounds.y===0&&c.alphaBounds.width===c.sourceWidth&&c.alphaBounds.height===c.sourceHeight).length,
    trimmed:calibrations.filter(c=>c.alphaBounds.x>0||c.alphaBounds.y>0||c.alphaBounds.width<c.sourceWidth||c.alphaBounds.height<c.sourceHeight).length,
    curated:calibrations.filter(c=>c.confidence==='curated').length,
    manifest:calibrations.filter(c=>c.confidence==='manifest').length,
    auto:calibrations.filter(c=>c.confidence==='auto').length,
    withSockets:calibrations.filter(c=>c.sockets.length>0).length,
  };
  console.log(JSON.stringify(summary,null,2));
}

main();
