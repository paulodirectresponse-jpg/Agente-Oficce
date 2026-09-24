import { describe, expect, it } from 'vitest';
import { AssetRegistry } from './assetRegistry.js';
import { AssetCalibrationCatalog, deriveCalibration } from './assetCalibration.js';
import { DEVELOPMENT_PREFABS } from './developmentPrefabs.js';
import { PrefabLibrary, compilePrefab, validatePrefabComposition } from './prefabSystem.js';

const license={licenseId:'fixture',sourcePack:'fixture',commercialUse:true,modificationAllowed:true,sourceRedistributionAllowed:false,runtimeBundlingAllowed:true,aiTrainingAllowed:false,notes:[]};

function makeAsset(id:string,category:string,width=96,height=96){
  return{
    id,name:id,category,family:id,variant:'default',
    source:{pack:'fixture',originalPath:id+'.png',sha256:'b'.repeat(64)},
    runtime:{uri:'/x/'+id+'.png',widthPx:width,heightPx:height,tileSize:32,anchor:{x:.5,y:1},footprint:{width:3,height:3,unit:'tile'},layer:'furniture_back',zBias:0,collision:'solid'},
    interaction:'none',tags:[],roomTags:['development'],teamTags:['development'],styleTags:['pixel-art'],rotation:'none',
    animation:{kind:'none',frames:0},license,enabled:true,priority:1,
  };
}

function fixture(){
  const ids=new Set(DEVELOPMENT_PREFABS.flatMap(p=>p.placements.map(x=>x.assetId)));
  const category=(id:string)=>{
    if(id.includes('rug.'))return'rug';
    if(id.includes('glass.'))return'glass';
    if(id.includes('chair.'))return'chair';
    if(id.includes('desk.'))return'desk';
    if(id.includes('plant.'))return'plant';
    if(id.includes('storage.'))return'storage';
    if(id.includes('whiteboard.'))return'whiteboard';
    if(id.includes('monitor.'))return'monitor';
    if(id.includes('lighting.'))return'lighting';
    if(id.includes('coffee.'))return'coffee';
    if(id.includes('electronics.'))return'electronics';
    if(id.includes('table.'))return'table';
    if(id.includes('seating.'))return'seating';
    return'decor';
  };
  const assets=[...ids].map(id=>makeAsset(id,category(id)));
  const registry=new AssetRegistry({schemaVersion:1,generatedAt:'2026-09-24',tileSize:32,source:{provider:'test',bundle:'fixture'},assets});
  const calibrations=new AssetCalibrationCatalog({
    schemaVersion:1,generatedAt:'2026-09-24',canonicalTileSize:32,
    assets:assets.map(a=>deriveCalibration(a as never,{x:8,y:12,width:80,height:76})),
  });
  return{registry,calibrations};
}

describe('prefab system',()=>{
  it('compiles the six-person Development work pod from calibrated assets',()=>{
    const {registry,calibrations}=fixture();
    const library=new PrefabLibrary(DEVELOPMENT_PREFABS);
    const compiled=compilePrefab({id:'work',prefabId:'development.workpod.6',x:800,y:500},library,registry,calibrations);
    expect(compiled.nodes).toHaveLength(8);
    expect(compiled.sockets.filter(s=>s.kind==='work')).toHaveLength(6);
    expect(compiled.nodes.every(node=>node.sourceRect.width===80)).toBe(true);
  });

  it('positions sockets in world coordinates instead of PNG coordinates',()=>{
    const {registry,calibrations}=fixture();
    const library=new PrefabLibrary(DEVELOPMENT_PREFABS);
    const compiled=compilePrefab({id:'work',prefabId:'development.workpod.6',x:800,y:500},library,registry,calibrations);
    const seat=compiled.sockets.find(s=>s.id==='work:seat1');
    expect(seat).toBeDefined();
    expect(seat!.x).toBe(605);
    expect(seat!.y).toBe(445);
  });

  it('keeps internal placements locked to the prefab rather than room-level arbitrary scales',()=>{
    const work=DEVELOPMENT_PREFABS.find(p=>p.id==='development.workpod.6')!;
    expect(work.placements.every(p=>['compact','standard','spacious'].includes(p.scaleToken))).toBe(true);
    expect(work.placements.some(p=>(p as unknown as {scale?:number}).scale!==undefined)).toBe(false);
  });

  it('detects keep-clear violations between prefab modules',()=>{
    const {registry,calibrations}=fixture();
    const library=new PrefabLibrary(DEVELOPMENT_PREFABS);
    const work=compilePrefab({id:'work',prefabId:'development.workpod.6',x:800,y:500},library,registry,calibrations);
    const lounge=compilePrefab({id:'lounge',prefabId:'lounge.standard',x:800,y:660},library,registry,calibrations);
    expect(validatePrefabComposition([work,lounge]).ok).toBe(false);
  });

  it('supports the approved Development module families',()=>{
    const ids=DEVELOPMENT_PREFABS.map(p=>p.id);
    expect(ids).toEqual(expect.arrayContaining([
      'development.workpod.6','development.planning-wall','meeting.glass.6',
      'lounge.standard','storage.wall.standard','entrance.bottom.open',
    ]));
  });
});
