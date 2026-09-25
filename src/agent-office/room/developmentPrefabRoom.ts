import type { AssetRegistry } from '../assets/assetRegistry.js';
import type { AssetCalibrationCatalog } from '../assets/assetCalibration.js';
import { DEVELOPMENT_PREFABS } from '../assets/developmentPrefabs.js';
import { PrefabLibrary } from '../assets/prefabSystem.js';
import { compilePrefabRoom, socketsByKind, type CompiledPrefabRoom } from '../assets/prefabRoom.js';

export const DEVELOPMENT_52B_BOUNDS={x:210,y:70,width:1260,height:840} as const;

export const DEVELOPMENT_52B_BLUEPRINT={
  schemaVersion:1 as const,
  id:'development.5.2b',
  name:'Development',
  width:DEVELOPMENT_52B_BOUNDS.width,
  height:DEVELOPMENT_52B_BOUNDS.height,
  origin:{x:DEVELOPMENT_52B_BOUNDS.x,y:DEVELOPMENT_52B_BOUNDS.y},
  instances:[
    {id:'shell',prefabId:'development.shell',x:630,y:420},
    {id:'planning',prefabId:'development.planning-wall',x:665,y:155},
    {id:'work',prefabId:'development.workpod.6',x:620,y:455},
    {id:'meeting',prefabId:'meeting.glass.6',x:1080,y:475},
    {id:'lounge',prefabId:'lounge.standard',x:245,y:690},
    {id:'storage',prefabId:'storage.wall.standard',x:95,y:420},
    {id:'entry',prefabId:'entrance.bottom.open',x:630,y:790},
  ],
  protectedZones:[
    {id:'main-entry-corridor',x:540,y:650,width:180,height:160,tags:['circulation','entry']},
    {id:'work-left-aisle',x:300,y:300,width:65,height:350,tags:['circulation']},
    {id:'meeting-access',x:895,y:500,width:50,height:220,tags:['circulation']},
  ],
  tags:['development','approved-reference','prefab-runtime'],
} as const;

export type Development52BRuntime={
  room:CompiledPrefabRoom;
  workSockets:CompiledPrefabRoom['sockets'];
  planningSockets:CompiledPrefabRoom['sockets'];
  meetingSockets:CompiledPrefabRoom['sockets'];
  loungeSockets:CompiledPrefabRoom['sockets'];
  entrySockets:CompiledPrefabRoom['sockets'];
};

export function compileDevelopment52B(
  registry:AssetRegistry,
  calibrations:AssetCalibrationCatalog,
):Development52BRuntime{
  const library=new PrefabLibrary(DEVELOPMENT_PREFABS);
  const room=compilePrefabRoom(DEVELOPMENT_52B_BLUEPRINT,library,registry,calibrations);
  if(room.errors.length)throw new Error(`Development 5.2B blueprint invalid: ${room.errors.join(', ')}`);
  const workSockets=socketsByKind(room,'work').filter(socket=>socket.prefabInstanceId==='work');
  const planningSockets=[
    ...socketsByKind(room,'present').filter(socket=>socket.prefabInstanceId==='planning'),
    ...socketsByKind(room,'stand').filter(socket=>socket.prefabInstanceId==='planning'),
  ];
  const meetingSockets=socketsByKind(room,'meeting').filter(socket=>socket.prefabInstanceId==='meeting');
  const loungeSockets=socketsByKind(room,'seat').filter(socket=>socket.prefabInstanceId==='lounge');
  const entrySockets=[
    ...socketsByKind(room,'entry').filter(socket=>socket.prefabInstanceId==='entry'),
    ...socketsByKind(room,'exit').filter(socket=>socket.prefabInstanceId==='entry'),
  ];

  if(workSockets.length<6)throw new Error(`Development 5.2B requires 6 work sockets, got ${workSockets.length}`);
  if(!planningSockets.length)throw new Error('Development 5.2B missing planning sockets');
  if(!meetingSockets.length)throw new Error('Development 5.2B missing meeting sockets');
  if(!loungeSockets.length)throw new Error('Development 5.2B missing lounge sockets');
  if(!entrySockets.length)throw new Error('Development 5.2B missing entry socket');

  return{room,workSockets,planningSockets,meetingSockets,loungeSockets,entrySockets};
}

export function developmentAgentTarget(runtime:Development52BRuntime,index:number,state:string){
  const choose=<T>(items:T[])=>items[Math.abs(index)%items.length];
  if(state==='thinking'||state==='planning')return choose(runtime.planningSockets);
  if(state==='testing'||state==='reviewing')return choose(runtime.meetingSockets);
  if(state==='waiting'||state==='paused'||state==='resting'||state==='completed')return choose(runtime.loungeSockets);
  return choose(runtime.workSockets);
}
