import { describe, expect, it } from 'vitest';
import type { AssetRecord } from './assetRegistry.js';
import {
  AssetCalibrationCatalog,
  calibratedDrawRect,
  deriveCalibration,
} from './assetCalibration.js';

function asset(overrides:Partial<AssetRecord>={}):AssetRecord{
  return{
    id:'plant.test',
    name:'Plant',
    category:'plant',
    family:'plant.test',
    variant:'default',
    source:{pack:'fixture',originalPath:'plant.png',sha256:'a'.repeat(64)},
    runtime:{
      uri:'/plant.png',widthPx:198,heightPx:287,tileSize:32,anchor:{x:.5,y:1},
      footprint:{width:6,height:9,unit:'tile'},layer:'furniture_front',zBias:0,collision:'partial',
    },
    interaction:'none',tags:[],roomTags:['development'],teamTags:['development'],styleTags:['pixel-art'],rotation:'none',
    animation:{kind:'none',frames:0},
    license:{licenseId:'fixture',sourcePack:'fixture',commercialUse:true,modificationAllowed:true,sourceRedistributionAllowed:false,runtimeBundlingAllowed:true,aiTrainingAllowed:false,notes:[]},
    enabled:true,priority:1,
    ...overrides,
  };
}

describe('asset calibration',()=>{
  it('converts transparent padding into visual bounds and anchor coordinates',()=>{
    const a=asset();
    const c=deriveCalibration(a,{x:10,y:96,width:178,height:166});
    expect(c.transparentPadding).toEqual({left:10,top:96,right:10,bottom:25});
    expect(c.visibleWidth).toBe(178);
    expect(c.visibleHeight).toBe(166);
    expect(c.visualAnchorPx.x).toBeCloseTo(89);
    expect(c.visualAnchorPx.y).toBeCloseTo(191);
  });

  it('normalizes source scale by the canonical tile size',()=>{
    const a=asset({runtime:{...asset().runtime,tileSize:64}});
    const c=deriveCalibration(a,{x:0,y:0,width:198,height:287});
    expect(c.canonicalScale).toBe(.5);
    expect(c.worldVisibleHeight).toBeCloseTo(143.5);
  });

  it('draws only visible pixels while preserving calibrated anchor',()=>{
    const c=deriveCalibration(asset(),{x:10,y:96,width:178,height:166});
    const rect=calibratedDrawRect(c,500,400);
    expect(rect.source).toEqual({x:10,y:96,width:178,height:166});
    expect(rect.destination.width).toBe(178);
    expect(rect.destination.height).toBe(166);
    expect(rect.destination.x).toBeCloseTo(411);
    expect(rect.destination.y).toBeCloseTo(209);
  });

  it('applies curated socket and scale overrides once at calibration level',()=>{
    const c=deriveCalibration(asset(),{x:10,y:96,width:178,height:166},32,{
      assetId:'plant.test',
      canonicalScale:.8,
      confidence:'curated',
      sockets:[{id:'inspect',kind:'interact',x:89,y:160,facing:'south',layer:'same'}],
      notes:['manual visual calibration'],
    });
    expect(c.canonicalScale).toBe(.8);
    expect(c.confidence).toBe('curated');
    expect(c.sockets).toHaveLength(1);
  });

  it('rejects duplicate calibrations',()=>{
    const c=deriveCalibration(asset(),{x:0,y:0,width:198,height:287});
    expect(()=>new AssetCalibrationCatalog({schemaVersion:1,generatedAt:'2026-09-24',canonicalTileSize:32,assets:[c,c]})).toThrow(/Duplicate calibration/);
  });
});
