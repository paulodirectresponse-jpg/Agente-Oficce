import { z } from 'zod';
import type { AssetRegistry } from './assetRegistry.js';
import { RoomSpecSchema } from './roomSpec.js';

export const AssetPlacementSchema=z.object({
  id:z.string().min(1),
  assetId:z.string().min(1),
  x:z.number(),
  y:z.number(),
  rotation:z.enum(['front','back','left','right','none']).default('none'),
  scale:z.number().positive().default(1),
  layerOverride:z.string().optional(),
  zBias:z.number().default(0),
  interactionId:z.string().optional(),
  metadata:z.record(z.unknown()).default({}),
});
export type AssetPlacement=z.infer<typeof AssetPlacementSchema>;

export const RoomLayoutSchema=z.object({
  schemaVersion:z.literal(1),
  room:z.object({
    id:z.string().min(1),
    spec:RoomSpecSchema,
    origin:z.object({x:z.number(),y:z.number()}),
  }),
  placements:z.array(AssetPlacementSchema),
  walkable:z.array(z.object({x:z.number().int(),y:z.number().int()})).default([]),
  blocked:z.array(z.object({x:z.number().int(),y:z.number().int()})).default([]),
  interactions:z.array(z.object({
    id:z.string().min(1),
    kind:z.string().min(1),
    x:z.number(),
    y:z.number(),
    capacity:z.number().int().positive().default(1),
    assetPlacementId:z.string().optional(),
    tags:z.array(z.string()).default([]),
  })).default([]),
});
export type RoomLayout=z.infer<typeof RoomLayoutSchema>;

export const OfficeSpecSchema=z.object({
  schemaVersion:z.literal(1),
  id:z.string().min(1),
  name:z.string().min(1),
  style:z.object({
    theme:z.string().default('agent-office-premium'),
    accent:z.string().default('cyan'),
    tileSize:z.number().int().positive().default(32),
  }),
  bounds:z.object({widthTiles:z.number().int().positive(),heightTiles:z.number().int().positive()}),
  rooms:z.array(z.object({
    id:z.string().min(1),
    type:z.string().min(1),
    x:z.number().int(),
    y:z.number().int(),
    widthTiles:z.number().int().positive(),
    heightTiles:z.number().int().positive(),
    teamId:z.string().optional(),
    layoutRef:z.string().optional(),
  })),
  connections:z.array(z.object({
    from:z.string().min(1),
    to:z.string().min(1),
    kind:z.enum(['door','corridor','glass-door','open']).default('door'),
  })).default([]),
  expansion:z.object({
    enabled:z.boolean().default(true),
    strategy:z.enum(['grid','corridor','wing','adaptive']).default('adaptive'),
    reserveTiles:z.number().int().nonnegative().default(8),
  }).default({enabled:true,strategy:'adaptive',reserveTiles:8}),
});
export type OfficeSpec=z.infer<typeof OfficeSpecSchema>;

export function validateRoomLayoutAssets(registry:AssetRegistry,input:unknown){
  const layout=RoomLayoutSchema.parse(input);
  const missing:string[]=[];
  const duplicatePlacementIds:string[]=[];
  const seen=new Set<string>();
  for(const placement of layout.placements){
    if(seen.has(placement.id))duplicatePlacementIds.push(placement.id);
    seen.add(placement.id);
    if(!registry.has(placement.assetId))missing.push(placement.assetId);
  }
  return{layout,valid:missing.length===0&&duplicatePlacementIds.length===0,missing:[...new Set(missing)],duplicatePlacementIds};
}

export function validateOfficeSpec(input:unknown){
  const office=OfficeSpecSchema.parse(input);
  const ids=new Set<string>();const errors:string[]=[];
  for(const room of office.rooms){
    if(ids.has(room.id))errors.push(`duplicate-room:${room.id}`);
    ids.add(room.id);
    if(room.x<0||room.y<0||room.x+room.widthTiles>office.bounds.widthTiles||room.y+room.heightTiles>office.bounds.heightTiles){
      errors.push(`room-out-of-bounds:${room.id}`);
    }
  }
  for(const edge of office.connections){
    if(!ids.has(edge.from))errors.push(`missing-room:${edge.from}`);
    if(!ids.has(edge.to))errors.push(`missing-room:${edge.to}`);
  }
  return{office,valid:errors.length===0,errors};
}
