import type { AssetLayer } from './assetRegistry.js';
import type { CompiledPrefab, CompiledPrefabNode } from './prefabSystem.js';

export type PrefabImageSource={
  get(assetId:string):CanvasImageSource|undefined;
};

export type PrefabNodePass='all'|'back'|'front';

export const PREFAB_LAYER_ORDER:AssetLayer[]=[
  'floor','wall_back','furniture_back','surface','character','furniture_front','wall_front','fx','overlay',
];

export function prefabNodeRects(node:CompiledPrefabNode,pass:PrefabNodePass){
  const s=node.sourceRect,d=node.destinationRect;
  if(node.occlusion.mode==='front-rects'){
    return pass==='front'?null:{source:s,destination:d};
  }
  if(node.occlusion.mode!=='horizontal-split'||node.occlusion.splitY===undefined||pass==='all'){
    return pass==='front'&&node.occlusion.mode==='none'?null:{source:s,destination:d};
  }
  const split=Math.max(s.y,Math.min(s.y+s.height,node.occlusion.splitY));
  const backHeight=split-s.y;
  const frontHeight=s.y+s.height-split;
  if(pass==='back'){
    if(backHeight<=0)return null;
    const ratio=backHeight/s.height;
    return{
      source:{x:s.x,y:s.y,width:s.width,height:backHeight},
      destination:{x:d.x,y:d.y,width:d.width,height:d.height*ratio},
    };
  }
  if(frontHeight<=0)return null;
  const ratioBefore=backHeight/s.height;
  const ratioFront=frontHeight/s.height;
  return{
    source:{x:s.x,y:split,width:s.width,height:frontHeight},
    destination:{x:d.x,y:d.y+d.height*ratioBefore,width:d.width,height:d.height*ratioFront},
  };
}

export function drawCompiledPrefabNode(
  ctx:CanvasRenderingContext2D,
  node:CompiledPrefabNode,
  images:PrefabImageSource,
  pass:PrefabNodePass='all',
){
  const image=images.get(node.assetId);
  if(!image)return false;

  if(node.occlusion.mode==='front-rects'&&pass==='front'){
    const source=node.sourceRect,destination=node.destinationRect;
    const sx=destination.width/source.width,sy=destination.height/source.height;
    let drawn=false;
    ctx.save();
    ctx.imageSmoothingEnabled=false;
    for(const raw of node.occlusion.frontRects??[]){
      const x1=Math.max(source.x,raw.x),y1=Math.max(source.y,raw.y);
      const x2=Math.min(source.x+source.width,raw.x+raw.width);
      const y2=Math.min(source.y+source.height,raw.y+raw.height);
      if(x2<=x1||y2<=y1)continue;
      const width=x2-x1,height=y2-y1;
      const dx=destination.x+(x1-source.x)*sx;
      const dy=destination.y+(y1-source.y)*sy;
      ctx.drawImage(image,x1,y1,width,height,dx,dy,width*sx,height*sy);
      drawn=true;
    }
    ctx.restore();
    return drawn;
  }

  const rects=prefabNodeRects(node,pass);
  if(!rects)return false;
  const s=rects.source,d=rects.destination;
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(image,s.x,s.y,s.width,s.height,d.x,d.y,d.width,d.height);
  ctx.restore();
  return true;
}

export function drawCompiledPrefabsLayer(
  ctx:CanvasRenderingContext2D,
  prefabs:CompiledPrefab[],
  images:PrefabImageSource,
  layer:AssetLayer,
  pass:PrefabNodePass='all',
){
  const nodes=prefabs
    .flatMap(prefab=>prefab.nodes)
    .filter(node=>node.layer===layer)
    .sort((a,b)=>a.y-b.y||a.zBias-b.zBias||a.id.localeCompare(b.id));
  let drawn=0;
  for(const node of nodes)if(drawCompiledPrefabNode(ctx,node,images,pass))drawn++;
  return drawn;
}

export function drawCompiledPrefabsBeforeCharacters(
  ctx:CanvasRenderingContext2D,
  prefabs:CompiledPrefab[],
  images:PrefabImageSource,
){
  let drawn=0;
  for(const layer of ['floor','wall_back','furniture_back','surface'] as AssetLayer[]){
    const nodes=prefabs.flatMap(prefab=>prefab.nodes).filter(node=>node.layer===layer);
    for(const node of nodes){
      const pass=node.occlusion.mode==='horizontal-split'?'back':'all';
      if(drawCompiledPrefabNode(ctx,node,images,pass))drawn++;
    }
  }
  return drawn;
}

export function drawCompiledPrefabsAfterCharacters(
  ctx:CanvasRenderingContext2D,
  prefabs:CompiledPrefab[],
  images:PrefabImageSource,
){
  let drawn=0;
  const occludingNodes=prefabs.flatMap(prefab=>prefab.nodes).filter(node=>node.occlusion.mode==='horizontal-split'||node.occlusion.mode==='front-rects');
  for(const node of occludingNodes)if(drawCompiledPrefabNode(ctx,node,images,'front'))drawn++;
  for(const layer of ['furniture_front','wall_front','fx','overlay'] as AssetLayer[]){
    drawn+=drawCompiledPrefabsLayer(ctx,prefabs,images,layer,'all');
  }
  return drawn;
}

export function drawCompiledPrefabs(
  ctx:CanvasRenderingContext2D,
  prefabs:CompiledPrefab[],
  images:PrefabImageSource,
  beforeLayer?:(layer:AssetLayer)=>void,
  afterLayer?:(layer:AssetLayer)=>void,
){
  let drawn=0;
  for(const layer of PREFAB_LAYER_ORDER){
    beforeLayer?.(layer);
    drawn+=drawCompiledPrefabsLayer(ctx,prefabs,images,layer);
    afterLayer?.(layer);
  }
  return drawn;
}
