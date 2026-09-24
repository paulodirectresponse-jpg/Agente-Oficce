import type { AssetLayer, AssetRecord } from '../assets/assetRegistry.js';
import type { RoomLayout } from '../assets/officeSpec.js';
import { DEVELOPMENT_ROOM_TEMPLATE } from '../assets/roomSpec.js';

export const DEVELOPMENT_V3_BOUNDS={x:210,y:54,width:1260,height:850};

export const DEVELOPMENT_V3_AGENT_SPRITES=[
  {idle:'character.01.manager.navy.front.idle.c6dc34cd78',working:'character.01.manager.navy.right.seated.working.646715397d'},
  {idle:'character.02.worker.orange.yellow.front.idle.0c6c38f3e5',working:'character.02.worker.orange.yellow.right.seated.working.d89cdb7c93'},
  {idle:'character.03.worker.dark.purple.front.idle.b0ecf8e174',working:'character.03.worker.dark.purple.right.seated.working.c2f29f1c67'},
  {idle:'character.04.worker.brown.green.front.idle.0053fa062f',working:'character.04.worker.brown.green.right.seated.working.c7fa72d8b7'},
  {idle:'character.05.worker.black.charcoal.front.idle.a7a88018af',working:'character.05.worker.black.charcoal.right.seated.working.07399caf29'},
  {idle:'character.06.worker.blond.blue.front.idle.cf5be32a0f',working:'character.06.worker.blond.blue.right.seated.working.7890eb657a'},
] as const;

export const DEVELOPMENT_V3_ASSETS={
  floor:'floor.architecture.001.floor.wood.plank.tile.3957bd6a02',
  meetingRug:'rug.055.p03.18.blue.executive.office.rug.4d633abdd4',
  loungeRug:'rug.prop.011.lounge.rug.744e8a1f81',
  wallH:'architecture.architecture.005.outer.wall.horizontal.482ac5b7cd',
  wallV:'architecture.architecture.006.outer.wall.vertical.d1e5aa3c68',
  wallCorner:'architecture.architecture.009.structural.corner.post.d13add17d9',
  glassLong:'glass.architecture.009.glass.horizontal.long.5327be0d0f',
  glassV:'glass.architecture.011.glass.vertical.medium.6e8366883b',
  meetingGlassH:'glass.architecture.013.glass.partition.horizontal.8c253f3341',
  meetingGlassV:'glass.architecture.014.glass.partition.vertical.b89e37da3f',
  workstation:'desk.combination.001.complete.workstation.22f9e85f92',
  wallDisplay:'monitor.prop.015.wall.display.6410060367',
  marketWall:'monitor.tech.007.large.market.video.wall.b3fd1bf0dc',
  whiteboard:'whiteboard.035.p02.17.whiteboard.with.diagrams.5db621d5d2',
  conferenceTable:'table.001.p01.01.large.rectangular.conference.table.9fa0913ec6',
  conferenceChairNorth:'chair.furniture.009.conference.chair.north.2c380d40b7',
  conferenceChairSouth:'chair.furniture.010.conference.chair.south.39b5b2d98e',
  conferenceChairRight:'chair.furniture.012.conference.chair.right.a62ae2fd1e',
  conferenceChairLeft:'chair.furniture.011.conference.chair.left.ee6b8f37d1',
  sofa:'seating.prop.028.teal.lounge.sofa.e10cd9310c',
  loungeArmchair:'seating.012.p01.12.teal.lounge.armchair.9440121898',
  loungeTable:'coffee.010.round.lounge.coffee.table.4ec13eb00f',
  bookcase:'storage.prop.016.tall.bookcase.141dcb5f7a',
  documentCabinet:'storage.prop.017.document.cabinet.d8643d2784',
  plantLarge:'plant.prop.036.large.round.pot.plant.2ab1c2f413',
  plantMedium:'plant.prop.037.medium.square.planter.plant.212fc9ff2f',
  plantSmall:'plant.prop.039.small.brown.pot.plant.c01b2b0360',
  floorLamp:'lighting.prop.009.floor.lamp.22dbca4e23',
  printer:'electronics.prop.020.compact.printer.scanner.4611e63027',
  dividerPlanter:'plant.061.p04.04.workstation.divider.planter.888514e87d',
  sideboard:'storage.furniture.005.low.sideboard.df01bea9c3',
} as const;

export type DevelopmentV3AssetId=typeof DEVELOPMENT_V3_ASSETS[keyof typeof DEVELOPMENT_V3_ASSETS];

export type DevelopmentV3Placement={
  id:string;
  assetId:DevelopmentV3AssetId;
  x:number;
  y:number;
  scale:number;
  layer:AssetLayer;
  anchorX?:number;
  anchorY?:number;
  alpha?:number;
  shadow?:boolean;
};

export const DEVELOPMENT_V3_ZONES={
  work:{x:500,y:315,width:510,height:330},
  lounge:{x:255,y:635,width:330,height:230},
  planning:{x:965,y:120,width:390,height:260},
  meeting:{x:1035,y:390,width:300,height:320},
  storage:{x:235,y:235,width:145,height:390},
  entry:{x:760,y:805,width:160,height:95},
} as const;

export const DEVELOPMENT_V3_WORKSTATIONS=[
  {id:'ws-1',x:585,y:405,agentX:585,agentY:438},
  {id:'ws-2',x:755,y:405,agentX:755,agentY:438},
  {id:'ws-3',x:925,y:405,agentX:925,agentY:438},
  {id:'ws-4',x:585,y:580,agentX:585,agentY:613},
  {id:'ws-5',x:755,y:580,agentX:755,agentY:613},
  {id:'ws-6',x:925,y:580,agentX:925,agentY:613},
] as const;

export const DEVELOPMENT_V3_BEHAVIOR={
  planning:{x:1120,y:310},
  review:{x:1165,y:575},
  waiting:{x:430,y:735},
  lounge:{x:455,y:770},
  entry:{x:840,y:845},
} as const;

export const DEVELOPMENT_V3_PLACEMENTS:DevelopmentV3Placement[]=[
  // Thin modular shell: real perimeter, real opening, no decorative wall blocks covering furniture.
  ...[274,402,530,658,786,914,1042,1170,1298,1426].map((x,index)=>({
    id:`top-wall-${index+1}`,assetId:DEVELOPMENT_V3_ASSETS.wallH,x,y:86,scale:1,layer:'wall_back' as const,
  })),
  ...[274,402,530,658].map((x,index)=>({
    id:`bottom-wall-left-${index+1}`,assetId:DEVELOPMENT_V3_ASSETS.wallH,x,y:904,scale:1,layer:'wall_front' as const,
  })),
  ...[1022,1150,1278,1406].map((x,index)=>({
    id:`bottom-wall-right-${index+1}`,assetId:DEVELOPMENT_V3_ASSETS.wallH,x,y:904,scale:1,layer:'wall_front' as const,
  })),
  ...[182,310,438,566,694,822].map((y,index)=>({
    id:`left-wall-${index+1}`,assetId:DEVELOPMENT_V3_ASSETS.wallV,x:226,y,scale:1,layer:'wall_back' as const,
  })),
  ...[182,310,438,566,694,822].map((y,index)=>({
    id:`right-wall-${index+1}`,assetId:DEVELOPMENT_V3_ASSETS.wallV,x:1454,y,scale:1,layer:'wall_back' as const,
  })),
  {id:'corner-top-left',assetId:DEVELOPMENT_V3_ASSETS.wallCorner,x:226,y:86,scale:1,layer:'wall_back'},
  {id:'corner-top-right',assetId:DEVELOPMENT_V3_ASSETS.wallCorner,x:1454,y:86,scale:1,layer:'wall_back'},

  // Upper glass/planning wall, flush with architecture.
  {id:'glass-planning-a',assetId:DEVELOPMENT_V3_ASSETS.glassLong,x:650,y:188,scale:1.04,layer:'wall_back'},
  {id:'glass-planning-b',assetId:DEVELOPMENT_V3_ASSETS.glassLong,x:910,y:188,scale:1.04,layer:'wall_back'},
  {id:'whiteboard',assetId:DEVELOPMENT_V3_ASSETS.whiteboard,x:805,y:250,scale:.66,layer:'surface'},
  {id:'dashboard',assetId:DEVELOPMENT_V3_ASSETS.marketWall,x:1170,y:250,scale:.59,layer:'surface'},
  {id:'dashboard-sideboard',assetId:DEVELOPMENT_V3_ASSETS.sideboard,x:1170,y:327,scale:.62,layer:'furniture_back',shadow:true},

  // Left storage wall. All storage is flush to the wall and on the floor.
  {id:'storage-bookcase',assetId:DEVELOPMENT_V3_ASSETS.bookcase,x:315,y:455,scale:.72,layer:'furniture_back',shadow:true},
  {id:'storage-cabinet',assetId:DEVELOPMENT_V3_ASSETS.documentCabinet,x:315,y:585,scale:.62,layer:'furniture_back',shadow:true},
  {id:'storage-printer',assetId:DEVELOPMENT_V3_ASSETS.printer,x:315,y:510,scale:.45,layer:'surface'},

  // Six aligned workstations, two rows of three.
  ...DEVELOPMENT_V3_WORKSTATIONS.map(ws=>({
    id:ws.id,
    assetId:DEVELOPMENT_V3_ASSETS.workstation,
    x:ws.x,
    y:ws.y,
    scale:.54,
    layer:'furniture_back' as const,
    shadow:true,
  })),

  // Green dividers between workstation rows, never crossing rugs.
  {id:'divider-a',assetId:DEVELOPMENT_V3_ASSETS.dividerPlanter,x:670,y:495,scale:.42,layer:'furniture_front',shadow:true},
  {id:'divider-b',assetId:DEVELOPMENT_V3_ASSETS.dividerPlanter,x:840,y:495,scale:.42,layer:'furniture_front',shadow:true},

  // Meeting area is a self-contained glass pod on its own rug.
  {id:'meeting-rug',assetId:DEVELOPMENT_V3_ASSETS.meetingRug,x:1185,y:620,scale:.72,layer:'floor',alpha:.94},
  {id:'meeting-glass-left',assetId:DEVELOPMENT_V3_ASSETS.meetingGlassV,x:1043,y:540,scale:1.95,layer:'wall_front'},
  {id:'meeting-glass-top-a',assetId:DEVELOPMENT_V3_ASSETS.meetingGlassH,x:1120,y:420,scale:1.15,layer:'wall_back'},
  {id:'meeting-glass-top-b',assetId:DEVELOPMENT_V3_ASSETS.meetingGlassH,x:1240,y:420,scale:1.15,layer:'wall_back'},
  {id:'meeting-table',assetId:DEVELOPMENT_V3_ASSETS.conferenceTable,x:1185,y:590,scale:.54,layer:'furniture_back',shadow:true},
  {id:'meeting-chair-north',assetId:DEVELOPMENT_V3_ASSETS.conferenceChairNorth,x:1185,y:500,scale:.56,layer:'furniture_back'},
  {id:'meeting-chair-south',assetId:DEVELOPMENT_V3_ASSETS.conferenceChairSouth,x:1185,y:690,scale:.56,layer:'furniture_front'},
  {id:'meeting-chair-west',assetId:DEVELOPMENT_V3_ASSETS.conferenceChairLeft,x:1095,y:600,scale:.56,layer:'furniture_front'},
  {id:'meeting-chair-east',assetId:DEVELOPMENT_V3_ASSETS.conferenceChairRight,x:1275,y:600,scale:.56,layer:'furniture_front'},

  // Lounge: rug owns the entire lounge footprint; no desk may cross it.
  {id:'lounge-rug',assetId:DEVELOPMENT_V3_ASSETS.loungeRug,x:425,y:770,scale:1.02,layer:'floor',alpha:.96},
  {id:'lounge-sofa',assetId:DEVELOPMENT_V3_ASSETS.sofa,x:355,y:805,scale:.67,layer:'furniture_back',shadow:true},
  {id:'lounge-armchair',assetId:DEVELOPMENT_V3_ASSETS.loungeArmchair,x:515,y:810,scale:.46,layer:'furniture_front',shadow:true},
  {id:'lounge-table',assetId:DEVELOPMENT_V3_ASSETS.loungeTable,x:455,y:795,scale:.48,layer:'furniture_back',shadow:true},
  {id:'lounge-lamp',assetId:DEVELOPMENT_V3_ASSETS.floorLamp,x:280,y:755,scale:.70,layer:'furniture_back'},

  // Intentional greenery. Plants support zones; they are not random fillers.
  {id:'plant-top-left',assetId:DEVELOPMENT_V3_ASSETS.plantLarge,x:330,y:220,scale:.58,layer:'furniture_front',shadow:true},
  {id:'plant-planning-left',assetId:DEVELOPMENT_V3_ASSETS.plantMedium,x:560,y:220,scale:.54,layer:'furniture_front'},
  {id:'plant-planning-right',assetId:DEVELOPMENT_V3_ASSETS.plantMedium,x:950,y:220,scale:.54,layer:'furniture_front'},
  {id:'plant-meeting',assetId:DEVELOPMENT_V3_ASSETS.plantLarge,x:1325,y:470,scale:.52,layer:'furniture_front',shadow:true},
  {id:'plant-lounge',assetId:DEVELOPMENT_V3_ASSETS.plantLarge,x:300,y:835,scale:.52,layer:'furniture_front',shadow:true},
  {id:'plant-entry-left',assetId:DEVELOPMENT_V3_ASSETS.plantMedium,x:735,y:845,scale:.50,layer:'furniture_front'},
  {id:'plant-entry-right',assetId:DEVELOPMENT_V3_ASSETS.plantMedium,x:945,y:845,scale:.50,layer:'furniture_front'},
];

export const DEVELOPMENT_V3_LAYER_ORDER:AssetLayer[]=[
  'floor','wall_back','furniture_back','surface','character','furniture_front','wall_front','fx','overlay',
];

export function requiredDevelopmentV3AssetIds(){
  return [...new Set([...DEVELOPMENT_V3_PLACEMENTS.map(p=>p.assetId),DEVELOPMENT_V3_ASSETS.floor,...DEVELOPMENT_V3_AGENT_SPRITES.flatMap(s=>[s.idle,s.working])])];
}

export function validateDevelopmentV3Registry(registry:Map<string,AssetRecord>){
  const missing=requiredDevelopmentV3AssetIds().filter(id=>!registry.has(id));
  return{ok:missing.length===0,missing};
}


export const DEVELOPMENT_V3_ROOM_SPEC={
  ...DEVELOPMENT_ROOM_TEMPLATE,
  id:'development.v3',
  name:'Development',
  capacity:6,
  dimensions:{widthTiles:40,heightTiles:27,tileSize:32},
  style:{...DEVELOPMENT_ROOM_TEMPLATE.style,theme:'agent-office-premium',accent:'cyan',material:'warm-wood',density:'dense' as const},
};

export const DEVELOPMENT_V3_ROOM_LAYOUT:RoomLayout={
  schemaVersion:1,
  room:{
    id:'development.v3',
    spec:DEVELOPMENT_V3_ROOM_SPEC,
    origin:{x:DEVELOPMENT_V3_BOUNDS.x,y:DEVELOPMENT_V3_BOUNDS.y},
  },
  placements:DEVELOPMENT_V3_PLACEMENTS.map(p=>({
    id:p.id,assetId:p.assetId,x:p.x,y:p.y,rotation:'none',scale:p.scale,layerOverride:p.layer,zBias:0,metadata:{shadow:Boolean(p.shadow),alpha:p.alpha??1},
  })),
  walkable:[],
  blocked:[],
  interactions:[
    ...DEVELOPMENT_V3_WORKSTATIONS.map((ws,index)=>({
      id:`development.workstation.${index+1}`,kind:'workstation',x:ws.agentX,y:ws.agentY,capacity:1,assetPlacementId:ws.id,tags:['development','work','coding'],
    })),
    {id:'development.whiteboard',kind:'whiteboard',x:805,y:285,capacity:3,assetPlacementId:'whiteboard',tags:['planning','review']},
    {id:'development.meeting',kind:'meeting',x:1185,y:625,capacity:4,assetPlacementId:'meeting-table',tags:['meeting','review']},
    {id:'development.lounge',kind:'seat',x:420,y:790,capacity:3,assetPlacementId:'lounge-sofa',tags:['rest','waiting']},
    {id:'development.entry',kind:'door',x:840,y:852,capacity:1,tags:['entry','open-passage']},
  ],
};


export function pointInsideZone(x:number,y:number,zone:{x:number;y:number;width:number;height:number}){
  return x>=zone.x&&x<=zone.x+zone.width&&y>=zone.y&&y<=zone.y+zone.height;
}

export function validateDevelopmentV3Composition(){
  const errors:string[]=[];
  const byId=new Map(DEVELOPMENT_V3_PLACEMENTS.map(p=>[p.id,p]));
  for(const ws of DEVELOPMENT_V3_WORKSTATIONS){
    if(!pointInsideZone(ws.x,ws.y,DEVELOPMENT_V3_ZONES.work))errors.push(`workstation-outside-work-zone:${ws.id}`);
    if(pointInsideZone(ws.x,ws.y,DEVELOPMENT_V3_ZONES.lounge))errors.push(`workstation-overlaps-lounge:${ws.id}`);
    if(pointInsideZone(ws.x,ws.y,DEVELOPMENT_V3_ZONES.meeting))errors.push(`workstation-overlaps-meeting:${ws.id}`);
  }
  for(const id of ['lounge-rug','lounge-sofa','lounge-armchair','lounge-table','lounge-lamp']){
    const p=byId.get(id);if(!p||!pointInsideZone(p.x,p.y,DEVELOPMENT_V3_ZONES.lounge))errors.push(`lounge-item-outside-zone:${id}`);
  }
  for(const id of ['meeting-rug','meeting-table','meeting-chair-north','meeting-chair-south','meeting-chair-west','meeting-chair-east']){
    const p=byId.get(id);if(!p||!pointInsideZone(p.x,p.y,DEVELOPMENT_V3_ZONES.meeting))errors.push(`meeting-item-outside-zone:${id}`);
  }
  // Entrance is intentionally an open passage in the bottom wall, matching the approved reference.
  const leftWall=DEVELOPMENT_V3_PLACEMENTS.some(p=>p.id.startsWith('bottom-wall-left-'));
  const rightWall=DEVELOPMENT_V3_PLACEMENTS.some(p=>p.id.startsWith('bottom-wall-right-'));
  if(!leftWall||!rightWall)errors.push('entry-wall-segments-missing');
  if(DEVELOPMENT_V3_PLACEMENTS.some(p=>p.id==='entrance'))errors.push('unexpected-door-in-open-passage');
  const storageIds=['storage-bookcase','storage-cabinet'];
  for(const id of storageIds){
    const p=byId.get(id);if(!p||!pointInsideZone(p.x,p.y,DEVELOPMENT_V3_ZONES.storage))errors.push(`storage-outside-wall-zone:${id}`);
  }
  return{ok:errors.length===0,errors};
}
