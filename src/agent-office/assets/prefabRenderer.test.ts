import { describe, expect, it } from 'vitest';
import { prefabNodeRects } from './prefabRenderer.js';
import type { CompiledPrefabNode } from './prefabSystem.js';

const base:CompiledPrefabNode={
  id:'p:a',prefabInstanceId:'p',sourcePlacementId:'a',assetId:'desk.test',
  x:100,y:100,
  sourceRect:{x:10,y:20,width:100,height:120},
  destinationRect:{x:200,y:300,width:200,height:240},
  layer:'furniture_back',zBias:0,scale:2,
  occlusion:{mode:'horizontal-split',splitY:80},
  tags:[],
};

describe('prefab renderer geometry',()=>{
  it('splits one calibrated asset into back and front passes around an Agent',()=>{
    const back=prefabNodeRects(base,'back');
    const front=prefabNodeRects(base,'front');
    expect(back).not.toBeNull();
    expect(front).not.toBeNull();
    expect(back!.source).toEqual({x:10,y:20,width:100,height:60});
    expect(front!.source).toEqual({x:10,y:80,width:100,height:60});
    expect(back!.destination.height).toBe(120);
    expect(front!.destination.y).toBe(420);
    expect(front!.destination.height).toBe(120);
  });


  it('keeps a composite workstation behind the Agent while exposing only curated front occluders',()=>{
    const node={...base,occlusion:{
      mode:'front-rects' as const,
      frontRects:[
        {x:10,y:80,width:100,height:20},
        {x:10,y:100,width:25,height:40},
        {x:85,y:100,width:25,height:40},
      ],
    }};
    expect(prefabNodeRects(node,'back')).toEqual({source:node.sourceRect,destination:node.destinationRect});
    expect(prefabNodeRects(node,'front')).toBeNull();
  });

  it('does not redraw a normal unsplit node during the front occlusion pass',()=>{
    const node={...base,occlusion:{mode:'none' as const}};
    expect(prefabNodeRects(node,'front')).toBeNull();
    expect(prefabNodeRects(node,'back')).not.toBeNull();
  });
});
