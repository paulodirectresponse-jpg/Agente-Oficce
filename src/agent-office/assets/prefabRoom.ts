import { z } from 'zod';
import type { AssetRegistry } from './assetRegistry.js';
import type { AssetCalibrationCatalog } from './assetCalibration.js';
import {
  PrefabInstanceSchema,
  PrefabLibrary,
  compilePrefab,
  prefabBounds,
  validatePrefabComposition,
  type CompiledPrefab,
} from './prefabSystem.js';

export const PrefabRoomBlueprintSchema=z.object({
  schemaVersion:z.literal(1),
  id:z.string().min(1),
  name:z.string().min(1),
  width:z.number().positive(),
  height:z.number().positive(),
  origin:z.object({x:z.number(),y:z.number()}).default({x:0,y:0}),
  instances:z.array(PrefabInstanceSchema),
  protectedZones:z.array(z.object({
    id:z.string().min(1),
    x:z.number(),
    y:z.number(),
    width:z.number().positive(),
    height:z.number().positive(),
    tags:z.array(z.string()).default([]),
  })).default([]),
  tags:z.array(z.string()).default([]),
});
export type PrefabRoomBlueprint=z.infer<typeof PrefabRoomBlueprintSchema>;

export type CompiledPrefabRoom={
  blueprint:PrefabRoomBlueprint;
  prefabs:CompiledPrefab[];
  sockets:ReturnType<typeof compilePrefab>['sockets'];
  errors:string[];
};

function intersects(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number}){
  return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
}

export function compilePrefabRoom(
  blueprintInput:unknown,
  library:PrefabLibrary,
  registry:AssetRegistry,
  calibrations:AssetCalibrationCatalog,
):CompiledPrefabRoom{
  const blueprint=PrefabRoomBlueprintSchema.parse(blueprintInput);
  const seen=new Set<string>();
  const errors:string[]=[];
  const prefabs:CompiledPrefab[]=[];

  for(const instance of blueprint.instances){
    if(seen.has(instance.id)){errors.push(`duplicate-instance:${instance.id}`);continue}
    seen.add(instance.id);
    try{
      const compiled=compilePrefab({
        ...instance,
        x:blueprint.origin.x+instance.x,
        y:blueprint.origin.y+instance.y,
      },library,registry,calibrations);
      const bounds=prefabBounds(compiled);
      const roomBounds={
        x:blueprint.origin.x,
        y:blueprint.origin.y,
        width:blueprint.width,
        height:blueprint.height,
      };
      if(bounds.x<roomBounds.x||bounds.y<roomBounds.y||bounds.x+bounds.width>roomBounds.x+roomBounds.width||bounds.y+bounds.height>roomBounds.y+roomBounds.height){
        errors.push(`prefab-out-of-room:${instance.id}`);
      }
      prefabs.push(compiled);
    }catch(error){
      errors.push(error instanceof Error?error.message:String(error));
    }
  }

  errors.push(...validatePrefabComposition(prefabs).errors);

  for(const zone of blueprint.protectedZones){
    const absolute={
      x:blueprint.origin.x+zone.x,
      y:blueprint.origin.y+zone.y,
      width:zone.width,
      height:zone.height,
    };
    for(const prefab of prefabs){
      for(const collision of prefab.collision){
        if(intersects(absolute,collision))errors.push(`protected-zone-overlap:${zone.id}:${prefab.instance.id}`);
      }
    }
  }

  const sockets=prefabs.flatMap(prefab=>prefab.sockets);
  return{blueprint,prefabs,sockets,errors:[...new Set(errors)]};
}

export function roomSocketIndex(room:CompiledPrefabRoom){
  const map=new Map<string,CompiledPrefabRoom['sockets'][number]>();
  for(const socket of room.sockets){
    if(map.has(socket.id))throw new Error(`Duplicate room socket: ${socket.id}`);
    map.set(socket.id,socket);
  }
  return map;
}

export function socketsByKind(room:CompiledPrefabRoom,kind:string){
  return room.sockets.filter(socket=>socket.kind===kind);
}
