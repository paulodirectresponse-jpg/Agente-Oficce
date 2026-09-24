import { PrefabDefinitionSchema, type PrefabDefinition } from './prefabSystem.js';

const workstation='desk.combination.001.complete.workstation.22f9e85f92';
const divider='plant.061.p04.04.workstation.divider.planter.888514e87d';
const meetingRug='rug.055.p03.18.blue.executive.office.rug.4d633abdd4';
const meetingGlassH='glass.architecture.013.glass.partition.horizontal.8c253f3341';
const meetingGlassV='glass.architecture.014.glass.partition.vertical.b89e37da3f';
const meetingTable='table.001.p01.01.large.rectangular.conference.table.9fa0913ec6';
const chairN='chair.furniture.009.conference.chair.north.2c380d40b7';
const chairS='chair.furniture.010.conference.chair.south.39b5b2d98e';
const chairL='chair.furniture.011.conference.chair.left.ee6b8f37d1';
const chairR='chair.furniture.012.conference.chair.right.a62ae2fd1e';
const loungeRug='rug.prop.011.lounge.rug.744e8a1f81';
const loungeSofa='seating.prop.028.teal.lounge.sofa.e10cd9310c';
const loungeChair='seating.012.p01.12.teal.lounge.armchair.9440121898';
const loungeTable='coffee.010.round.lounge.coffee.table.4ec13eb00f';
const floorLamp='lighting.prop.009.floor.lamp.22dbca4e23';
const bookcase='storage.prop.016.tall.bookcase.141dcb5f7a';
const documentCabinet='storage.prop.017.document.cabinet.d8643d2784';
const printer='electronics.prop.020.compact.printer.scanner.4611e63027';
const glassLong='glass.architecture.009.glass.horizontal.long.5327be0d0f';
const whiteboard='whiteboard.035.p02.17.whiteboard.with.diagrams.5db621d5d2';
const dashboard='monitor.tech.007.large.market.video.wall.b3fd1bf0dc';
const credenza='storage.meeting.credenza.wood.5310a6eae9';
const plantLarge='plant.prop.036.large.round.pot.plant.2ab1c2f413';
const plantMedium='plant.prop.037.medium.square.planter.plant.212fc9ff2f';

function prefab(input:unknown):PrefabDefinition{
  return PrefabDefinitionSchema.parse({schemaVersion:1,...(input as Record<string,unknown>)});
}

export const DEVELOPMENT_PREFABS:PrefabDefinition[]=[
  prefab({
    id:'development.workpod.6',
    name:'Development Work Pod — 6',
    category:'workpod',
    width:620,height:360,pivot:{x:310,y:180},
    placements:[
      {id:'ws1',assetId:workstation,x:115,y:95,scaleToken:'standard',tags:['workstation']},
      {id:'ws2',assetId:workstation,x:310,y:95,scaleToken:'standard',tags:['workstation']},
      {id:'ws3',assetId:workstation,x:505,y:95,scaleToken:'standard',tags:['workstation']},
      {id:'divider1',assetId:divider,x:212,y:180,scaleToken:'compact',layerOverride:'furniture_front',tags:['divider']},
      {id:'divider2',assetId:divider,x:408,y:180,scaleToken:'compact',layerOverride:'furniture_front',tags:['divider']},
      {id:'ws4',assetId:workstation,x:115,y:270,scaleToken:'standard',tags:['workstation']},
      {id:'ws5',assetId:workstation,x:310,y:270,scaleToken:'standard',tags:['workstation']},
      {id:'ws6',assetId:workstation,x:505,y:270,scaleToken:'standard',tags:['workstation']},
    ],
    sockets:[
      {id:'seat1',kind:'work',x:115,y:125,facing:'north',pose:'seated-working',tags:['workstation','1']},
      {id:'seat2',kind:'work',x:310,y:125,facing:'north',pose:'seated-working',tags:['workstation','2']},
      {id:'seat3',kind:'work',x:505,y:125,facing:'north',pose:'seated-working',tags:['workstation','3']},
      {id:'seat4',kind:'work',x:115,y:300,facing:'north',pose:'seated-working',tags:['workstation','4']},
      {id:'seat5',kind:'work',x:310,y:300,facing:'north',pose:'seated-working',tags:['workstation','5']},
      {id:'seat6',kind:'work',x:505,y:300,facing:'north',pose:'seated-working',tags:['workstation','6']},
    ],
    collision:[
      {x:35,y:20,width:550,height:145},
      {x:35,y:195,width:550,height:145},
    ],
    keepClear:[
      {x:0,y:155,width:620,height:45},
      {x:0,y:340,width:620,height:20},
    ],
    tags:['development','core','approved-composition'],
    roomTags:['development'],teamTags:['development','engineering'],
    notes:['Internal spacing is fixed after visual approval. Position the prefab as one unit; do not independently drift workstation placements.'],
  }),
  prefab({
    id:'development.planning-wall',
    name:'Development Planning Wall',
    category:'planning',
    width:790,height:220,pivot:{x:395,y:110},
    placements:[
      {id:'glass1',assetId:glassLong,x:195,y:55,scaleToken:'standard',layerOverride:'wall_back'},
      {id:'glass2',assetId:glassLong,x:390,y:55,scaleToken:'standard',layerOverride:'wall_back'},
      {id:'whiteboard',assetId:whiteboard,x:390,y:130,scaleToken:'standard',layerOverride:'surface'},
      {id:'dashboard',assetId:dashboard,x:650,y:120,scaleToken:'standard',layerOverride:'surface'},
      {id:'credenza',assetId:credenza,x:650,y:195,scaleToken:'standard'},
      {id:'plantLeft',assetId:plantMedium,x:80,y:180,scaleToken:'standard',layerOverride:'furniture_front'},
      {id:'plantRight',assetId:plantLarge,x:755,y:185,scaleToken:'standard',layerOverride:'furniture_front'},
    ],
    sockets:[
      {id:'presenter',kind:'present',x:390,y:205,facing:'north',pose:'standing-present',capacity:1,tags:['planning']},
      {id:'reviewer1',kind:'stand',x:330,y:205,facing:'north',capacity:1,tags:['review']},
      {id:'reviewer2',kind:'stand',x:450,y:205,facing:'north',capacity:1,tags:['review']},
    ],
    collision:[{x:0,y:0,width:790,height:85},{x:570,y:120,width:210,height:90}],
    keepClear:[{x:245,y:175,width:290,height:45}],
    tags:['development','planning','glass'],roomTags:['development'],teamTags:['development'],
    notes:['Wall-mounted content and storage are a single calibrated composition.'],
  }),
  prefab({
    id:'meeting.glass.6',
    name:'Glass Meeting Pod — 6',
    category:'meeting',
    width:330,height:330,pivot:{x:165,y:165},
    placements:[
      {id:'rug',assetId:meetingRug,x:165,y:300,scaleToken:'standard',layerOverride:'floor'},
      {id:'glassLeft',assetId:meetingGlassV,x:25,y:200,scaleToken:'standard',layerOverride:'wall_front'},
      {id:'glassTop1',assetId:meetingGlassH,x:110,y:35,scaleToken:'standard',layerOverride:'wall_back'},
      {id:'glassTop2',assetId:meetingGlassH,x:220,y:35,scaleToken:'standard',layerOverride:'wall_back'},
      {id:'table',assetId:meetingTable,x:165,y:190,scaleToken:'standard'},
      {id:'north',assetId:chairN,x:165,y:100,scaleToken:'standard'},
      {id:'south',assetId:chairS,x:165,y:285,scaleToken:'standard',layerOverride:'furniture_front'},
      {id:'west',assetId:chairL,x:80,y:195,scaleToken:'standard',layerOverride:'furniture_front'},
      {id:'east',assetId:chairR,x:250,y:195,scaleToken:'standard',layerOverride:'furniture_front'},
      {id:'plant',assetId:plantLarge,x:300,y:95,scaleToken:'compact',layerOverride:'furniture_front'},
    ],
    sockets:[
      {id:'chairN',kind:'meeting',x:165,y:100,facing:'south',pose:'seated-meeting'},
      {id:'chairS',kind:'meeting',x:165,y:285,facing:'north',pose:'seated-meeting'},
      {id:'chairW',kind:'meeting',x:80,y:195,facing:'east',pose:'seated-meeting'},
      {id:'chairE',kind:'meeting',x:250,y:195,facing:'west',pose:'seated-meeting'},
      {id:'presenter',kind:'stand',x:165,y:65,facing:'south',pose:'standing-present'},
    ],
    collision:[{x:30,y:110,width:270,height:175}],
    keepClear:[{x:0,y:280,width:330,height:50}],
    tags:['meeting','glass','premium'],roomTags:['development','strategy'],teamTags:['development','strategy'],
    notes:['Meeting rug, table, chairs and glass remain internally locked.'],
  }),
  prefab({
    id:'lounge.standard',
    name:'Premium Lounge',
    category:'lounge',
    width:340,height:260,pivot:{x:170,y:130},
    placements:[
      {id:'rug',assetId:loungeRug,x:170,y:250,scaleToken:'standard',layerOverride:'floor'},
      {id:'sofa',assetId:loungeSofa,x:90,y:190,scaleToken:'standard'},
      {id:'chair',assetId:loungeChair,x:265,y:205,scaleToken:'standard',layerOverride:'furniture_front'},
      {id:'table',assetId:loungeTable,x:190,y:205,scaleToken:'standard'},
      {id:'lamp',assetId:floorLamp,x:25,y:145,scaleToken:'standard'},
      {id:'plant',assetId:plantLarge,x:35,y:235,scaleToken:'compact',layerOverride:'furniture_front'},
    ],
    sockets:[
      {id:'sofa1',kind:'seat',x:85,y:205,facing:'east',pose:'seated-rest'},
      {id:'sofa2',kind:'seat',x:125,y:205,facing:'east',pose:'seated-rest'},
      {id:'chair1',kind:'seat',x:265,y:205,facing:'west',pose:'seated-rest'},
      {id:'stand',kind:'stand',x:195,y:140,facing:'south',pose:'standing'},
    ],
    collision:[{x:20,y:125,width:285,height:120}],
    keepClear:[{x:120,y:65,width:180,height:70}],
    tags:['lounge','premium','rest'],roomTags:['development','lounge'],teamTags:['general'],
    notes:['No desks or workstation assets may enter the lounge footprint.'],
  }),
  prefab({
    id:'storage.wall.standard',
    name:'Office Storage Wall',
    category:'storage',
    width:150,height:380,pivot:{x:75,y:190},
    placements:[
      {id:'bookcase',assetId:bookcase,x:75,y:125,scaleToken:'standard'},
      {id:'printer',assetId:printer,x:75,y:210,scaleToken:'standard',layerOverride:'surface'},
      {id:'cabinet',assetId:documentCabinet,x:75,y:310,scaleToken:'standard'},
    ],
    sockets:[
      {id:'printer',kind:'interact',x:135,y:210,facing:'west',pose:'standing-interact',tags:['printer']},
      {id:'storage',kind:'interact',x:135,y:305,facing:'west',pose:'standing-interact',tags:['storage']},
    ],
    collision:[{x:15,y:20,width:110,height:340}],
    keepClear:[{x:125,y:155,width:25,height:200}],
    tags:['storage','office-support'],roomTags:['development'],teamTags:['general'],
    notes:['Designed to sit flush against a wall.'],
  }),
  prefab({
    id:'entrance.bottom.open',
    name:'Open Bottom Entrance',
    category:'entrance',
    width:260,height:90,pivot:{x:130,y:45},
    placements:[],
    sockets:[
      {id:'entry',kind:'entry',x:130,y:85,facing:'north',pose:'standing'},
      {id:'exit',kind:'exit',x:130,y:85,facing:'south',pose:'standing'},
    ],
    collision:[],
    keepClear:[{x:55,y:0,width:150,height:90}],
    tags:['entrance','open-passage'],roomTags:['development'],teamTags:['general'],
    notes:['Intentionally contains no decorative door. The surrounding room shell owns the wall opening.'],
  }),
];

export function developmentPrefabLibrary(){
  return DEVELOPMENT_PREFABS;
}
