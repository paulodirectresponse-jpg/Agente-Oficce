import { z } from 'zod';
import type { AssetLayer, AssetRegistry } from './assetRegistry.js';
import {
  AssetCalibrationCatalog,
  calibratedDrawRect,
  SCALE_TOKENS,
  type ScaleToken,
} from './assetCalibration.js';

export const PrefabSocketSchema=z.object({
  id:z.string().min(1),
  kind:z.enum(['seat','stand','work','interact','present','entry','exit','meeting']),
  x:z.number(),
  y:z.number(),
  facing:z.enum(['north','south','east','west','none']).default('none'),
  pose:z.string().optional(),
  capacity:z.number().int().positive().default(1),
  tags:z.array(z.string()).default([]),
});
export type PrefabSocket=z.infer<typeof PrefabSocketSchema>;

export const PrefabRectSchema=z.object({
  x:z.number(),
  y:z.number(),
  width:z.number().positive(),
  height:z.number().positive(),
});

export const PrefabPlacementSchema=z.object({
  id:z.string().min(1),
  assetId:z.string().min(1),
  x:z.number(),
  y:z.number(),
  scaleToken:z.enum(['compact','standard','spacious']).default('standard'),
  layerOverride:z.custom<AssetLayer>().optional(),
  zBias:z.number().default(0),
  hidden:z.boolean().default(false),
  tags:z.array(z.string()).default([]),
});
export type PrefabPlacement=z.infer<typeof PrefabPlacementSchema>;

export const PrefabDefinitionSchema=z.object({
  schemaVersion:z.literal(1),
  id:z.string().min(1),
  name:z.string().min(1),
  category:z.enum([
    'workpod','meeting','planning','lounge','storage','entrance','infra','media','reception','custom',
  ]),
  width:z.number().positive(),
  height:z.number().positive(),
  pivot:z.object({x:z.number(),y:z.number()}).default({x:0,y:0}),
  placements:z.array(PrefabPlacementSchema),
  sockets:z.array(PrefabSocketSchema).default([]),
  collision:z.array(PrefabRectSchema).default([]),
  keepClear:z.array(PrefabRectSchema).default([]),
  tags:z.array(z.string()).default([]),
  roomTags:z.array(z.string()).default([]),
  teamTags:z.array(z.string()).default([]),
  notes:z.array(z.string()).default([]),
});
export type PrefabDefinition=z.infer<typeof PrefabDefinitionSchema>;

export const PrefabInstanceSchema=z.object({
  id:z.string().min(1),
  prefabId:z.string().min(1),
  x:z.number(),
  y:z.number(),
  rotation:z.enum(['none']).default('none'),
  tags:z.array(z.string()).default([]),
});
export type PrefabInstance=z.infer<typeof PrefabInstanceSchema>;

export type CompiledPrefabNode={
  id:string;
  prefabInstanceId:string;
  sourcePlacementId:string;
  assetId:string;
  x:number;
  y:number;
  sourceRect:{x:number;y:number;width:number;height:number};
  destinationRect:{x:number;y:number;width:number;height:number};
  layer:AssetLayer;
  zBias:number;
  scale:number;
  occlusion:{mode:'none'|'horizontal-split'|'front-rects';splitY?:number;frontRects?:Array<{x:number;y:number;width:number;height:number}>};
  tags:string[];
};

export type CompiledPrefabSocket=PrefabSocket & {
  id:string;
  prefabInstanceId:string;
  x:number;
  y:number;
  source:'prefab'|'asset';
  assetNodeId?:string;
};

export type CompiledPrefab={
  instance:PrefabInstance;
  definition:PrefabDefinition;
  nodes:CompiledPrefabNode[];
  sockets:CompiledPrefabSocket[];
  collision:Array<{x:number;y:number;width:number;height:number}>;
  keepClear:Array<{x:number;y:number;width:number;height:number}>;
};

export class PrefabLibrary{
  private readonly byId=new Map<string,PrefabDefinition>();

  constructor(definitions:unknown[]){
    for(const input of definitions){
      const prefab=PrefabDefinitionSchema.parse(input);
      if(this.byId.has(prefab.id))throw new Error(`Duplicate prefab: ${prefab.id}`);
      const placementIds=new Set<string>();
      for(const p of prefab.placements){
        if(placementIds.has(p.id))throw new Error(`Duplicate placement ${p.id} in prefab ${prefab.id}`);
        placementIds.add(p.id);
      }
      const socketIds=new Set<string>();
      for(const s of prefab.sockets){
        if(socketIds.has(s.id))throw new Error(`Duplicate socket ${s.id} in prefab ${prefab.id}`);
        socketIds.add(s.id);
      }
      this.byId.set(prefab.id,prefab);
    }
  }

  get(id:string){return this.byId.get(id)}
  require(id:string){
    const prefab=this.get(id);
    if(!prefab)throw new Error(`Unknown prefab: ${id}`);
    return prefab;
  }
  list(){return [...this.byId.values()]}
}

export function compilePrefab(
  instanceInput:unknown,
  library:PrefabLibrary,
  registry:AssetRegistry,
  calibrations:AssetCalibrationCatalog,
):CompiledPrefab{
  const instance=PrefabInstanceSchema.parse(instanceInput);
  const definition=library.require(instance.prefabId);
  const nodes:CompiledPrefabNode[]=[];

  for(const placement of definition.placements){
    if(placement.hidden)continue;
    const asset=registry.get(placement.assetId);
    if(!asset)throw new Error(`Prefab ${definition.id} references missing asset ${placement.assetId}`);
    const calibration=calibrations.require(placement.assetId);
    const worldX=instance.x+placement.x-definition.pivot.x;
    const worldY=instance.y+placement.y-definition.pivot.y;
    const rect=calibratedDrawRect(calibration,worldX,worldY,placement.scaleToken as ScaleToken);

    nodes.push({
      id:`${instance.id}:${placement.id}`,
      prefabInstanceId:instance.id,
      sourcePlacementId:placement.id,
      assetId:placement.assetId,
      x:worldX,
      y:worldY,
      sourceRect:rect.source,
      destinationRect:rect.destination,
      layer:placement.layerOverride??asset.runtime.layer,
      zBias:placement.zBias+asset.runtime.zBias,
      scale:rect.scale,
      occlusion:calibration.occlusion,
      tags:[...new Set([...definition.tags,...placement.tags,...instance.tags])],
    });
  }

  nodes.sort((a,b)=>{
    const layerOrder:AssetLayer[]=['floor','wall_back','furniture_back','surface','character','furniture_front','wall_front','fx','overlay'];
    return layerOrder.indexOf(a.layer)-layerOrder.indexOf(b.layer)||a.y-b.y||a.zBias-b.zBias||a.id.localeCompare(b.id);
  });

  const sockets:CompiledPrefabSocket[]=[
    ...definition.sockets.map(socket=>({
      ...socket,
      id:`${instance.id}:${socket.id}`,
      prefabInstanceId:instance.id,
      x:instance.x+socket.x-definition.pivot.x,
      y:instance.y+socket.y-definition.pivot.y,
      source:'prefab' as const,
    })),
  ];

  for(const placement of definition.placements){
    if(placement.hidden)continue;
    const calibration=calibrations.require(placement.assetId);
    if(!calibration.sockets.length)continue;
    const worldX=instance.x+placement.x-definition.pivot.x;
    const worldY=instance.y+placement.y-definition.pivot.y;
    const scale=calibration.canonicalScale*SCALE_TOKENS[placement.scaleToken as ScaleToken];
    for(const socket of calibration.sockets){
      sockets.push({
        id:`${instance.id}:${placement.id}:${socket.id}`,
        prefabInstanceId:instance.id,
        assetNodeId:`${instance.id}:${placement.id}`,
        source:'asset',
        kind:socket.kind,
        x:worldX+(socket.x-calibration.alphaBounds.x-calibration.visualAnchorPx.x)*scale,
        y:worldY+(socket.y-calibration.alphaBounds.y-calibration.visualAnchorPx.y)*scale,
        facing:socket.facing,
        pose:socket.pose,
        capacity:1,
        tags:[...new Set([...definition.tags,...placement.tags,`asset-socket:${socket.id}`])],
      });
    }
  }

  const translate=(rect:{x:number;y:number;width:number;height:number})=>({
    x:instance.x+rect.x-definition.pivot.x,
    y:instance.y+rect.y-definition.pivot.y,
    width:rect.width,
    height:rect.height,
  });

  return{
    instance,
    definition,
    nodes,
    sockets,
    collision:definition.collision.map(translate),
    keepClear:definition.keepClear.map(translate),
  };
}

export function prefabBounds(compiled:CompiledPrefab){
  return{
    x:compiled.instance.x-compiled.definition.pivot.x,
    y:compiled.instance.y-compiled.definition.pivot.y,
    width:compiled.definition.width,
    height:compiled.definition.height,
  };
}

function intersects(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number}){
  return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
}

export function validatePrefabComposition(prefabs:CompiledPrefab[]){
  const errors:string[]=[];
  for(let i=0;i<prefabs.length;i++){
    for(let j=i+1;j<prefabs.length;j++){
      const a=prefabs[i],b=prefabs[j];
      for(const collisionA of a.collision){
        for(const collisionB of b.collision){
          if(intersects(collisionA,collisionB))errors.push(`collision-overlap:${a.instance.id}:${b.instance.id}`);
        }
      }
      for(const keep of a.keepClear){
        for(const collision of b.collision){
          if(intersects(keep,collision))errors.push(`keep-clear-overlap:${a.instance.id}:${b.instance.id}`);
        }
      }
      for(const keep of b.keepClear){
        for(const collision of a.collision){
          if(intersects(keep,collision))errors.push(`keep-clear-overlap:${b.instance.id}:${a.instance.id}`);
        }
      }
    }
  }
  return{ok:errors.length===0,errors};
}

export function scaleTokenValue(token:ScaleToken){
  return SCALE_TOKENS[token];
}
