import { describe, expect, it } from 'vitest';
import { AssetRegistry } from './assetRegistry.js';
import { AssetCalibrationCatalog, deriveCalibration } from './assetCalibration.js';
import { DEVELOPMENT_PREFABS } from './developmentPrefabs.js';
import { PrefabLibrary } from './prefabSystem.js';
import { compilePrefabRoom, roomSocketIndex, socketsByKind } from './prefabRoom.js';

const license={licenseId:'fixture',sourcePack:'fixture',commercialUse:true,modificationAllowed:true,sourceRedistributionAllowed:false,runtimeBundlingAllowed:true,aiTrainingAllowed:false,notes:[]};

function setup(){
  const ids=[...new Set(DEVELOPMENT_PREFABS.flatMap(p=>p.placements.map(x=>x.assetId)))];
  const assets=ids.map(id=>({
    id,name:id,category:'decor',family:id,variant:'default',
    source:{pack:'fixture',originalPath:id+'.png',sha256:'c'.repeat(64)},
    runtime:{uri:'/x/'+id+'.png',widthPx:96,heightPx:96,tileSize:32,anchor:{x:.5,y:1},footprint:{width:3,height:3,unit:'tile'},layer:'furniture_back',zBias:0,collision:'solid'},
    interaction:'none',tags:[],roomTags:['development'],teamTags:['development'],styleTags:['pixel-art'],rotation:'none',
    animation:{kind:'none',frames:0},license,enabled:true,priority:1,
  }));
  const registry=new AssetRegistry({schemaVersion:1,generatedAt:'2026-09-24',tileSize:32,source:{provider:'test',bundle:'fixture'},assets});
  const calibrations=new AssetCalibrationCatalog({
    schemaVersion:1,generatedAt:'2026-09-24',canonicalTileSize:32,
    assets:assets.map(asset=>deriveCalibration(asset as never,{x:0,y:0,width:96,height:96})),
  });
  return{registry,calibrations,library:new PrefabLibrary(DEVELOPMENT_PREFABS)};
}

describe('prefab room blueprint',()=>{
  it('compiles modules and exposes semantic interaction sockets',()=>{
    const {registry,calibrations,library}=setup();
    const room=compilePrefabRoom({
      schemaVersion:1,id:'development.test',name:'Development',width:1400,height:1000,origin:{x:100,y:50},
      instances:[
        {id:'work',prefabId:'development.workpod.6',x:600,y:450},
        {id:'planning',prefabId:'development.planning-wall',x:650,y:180},
        {id:'meeting',prefabId:'meeting.glass.6',x:1120,y:520},
        {id:'lounge',prefabId:'lounge.standard',x:300,y:720},
        {id:'storage',prefabId:'storage.wall.standard',x:160,y:420},
        {id:'entry',prefabId:'entrance.bottom.open',x:700,y:900},
      ],
      protectedZones:[],tags:['development'],
    },library,registry,calibrations);

    expect(room.prefabs).toHaveLength(6);
    expect(roomSocketIndex(room).size).toBeGreaterThan(10);
    expect(socketsByKind(room,'work')).toHaveLength(6);
  });

  it('protects explicit circulation zones from prefab collisions',()=>{
    const {registry,calibrations,library}=setup();
    const room=compilePrefabRoom({
      schemaVersion:1,id:'development.test',name:'Development',width:1400,height:1000,origin:{x:0,y:0},
      instances:[{id:'work',prefabId:'development.workpod.6',x:700,y:500}],
      protectedZones:[{id:'main-corridor',x:390,y:455,width:620,height:50,tags:['circulation']}],
      tags:[],
    },library,registry,calibrations);
    expect(room.errors.some(error=>error.startsWith('protected-zone-overlap:main-corridor'))).toBe(true);
  });
});
