import { describe, expect, it } from 'vitest';
import { AssetRegistry } from './assetRegistry.js';
import { CORE_ASSET_RECIPES, resolveAssetRecipe } from './assetRecipes.js';

const license={licenseId:'test',sourcePack:'fixture',commercialUse:true,modificationAllowed:true,sourceRedistributionAllowed:false,runtimeBundlingAllowed:true,aiTrainingAllowed:false,notes:[]};
function item(id:string,category:string,tags:string[]=[]){
  return{
    id,name:id,category,family:id,variant:'default',
    source:{pack:'fixture',originalPath:id+'.png',sha256:'b'.repeat(64)},
    runtime:{uri:'/x/'+id+'.png',widthPx:64,heightPx:64,tileSize:32,anchor:{x:.5,y:1},footprint:{width:2,height:2,unit:'tile'},layer:'furniture_back',zBias:0,collision:'solid'},
    interaction:category==='desk'?'workstation':'none',
    tags:['modern','work',...tags],roomTags:['development'],teamTags:['development'],styleTags:['pixel-art'],rotation:'none',
    animation:{kind:'none',frames:0},license,enabled:true,priority:10,
  };
}

describe('Asset recipes',()=>{
  it('resolves a semantic workstation without vendor filenames',()=>{
    const registry=new AssetRegistry({
      schemaVersion:1,generatedAt:'2026-09-24T00:00:00Z',tileSize:32,source:{provider:'test',bundle:'fixture'},
      assets:[
        item('desk.alpha','desk'),item('monitor.alpha','monitor',['tech']),item('chair.alpha','chair'),item('computer.alpha','computer',['tech']),item('plant.alpha','plant',['small']),
      ],
    });
    const plan=resolveAssetRecipe(registry,CORE_ASSET_RECIPES.workstation);
    expect(plan.unresolved).toEqual([]);
    expect(plan.assets.desk[0]?.id).toBe('desk.alpha');
    expect(plan.assets.monitor[0]?.id).toBe('monitor.alpha');
  });

  it('reports required recipe gaps while allowing optional slots',()=>{
    const registry=new AssetRegistry({
      schemaVersion:1,generatedAt:'2026-09-24T00:00:00Z',tileSize:32,source:{provider:'test',bundle:'fixture'},
      assets:[item('desk.alpha','desk')],
    });
    const plan=resolveAssetRecipe(registry,CORE_ASSET_RECIPES.workstation);
    expect(plan.unresolved.some(v=>v.startsWith('monitor:'))).toBe(true);
    expect(plan.unresolved.some(v=>v.startsWith('computer:'))).toBe(false);
  });
});
