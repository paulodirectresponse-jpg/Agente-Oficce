import { describe, expect, it } from 'vitest';
import { AssetRegistry } from './assetRegistry.js';
import { DEVELOPMENT_ROOM_TEMPLATE, resolveRoomAssets } from './roomSpec.js';

const license={licenseId:'test',sourcePack:'fixture',commercialUse:true,modificationAllowed:true,sourceRedistributionAllowed:false,runtimeBundlingAllowed:true,aiTrainingAllowed:false,notes:[]};
function asset(id:string,category:string,interaction:string,rooms:string[],tags:string[]=[]){
  return{
    id,name:id,category,family:id.split('.').slice(0,2).join('.'),variant:'default',
    source:{pack:'fixture',originalPath:id+'.png',sha256:'a'.repeat(64)},
    runtime:{uri:'/x/'+id+'.png',widthPx:64,heightPx:64,tileSize:32,anchor:{x:.5,y:1},footprint:{width:2,height:2,unit:'tile'},layer:'furniture_back',zBias:0,collision:'solid'},
    interaction,tags:['modern','corporate',...tags],roomTags:rooms,teamTags:rooms,styleTags:['pixel-art'],rotation:'none',
    animation:{kind:'none',frames:0},license,enabled:true,priority:10,
  };
}
const data={
  schemaVersion:1 as const,generatedAt:'2026-09-24T00:00:00Z',tileSize:32,source:{provider:'test',bundle:'fixture'},
  assets:[
    asset('desk.dev.01','desk','workstation',['development'],['tech']),
    asset('desk.dev.02','desk','workstation',['development'],['tech']),
    asset('monitor.dev.01','monitor','workstation',['development'],['tech']),
    asset('chair.meeting.01','chair','meeting',['development'],['collaboration']),
    asset('whiteboard.01','whiteboard','whiteboard',['development'],['collaboration']),
    asset('plant.01','plant','none',['development'],['biophilic']),
    asset('plant.02','plant','none',['development'],['biophilic']),
    asset('storage.01','storage','storage',['development']),
    asset('seat.lounge.01','seating','seat',['development'],['lounge']),
    asset('display.01','monitor','display',['development'],['tech']),
  ],
};

describe('AssetRegistry',()=>{
  it('validates, indexes and queries semantic assets',()=>{
    const registry=new AssetRegistry(data);
    expect(registry.get('desk.dev.01')?.category).toBe('desk');
    expect(registry.query({rooms:['development'],categories:['desk']}).length).toBe(2);
    expect(registry.stats().total).toBe(10);
  });

  it('rejects duplicate ids',()=>{
    expect(()=>new AssetRegistry({...data,assets:[...data.assets,data.assets[0]]})).toThrow(/Duplicate asset id/);
  });
});

describe('RoomSpec resolver',()=>{
  it('produces deterministic semantic selections and reports gaps',()=>{
    const registry=new AssetRegistry(data);
    const plan=resolveRoomAssets(registry,{...DEVELOPMENT_ROOM_TEMPLATE,requirements:{...DEVELOPMENT_ROOM_TEMPLATE.requirements,workstations:2,meetingSeats:1,plants:2,whiteboards:1,storageUnits:1,loungeSeats:1,displays:1}});
    expect(plan.selected.length).toBeGreaterThan(0);
    expect(plan.byPurpose.workstations.length).toBe(2);
    expect(plan.byPurpose.plants.length).toBe(2);
    expect(plan.unresolved.some(v=>v.startsWith('servers'))).toBe(false);
  });
});
