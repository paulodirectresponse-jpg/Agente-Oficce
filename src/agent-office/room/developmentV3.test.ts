import { describe, expect, it } from 'vitest';
import type { AssetRecord } from '../assets/assetRegistry.js';
import {
  DEVELOPMENT_V3_ASSETS,
  DEVELOPMENT_V3_PLACEMENTS,
  DEVELOPMENT_V3_WORKSTATIONS,
  requiredDevelopmentV3AssetIds,
  validateDevelopmentV3Registry,
} from './developmentV3.js';

function record(id:string):AssetRecord{
  return {
    id,name:id,category:'misc',family:id,variant:'default',
    source:{pack:'fixture',originalPath:id+'.png',sha256:'c'.repeat(64)},
    runtime:{uri:'/x/'+id+'.png',widthPx:64,heightPx:64,tileSize:32,anchor:{x:.5,y:1},footprint:{width:2,height:2,unit:'tile'},layer:'furniture_back',zBias:0,collision:'solid'},
    interaction:'none',tags:[],roomTags:['development'],teamTags:['development'],styleTags:['pixel-art'],rotation:'none',
    animation:{kind:'none',frames:0},license:{licenseId:'fixture',sourcePack:'fixture',commercialUse:true,modificationAllowed:true,sourceRedistributionAllowed:false,runtimeBundlingAllowed:true,aiTrainingAllowed:false,notes:[]},enabled:true,priority:1,
  };
}

describe('Development V3 layout',()=>{
  it('uses six registered workstations and a dense layered composition',()=>{
    expect(DEVELOPMENT_V3_WORKSTATIONS).toHaveLength(6);
    expect(DEVELOPMENT_V3_PLACEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(DEVELOPMENT_V3_PLACEMENTS.some(p=>p.layer==='furniture_front')).toBe(true);
    expect(DEVELOPMENT_V3_PLACEMENTS.some(p=>p.assetId===DEVELOPMENT_V3_ASSETS.glassLong)).toBe(true);
  });

  it('declares every licensed asset dependency explicitly',()=>{
    const ids=requiredDevelopmentV3AssetIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEVELOPMENT_V3_ASSETS.floor);
    expect(ids).toContain(DEVELOPMENT_V3_ASSETS.workstation);
  });

  it('fails safely when a private licensed asset is unavailable',()=>{
    const ids=requiredDevelopmentV3AssetIds();
    const registry=new Map(ids.slice(1).map(id=>[id,record(id)]));
    const gate=validateDevelopmentV3Registry(registry);
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain(ids[0]);
  });

  it('accepts a complete private catalog subset',()=>{
    const ids=requiredDevelopmentV3AssetIds();
    const registry=new Map(ids.map(id=>[id,record(id)]));
    expect(validateDevelopmentV3Registry(registry)).toEqual({ok:true,missing:[]});
  });
});
