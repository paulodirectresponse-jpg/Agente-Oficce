import type { AssetLayer } from './assetRegistry.js';
import type { CompiledPrefab, CompiledPrefabNode } from './prefabSystem.js';

export type PrefabImageSource={
  get(assetId:string):CanvasImageSource|undefined;
};

export const PREFAB_LAYER_ORDER:AssetLayer[]=[
  'floor','wall_back','furniture_back','surface','character','furniture_front','wall_front','fx','overlay',
];

export function drawCompiledPrefabNode(
  ctx:CanvasRenderingContext2D,
  node:CompiledPrefabNode,
  images:PrefabImageSource,
){
  const image=images.get(node.assetId);
  if(!image)return false;
  const s=node.sourceRect,d=node.destinationRect;
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
){
  const nodes=prefabs
    .flatMap(prefab=>prefab.nodes)
    .filter(node=>node.layer===layer)
    .sort((a,b)=>a.y-b.y||a.zBias-b.zBias||a.id.localeCompare(b.id));
  let drawn=0;
  for(const node of nodes)if(drawCompiledPrefabNode(ctx,node,images))drawn++;
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
