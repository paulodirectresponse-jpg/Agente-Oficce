import { z } from 'zod';
import type { AssetCategory, AssetInteraction, AssetRecord, AssetRegistry } from './assetRegistry.js';

export const RoomZoneSchema=z.object({
  id:z.string().min(1),
  purpose:z.string().min(1),
  capacity:z.number().int().nonnegative().default(0),
  requiredCategories:z.array(z.string()).default([]),
  requiredInteractions:z.array(z.string()).default([]),
  preferredTags:z.array(z.string()).default([]),
  minAssets:z.number().int().nonnegative().default(0),
  maxAssets:z.number().int().positive().default(12),
});
export type RoomZone=z.infer<typeof RoomZoneSchema>;

export const RoomSpecSchema=z.object({
  schemaVersion:z.literal(1),
  id:z.string().min(1),
  name:z.string().min(1),
  teamType:z.string().min(1),
  roomType:z.string().min(1),
  capacity:z.number().int().positive(),
  dimensions:z.object({
    widthTiles:z.number().int().positive(),
    heightTiles:z.number().int().positive(),
    tileSize:z.number().int().positive().default(32),
  }),
  style:z.object({
    theme:z.string().default('agent-office-premium'),
    accent:z.string().default('cyan'),
    material:z.string().default('warm-wood'),
    density:z.enum(['sparse','balanced','dense']).default('dense'),
  }),
  requirements:z.object({
    workstations:z.number().int().nonnegative().default(0),
    meetingSeats:z.number().int().nonnegative().default(0),
    whiteboards:z.number().int().nonnegative().default(0),
    servers:z.number().int().nonnegative().default(0),
    loungeSeats:z.number().int().nonnegative().default(0),
    storageUnits:z.number().int().nonnegative().default(0),
    plants:z.number().int().nonnegative().default(0),
    displays:z.number().int().nonnegative().default(0),
  }),
  zones:z.array(RoomZoneSchema).default([]),
  requiredTags:z.array(z.string()).default([]),
  preferredTags:z.array(z.string()).default([]),
  excludedTags:z.array(z.string()).default([]),
});
export type RoomSpec=z.infer<typeof RoomSpecSchema>;

export type RoomAssetPlan={
  roomId:string;
  selected:AssetRecord[];
  unresolved:string[];
  byPurpose:Record<string,string[]>;
};

function choose(
  registry:AssetRegistry,
  categories:AssetCategory[],
  interactions:AssetInteraction[],
  rooms:string[],
  teams:string[],
  tags:string[],
  count:number,
  used:Set<string>,
){
  if(count<=0)return [];
  const candidates=registry.query({categories,interactions,rooms,teams,tags,limit:100});
  const out:AssetRecord[]=[];
  for(const a of candidates){
    if(used.has(a.id))continue;
    out.push(a);used.add(a.id);
    if(out.length>=count)break;
  }
  return out;
}

export function resolveRoomAssets(registry:AssetRegistry,input:unknown):RoomAssetPlan{
  const spec=RoomSpecSchema.parse(input);
  const used=new Set<string>();
  const selected:AssetRecord[]=[];
  const unresolved:string[]=[];
  const byPurpose:Record<string,string[]>={};
  const room=[spec.roomType,spec.style.theme];
  const teams=[spec.teamType];
  const tags=[...spec.requiredTags,...spec.preferredTags];

  const add=(purpose:string,assets:AssetRecord[],need:number)=>{
    selected.push(...assets);byPurpose[purpose]=assets.map(a=>a.id);
    if(assets.length<need)unresolved.push(`${purpose}:${need-assets.length}`);
  };

  const req=spec.requirements;
  add('workstations',choose(registry,['desk','monitor','computer'],['workstation'],room,teams,tags,req.workstations,used),req.workstations);
  add('meetingSeats',choose(registry,['chair','seating'],['meeting','seat'],room,teams,tags,req.meetingSeats,used),req.meetingSeats);
  add('whiteboards',choose(registry,['whiteboard'],['whiteboard'],room,teams,tags,req.whiteboards,used),req.whiteboards);
  add('servers',choose(registry,['server','electronics'],['server'],room,teams,tags,req.servers,used),req.servers);
  add('loungeSeats',choose(registry,['seating','chair'],['seat'],room,teams,['lounge',...tags],req.loungeSeats,used),req.loungeSeats);
  add('storageUnits',choose(registry,['storage'],['storage'],room,teams,tags,req.storageUnits,used),req.storageUnits);
  add('plants',choose(registry,['plant'],['none'],room,teams,tags,req.plants,used),req.plants);
  add('displays',choose(registry,['monitor','signage','electronics'],['display'],room,teams,tags,req.displays,used),req.displays);

  for(const zone of spec.zones){
    const cats=zone.requiredCategories.filter((v):v is AssetCategory=>[
      'architecture','door','window','glass','floor','rug','desk','table','chair','seating','monitor','computer',
      'electronics','server','storage','whiteboard','lighting','plant','decor','kitchen','coffee','signage','character','vehicle','misc',
    ].includes(v));
    const ints=zone.requiredInteractions.filter((v):v is AssetInteraction=>[
      'none','workstation','seat','meeting','whiteboard','server','coffee','storage','display','door','reception',
    ].includes(v));
    const assets=choose(registry,cats.length?cats:['decor'],ints.length?ints:['none'],room,teams,[...tags,...zone.preferredTags],zone.minAssets,used);
    add(`zone:${zone.id}`,assets,zone.minAssets);
  }

  return {roomId:spec.id,selected,unresolved,byPurpose};
}

export const DEVELOPMENT_ROOM_TEMPLATE:RoomSpec=RoomSpecSchema.parse({
  schemaVersion:1,
  id:'development.default',
  name:'Development',
  teamType:'development',
  roomType:'development',
  capacity:6,
  dimensions:{widthTiles:30,heightTiles:20,tileSize:32},
  style:{theme:'agent-office-premium',accent:'cyan',material:'warm-wood',density:'dense'},
  requirements:{workstations:6,meetingSeats:4,whiteboards:1,servers:0,loungeSeats:3,storageUnits:3,plants:8,displays:2},
  requiredTags:['modern','corporate'],
  preferredTags:['tech','warm-wood','glass','premium'],
  excludedTags:['retro','residential'],
  zones:[
    {id:'work-pods',purpose:'primary-work',capacity:6,requiredCategories:['desk','monitor','chair'],requiredInteractions:['workstation'],preferredTags:['development'],minAssets:3,maxAssets:18},
    {id:'collaboration',purpose:'review-and-planning',capacity:6,requiredCategories:['whiteboard','table','chair'],requiredInteractions:['meeting'],preferredTags:['collaboration'],minAssets:2,maxAssets:10},
    {id:'lounge',purpose:'rest-and-waiting',capacity:4,requiredCategories:['seating','table','plant'],requiredInteractions:['seat'],preferredTags:['lounge'],minAssets:2,maxAssets:8},
  ],
});
