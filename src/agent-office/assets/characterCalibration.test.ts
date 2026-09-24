import { describe, expect, it } from 'vitest';
import { deriveCalibration } from './assetCalibration.js';
import { AGENT_OFFICE_CHARACTER_SCALE, characterDestinationRect, characterRenderScale, targetCharacterHeight } from './characterCalibration.js';

const asset={
  id:'character.test',name:'Character',category:'character',family:'character.test',variant:'default',
  source:{pack:'fixture',originalPath:'character.png',sha256:'d'.repeat(64)},
  runtime:{uri:'/character.png',widthPx:47,heightPx:93,tileSize:32,anchor:{x:.5,y:1},footprint:{width:2,height:3,unit:'tile'},layer:'character',zBias:0,collision:'partial'},
  interaction:'none',tags:[],roomTags:['development'],teamTags:['development'],styleTags:['pixel-art'],rotation:'none',
  animation:{kind:'none',frames:0},
  license:{licenseId:'fixture',sourcePack:'fixture',commercialUse:true,modificationAllowed:true,sourceRedistributionAllowed:false,runtimeBundlingAllowed:true,aiTrainingAllowed:false,notes:[]},
  enabled:true,priority:1,
} as const;

describe('character calibration',()=>{
  it('targets a 48px standing character at the canonical 32px tile scale',()=>{
    expect(targetCharacterHeight(AGENT_OFFICE_CHARACTER_SCALE,'standing')).toBe(48);
  });

  it('shrinks a 93px source character instead of forcing an arbitrary runtime height',()=>{
    const calibration=deriveCalibration(asset as never,{x:0,y:0,width:47,height:93});
    const scale=characterRenderScale(calibration,'standing');
    expect(scale).toBeCloseTo(48/93,5);
  });

  it('uses a smaller calibrated target for seated/working poses',()=>{
    const calibration=deriveCalibration(asset as never,{x:0,y:0,width:47,height:93});
    expect(characterRenderScale(calibration,'working')).toBeLessThan(characterRenderScale(calibration,'standing'));
    const rect=characterDestinationRect(calibration,500,400,'working');
    expect(rect.height).toBeCloseTo(32*1.08,5);
  });
});
