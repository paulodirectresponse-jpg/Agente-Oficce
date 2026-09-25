import { describe, expect, it } from 'vitest';
import { AssetRegistry } from '../assets/assetRegistry.js';
import { AssetCalibrationCatalog, deriveCalibration } from '../assets/assetCalibration.js';
import { DEVELOPMENT_PREFABS } from '../assets/developmentPrefabs.js';
import { compileDevelopment52B, DEVELOPMENT_52B_BLUEPRINT } from './developmentPrefabRoom.js';

const license={licenseId:'fixture',sourcePack:'fixture',commercialUse:true,modificationAllowed:true,sourceRedistributionAllowed:false,runtimeBundlingAllowed:true,aiTrainingAllowed:false,notes:[]};

function category(id:string){
  if(id.startsWith('architecture.'))return'architecture';
  if(id.startsWith('glass.'))return'glass';
  if(id.startsWith('desk.'))return'desk';
  if(id.startsWith('rug.'))return'rug';
  if(id.startsWith('table.'))return'table';
  if(id.startsWith('chair.'))return'chair';
  if(id.startsWith('seating.'))return'seating';
  if(id.startsWith('monitor.'))return'monitor';
  if(id.startsWith('whiteboard.'))return'whiteboard';
  if(id.startsWith('storage.'))return'storage';
  if(id.startsWith('plant.'))return'plant';
  if(id.startsWith('lighting.'))return'lighting';
  if(id.startsWith('electronics.'))return'electronics';
  if(id.startsWith('coffee.'))return'coffee';
  return'decor';
}

function fixture(){
  const ids=[...new Set(DEVELOPMENT_PREFABS.flatMap(p=>p.placements.map(x=>x.assetId)))];
  const assets=ids.map(id=>({
    id,name:id,category:category(id),family:id,variant:'default',
    source:{pack:'fixture',originalPath:id+'.png',sha256:'a'.repeat(64)},
    runtime:{uri:'/assets/'+id+'.png',widthPx:128,heightPx:128,tileSize:32,anchor:{x:.5,y:1},footprint:{width:4,height:4,unit:'tile'},layer:'furniture_back',zBias:0,collision:'solid'},
    interaction:'none',tags:[],roomTags:['development'],teamTags:['development'],styleTags:['pixel-art'],rotation:'none',
    animation:{kind:'none',frames:0},license,enabled:true,priority:1,
  }));
  const registry=new AssetRegistry({schemaVersion:1,generatedAt:'2026-09-24',tileSize:32,source:{provider:'fixture',bundle:'fixture'},assets});
  const calibrations=new AssetCalibrationCatalog({
    schemaVersion:1,generatedAt:'2026-09-24',canonicalTileSize:32,
    assets:assets.map(asset=>deriveCalibration(asset as never,{x:4,y:4,width:120,height:120})),
  });
  return{registry,calibrations};
}

describe('Development 5.2B prefab room',()=>{
  it('compiles the approved room modules without overlap or protected-zone violations',()=>{
    const {registry,calibrations}=fixture();
    const runtime=compileDevelopment52B(registry,calibrations);
    expect(runtime.room.errors).toEqual([]);
    expect(runtime.room.prefabs.map(p=>p.instance.id)).toEqual([
      'shell','planning','work','meeting','lounge','storage','support-right','entry',
    ]);
  });

  it('provides six canonical work targets plus semantic support targets',()=>{
    const {registry,calibrations}=fixture();
    const runtime=compileDevelopment52B(registry,calibrations);
    expect(runtime.workSockets).toHaveLength(6);
    expect(runtime.planningSockets.length).toBeGreaterThanOrEqual(1);
    expect(runtime.meetingSockets.length).toBeGreaterThanOrEqual(4);
    expect(runtime.loungeSockets.length).toBeGreaterThanOrEqual(3);
    expect(runtime.entrySockets.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the main entrance as an open passage rather than a decorative door asset',()=>{
    expect(DEVELOPMENT_52B_BLUEPRINT.instances.some(i=>i.prefabId==='entrance.bottom.open')).toBe(true);
    const entry=DEVELOPMENT_PREFABS.find(p=>p.id==='entrance.bottom.open');
    expect(entry?.placements).toHaveLength(0);
  });

  it('uses prefabs rather than the approved static concept image',()=>{
    const referenced=DEVELOPMENT_PREFABS.flatMap(p=>p.placements.map(x=>x.assetId));
    expect(referenced).not.toContain('scene.development.approved.v1');
  });
});
