import type { AssetLayer, AssetRecord } from '../assets/assetRegistry.js';

export const DEVELOPMENT_V3_BOUNDS={x:245,y:75,width:1190,height:790};

export const DEVELOPMENT_V3_ASSETS={
  floor:'floor.architecture.001.floor.wood.plank.tile.3957bd6a02',
  rug:'rug.055.p03.18.blue.executive.office.rug.4d633abdd4',
  wallLong:'architecture.architecture.003.wall.horizontal.long.7deb52d0a2',
  wallV:'architecture.architecture.005.wall.vertical.medium.f0f38f205f',
  glassLong:'glass.architecture.009.glass.horizontal.long.5327be0d0f',
  glassV:'glass.architecture.011.glass.vertical.medium.6e8366883b',
  door:'door.architecture.015.wooden.door.hinge.left.1fa3fd1eae',
  workstation:'desk.combination.001.complete.workstation.22f9e85f92',
  wallDisplay:'monitor.prop.015.wall.display.6410060367',
  whiteboard:'whiteboard.035.p02.17.whiteboard.with.diagrams.5db621d5d2',
  conferenceTable:'table.001.p01.01.large.rectangular.conference.table.9fa0913ec6',
  conferenceChair:'chair.010.p01.10.blue.conference.chair.b5e08d3b17',
  sofa:'seating.prop.028.teal.lounge.sofa.e10cd9310c',
  bookcase:'storage.prop.016.tall.bookcase.141dcb5f7a',
  documentCabinet:'storage.prop.017.document.cabinet.d8643d2784',
  plantLarge:'plant.prop.036.large.round.pot.plant.2ab1c2f413',
  plantMedium:'plant.prop.037.medium.square.planter.plant.212fc9ff2f',
  plantSmall:'plant.prop.039.small.brown.pot.plant.c01b2b0360',
  floorLamp:'lighting.prop.009.floor.lamp.22dbca4e23',
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

export const DEVELOPMENT_V3_WORKSTATIONS=[
  {id:'ws-1',x:535,y:390,agentX:535,agentY:418},
  {id:'ws-2',x:755,y:390,agentX:755,agentY:418},
  {id:'ws-3',x:975,y:390,agentX:975,agentY:418},
  {id:'ws-4',x:535,y:625,agentX:535,agentY:653},
  {id:'ws-5',x:755,y:625,agentX:755,agentY:653},
  {id:'ws-6',x:975,y:625,agentX:975,agentY:653},
] as const;

export const DEVELOPMENT_V3_BEHAVIOR={
  planning:{x:1180,y:515},
  review:{x:1190,y:645},
  waiting:{x:400,y:720},
  lounge:{x:440,y:735},
  entry:{x:340,y:780},
} as const;

export const DEVELOPMENT_V3_PLACEMENTS:DevelopmentV3Placement[]=[
  {id:'back-wall-a',assetId:DEVELOPMENT_V3_ASSETS.wallLong,x:485,y:188,scale:1.22,layer:'wall_back'},
  {id:'back-wall-b',assetId:DEVELOPMENT_V3_ASSETS.wallLong,x:1040,y:188,scale:1.22,layer:'wall_back'},
  {id:'left-wall',assetId:DEVELOPMENT_V3_ASSETS.wallV,x:284,y:525,scale:1.36,layer:'wall_back'},
  {id:'right-glass',assetId:DEVELOPMENT_V3_ASSETS.glassV,x:1380,y:495,scale:1.28,layer:'wall_back'},
  {id:'glass-a',assetId:DEVELOPMENT_V3_ASSETS.glassLong,x:640,y:217,scale:1.18,layer:'wall_back'},
  {id:'glass-b',assetId:DEVELOPMENT_V3_ASSETS.glassLong,x:1030,y:217,scale:1.18,layer:'wall_back'},
  {id:'entrance',assetId:DEVELOPMENT_V3_ASSETS.door,x:1290,y:806,scale:.95,layer:'wall_front'},

  ...DEVELOPMENT_V3_WORKSTATIONS.map(ws=>({
    id:ws.id,
    assetId:DEVELOPMENT_V3_ASSETS.workstation,
    x:ws.x,
    y:ws.y,
    scale:.62,
    layer:'furniture_back' as const,
    shadow:true,
  })),

  {id:'dashboard',assetId:DEVELOPMENT_V3_ASSETS.wallDisplay,x:1135,y:260,scale:.78,layer:'surface'},
  {id:'whiteboard',assetId:DEVELOPMENT_V3_ASSETS.whiteboard,x:1210,y:472,scale:.72,layer:'surface'},
  {id:'meeting-table',assetId:DEVELOPMENT_V3_ASSETS.conferenceTable,x:1190,y:610,scale:.60,layer:'furniture_back',shadow:true},
  {id:'meeting-chair-l',assetId:DEVELOPMENT_V3_ASSETS.conferenceChair,x:1110,y:620,scale:.52,layer:'furniture_front'},
  {id:'meeting-chair-r',assetId:DEVELOPMENT_V3_ASSETS.conferenceChair,x:1272,y:620,scale:.52,layer:'furniture_front'},

  {id:'lounge-rug',assetId:DEVELOPMENT_V3_ASSETS.rug,x:420,y:748,scale:.98,layer:'floor',alpha:.92},
  {id:'lounge-sofa',assetId:DEVELOPMENT_V3_ASSETS.sofa,x:420,y:755,scale:.66,layer:'furniture_back',shadow:true},
  {id:'lounge-lamp',assetId:DEVELOPMENT_V3_ASSETS.floorLamp,x:325,y:742,scale:.78,layer:'furniture_back'},
  {id:'bookcase',assetId:DEVELOPMENT_V3_ASSETS.bookcase,x:330,y:520,scale:.66,layer:'furniture_back',shadow:true},
  {id:'document-cabinet',assetId:DEVELOPMENT_V3_ASSETS.documentCabinet,x:1310,y:390,scale:.52,layer:'furniture_back',shadow:true},

  {id:'plant-large-left',assetId:DEVELOPMENT_V3_ASSETS.plantLarge,x:360,y:310,scale:.66,layer:'furniture_front',shadow:true},
  {id:'plant-large-right',assetId:DEVELOPMENT_V3_ASSETS.plantLarge,x:1320,y:720,scale:.62,layer:'furniture_front',shadow:true},
  {id:'plant-mid-a',assetId:DEVELOPMENT_V3_ASSETS.plantMedium,x:655,y:240,scale:.64,layer:'furniture_front'},
  {id:'plant-mid-b',assetId:DEVELOPMENT_V3_ASSETS.plantMedium,x:865,y:240,scale:.64,layer:'furniture_front'},
  {id:'plant-mid-c',assetId:DEVELOPMENT_V3_ASSETS.plantMedium,x:1090,y:760,scale:.58,layer:'furniture_front'},
  {id:'plant-small-a',assetId:DEVELOPMENT_V3_ASSETS.plantSmall,x:650,y:535,scale:.82,layer:'furniture_front'},
  {id:'plant-small-b',assetId:DEVELOPMENT_V3_ASSETS.plantSmall,x:865,y:535,scale:.82,layer:'furniture_front'},
];

export const DEVELOPMENT_V3_LAYER_ORDER:AssetLayer[]=[
  'floor','wall_back','furniture_back','surface','character','furniture_front','wall_front','fx','overlay',
];

export function requiredDevelopmentV3AssetIds(){
  return [...new Set(DEVELOPMENT_V3_PLACEMENTS.map(p=>p.assetId).concat(DEVELOPMENT_V3_ASSETS.floor))];
}

export function validateDevelopmentV3Registry(registry:Map<string,AssetRecord>){
  const missing=requiredDevelopmentV3AssetIds().filter(id=>!registry.has(id));
  return{ok:missing.length===0,missing};
}
