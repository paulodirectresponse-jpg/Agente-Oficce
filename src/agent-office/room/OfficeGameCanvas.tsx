import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomAgentView, StationKind } from './roomTypes.js';
import type { AssetRecord } from '../assets/assetRegistry.js';
import { api } from '../api.js';
import {
  DEVELOPMENT_V3_AGENT_SPRITES,
  DEVELOPMENT_V3_BEHAVIOR,
  DEVELOPMENT_V3_BOUNDS,
  DEVELOPMENT_V3_WORKSTATIONS,
  requiredDevelopmentV3AssetIds,
  validateDevelopmentV3Registry,
} from './developmentV3.js';
import {
  drawDevelopmentV3Back,
  drawDevelopmentV3Front,
  drawDevelopmentV3Mini,
  type LicensedDevelopmentRuntime,
} from './licensedDevelopmentRenderer.js';
import './room-game.css';

const WORLD_W=1680;
const WORLD_H=980;
const MIN_ZOOM=.46;
const MAX_ZOOM=1.9;
const TILE=WORLD_W/64;

type Vec={x:number;y:number};
type Camera={x:number;y:number;zoom:number};
type RuntimeAgent={
  id:string;
  x:number;
  y:number;
  tx:number;
  ty:number;
  vx:number;
  vy:number;
  frame:number;
  phase:number;
  bubbleUntil:number;
  previousActivity:string;
  spawnDone:boolean;
};

type Props={
  agents:RoomAgentView[];
  onSelect:(agent:RoomAgentView)=>void;
  lastHandoff:{from:string;to:string}|null;
};

const STATIONS:Record<StationKind,Vec[]>={
  development:[{x:704,y:354},{x:920,y:354},{x:704,y:530},{x:920,y:530},{x:810,y:442}],
  operations:[{x:1128,y:370},{x:1290,y:370},{x:1128,y:548},{x:1290,y:548}],
  research:[{x:428,y:735},{x:575,y:735},{x:500,y:838}],
  lead:[{x:895,y:748},{x:1060,y:748},{x:980,y:842}],
};

const SPRITES:Record<StationKind,string>={
  development:'/office-assets/characters/software-engineer.png',
  research:'/office-assets/characters/qa-engineer.png',
  lead:'/office-assets/characters/tech-lead.png',
  operations:'/office-assets/characters/product-owner.png',
};
const SCENE_ASSETS={
  decor:'/office-assets/decorations_LRK.png',
  cabinets:'/office-assets/cabinets_LRK.png',
  kitchen:'/office-assets/kitchen_LRK.png',
  living:'/office-assets/livingroom_LRK.png',
};

const COLORS={
  floor:'#c9baa3',
  line:'rgba(72,83,76,.18)',
  wall:'#45606a',
  room:'#d7c8ae',
  roomCool:'#c6d2d0',
  roomBlue:'#b8c8cf',
  roomGreen:'#c4d1c5',
  roomRose:'#c9becb',
  dark:'#203541',
  desk:'#765d47',
  screen:'#153d50',
  cyan:'#69c8d8',
  green:'#63d99e',
  amber:'#d8b260',
  red:'#d97676',
};

function clamp(n:number,min:number,max:number){return Math.min(max,Math.max(min,n))}
function hash(value:string){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function stationPosition(agent:RoomAgentView,index:number){
  const list=STATIONS[agent.station];
  const base=list[index%list.length];
  const cycle=Math.floor(index/list.length);
  return{x:base.x+cycle*34,y:base.y+cycle*26};
}
function behaviorPosition(agent:RoomAgentView,home:Vec,index:number,useDevelopmentV3=false):Vec{
  const lane=(hash(agent.id)%5)-2;
  if(useDevelopmentV3&&agent.station==='development'){
    if(agent.state==='thinking'||agent.state==='planning')return{x:DEVELOPMENT_V3_BEHAVIOR.planning.x+lane*18,y:DEVELOPMENT_V3_BEHAVIOR.planning.y+(index%2)*16};
    if(agent.state==='testing'||agent.state==='reviewing')return{x:DEVELOPMENT_V3_BEHAVIOR.review.x+lane*18,y:DEVELOPMENT_V3_BEHAVIOR.review.y+(index%2)*16};
    if(agent.state==='waiting'||agent.state==='paused')return{x:DEVELOPMENT_V3_BEHAVIOR.waiting.x+lane*16,y:DEVELOPMENT_V3_BEHAVIOR.waiting.y+(index%2)*14};
    if(agent.state==='resting'||agent.state==='completed')return{x:DEVELOPMENT_V3_BEHAVIOR.lounge.x+lane*16,y:DEVELOPMENT_V3_BEHAVIOR.lounge.y+(index%2)*14};
    return home;
  }
  if(agent.state==='thinking'||agent.state==='planning')return{x:165+lane*34,y:185+(index%2)*22};
  if(agent.state==='testing'||agent.state==='reviewing')return{x:935+lane*38,y:845+(index%2)*28};
  if(agent.state==='waiting')return{x:180+lane*34,y:880+(index%2)*24};
  if(agent.state==='resting'||agent.state==='completed')return{x:1375+lane*42,y:865+(index%2)*28};
  return home;
}
function isWorking(state:RoomAgentView['state']){
  return ['thinking','planning','responding','coding','testing','reviewing'].includes(state);
}
function statusColor(state:RoomAgentView['state']){
  if(state==='error'||state==='blocked')return COLORS.red;
  if(state==='waiting'||state==='paused')return COLORS.amber;
  if(state==='completed')return COLORS.cyan;
  if(isWorking(state))return COLORS.green;
  return '#7b909b';
}
function roundedRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
}
function cropAsset(ctx:CanvasRenderingContext2D,img:HTMLImageElement|undefined,sx:number,sy:number,sw:number,sh:number,x:number,y:number,scale=1){
  if(!img?.complete||!img.naturalWidth)return;
  ctx.drawImage(img,sx,sy,sw,sh,x,y,sw*(TILE/16)*scale,sh*(TILE/16)*scale);
}
function label(ctx:CanvasRenderingContext2D,text:string,x:number,y:number){
  ctx.fillStyle='rgba(39,56,61,.42)';ctx.font='700 12px ui-monospace,monospace';ctx.fillText(text.toUpperCase(),x,y);
}
function room(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,fill:string,name:string){
  ctx.fillStyle=fill;ctx.fillRect(x,y,w,h);ctx.strokeStyle='rgba(53,78,87,.7)';ctx.lineWidth=3;ctx.strokeRect(x,y,w,h);label(ctx,name,x+14,y+22);
}
function desk(ctx:CanvasRenderingContext2D,x:number,y:number,w=108){
  ctx.fillStyle=COLORS.desk;ctx.fillRect(x,y,w,16);
  ctx.fillStyle='#4f4034';ctx.fillRect(x+9,y+15,8,29);ctx.fillRect(x+w-17,y+15,8,29);
  ctx.fillStyle=COLORS.screen;ctx.fillRect(x+31,y-34,47,34);ctx.strokeStyle='#557d8c';ctx.strokeRect(x+31,y-34,47,34);
  ctx.fillStyle=COLORS.cyan;ctx.fillRect(x+38,y-25,31,3);ctx.fillRect(x+38,y-17,23,3);
  ctx.fillStyle='#2d4650';ctx.fillRect(x+17,y+24,25,17);
}
function plant(ctx:CanvasRenderingContext2D,x:number,y:number){
  ctx.fillStyle='#755744';ctx.fillRect(x-8,y+12,16,19);ctx.fillStyle='#4c8d63';
  for(const [dx,dy,r] of [[-9,0,11],[5,-6,12],[14,6,10],[-2,10,12]] as const){ctx.beginPath();ctx.arc(x+dx,y+dy,r,0,Math.PI*2);ctx.fill()}
}
function sofa(ctx:CanvasRenderingContext2D,x:number,y:number,w=140){
  ctx.fillStyle='#506d8b';ctx.fillRect(x,y,w,42);ctx.fillStyle='#6683a4';ctx.fillRect(x+8,y+7,w-16,27);ctx.fillStyle='#344d65';ctx.fillRect(x-8,y+9,12,34);ctx.fillRect(x+w-4,y+9,12,34);
}
function roundTable(ctx:CanvasRenderingContext2D,x:number,y:number,r=38){
  ctx.fillStyle='#89684f';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#304e5d';
  for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.fillRect(x+Math.cos(a)*(r+25)-9,y+Math.sin(a)*(r+25)-9,18,18)}
}
function server(ctx:CanvasRenderingContext2D,x:number,y:number,h=150,time=0,index=0){
  ctx.fillStyle='#203541';ctx.fillRect(x,y,52,h);ctx.strokeStyle='#54717f';ctx.strokeRect(x,y,52,h);
  for(let yy=y+13,n=0;yy<y+h-10;yy+=21,n++){ctx.fillStyle='#142a35';ctx.fillRect(x+7,yy,38,14);ctx.fillStyle=((Math.sin(time/320+n+index)+1)/2)>.38?COLORS.green:'#49646f';ctx.fillRect(x+37,yy+5,4,4)}
}
function board(ctx:CanvasRenderingContext2D,x:number,y:number,w=140,h=72){
  ctx.fillStyle='#ded9cb';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#6d6156';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);
  const c=['#e0bd55','#78afc2','#d48478','#86a66e'];let n=0;
  for(let yy=0;yy<2;yy++)for(let xx=0;xx<4;xx++){ctx.fillStyle=c[n++%c.length];ctx.fillRect(x+13+xx*29,y+14+yy*27,21,17)}
}
function drawWorld(ctx:CanvasRenderingContext2D,time:number,images?:Map<string,HTMLImageElement>){
  ctx.fillStyle=COLORS.floor;ctx.fillRect(0,0,WORLD_W,WORLD_H);
  ctx.strokeStyle=COLORS.line;ctx.lineWidth=1;
  for(let x=0;x<=WORLD_W;x+=TILE){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,WORLD_H);ctx.stroke()}
  for(let y=0;y<=WORLD_H;y+=TILE){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(WORLD_W,y);ctx.stroke()}

  room(ctx,18,18,340,220,COLORS.room,'Project Room');
  room(ctx,380,18,240,220,COLORS.roomCool,'Design');
  room(ctx,1045,18,190,220,COLORS.roomBlue,'Infra');
  room(ctx,1250,18,410,220,COLORS.roomCool,'Meeting');
  room(ctx,18,708,340,252,COLORS.roomGreen,'Café');
  room(ctx,380,708,240,252,'#c5cdbd','Library');
  room(ctx,642,708,205,252,'#c6ccc0','Focus');
  room(ctx,870,708,330,252,'#c5c9d1','Sprint');
  room(ctx,1222,650,438,310,COLORS.roomRose,'Lounge');
  room(ctx,18,265,270,185,'#c8d1c7','Reception');
  room(ctx,18,470,270,215,'#c8c3b7','Phone booths');

  ctx.fillStyle='rgba(88,119,129,.08)';ctx.fillRect(310,265,880,420);
  ctx.fillStyle='rgba(38,57,66,.38)';ctx.font='700 13px ui-monospace,monospace';ctx.fillText('MAIN OPERATIONS FLOOR',690,660);

  board(ctx,53,67,240,95);board(ctx,415,76,170,68);
  server(ctx,1074,62,142,time,0);server(ctx,1132,62,142,time,1);
  roundTable(ctx,1458,112,60);
  for(const p of [{x:1320,y:50},{x:1590,y:50},{x:310,y:246},{x:1206,y:246},{x:1188,y:670},{x:350,y:690},{x:840,y:690}])plant(ctx,p.x,p.y);

  ctx.fillStyle='#7a6654';ctx.fillRect(55,337,165,40);ctx.fillStyle='#b69e8a';ctx.fillRect(63,342,149,12);
  ctx.fillStyle=COLORS.screen;ctx.fillRect(112,304,55,33);ctx.fillStyle=COLORS.cyan;ctx.fillRect(122,315,34,3);

  ctx.fillStyle='#b4c5c7';
  for(let i=0;i<3;i++){ctx.fillRect(50+i*66,520,52,86);ctx.strokeStyle='#526a73';ctx.strokeRect(50+i*66,520,52,86);ctx.fillStyle='#607a82';ctx.fillRect(64+i*66,535,24,43);ctx.fillStyle='#b4c5c7'}

  ctx.fillStyle='#1d3c4c';ctx.fillRect(430,315,120,110);ctx.fillStyle=COLORS.cyan;
  for(let i=0;i<4;i++)ctx.fillRect(447,336+i*18,85-i*8,4);

  for(const [x,y] of [[520,350],[520,525],[770,350],[770,525]]){desk(ctx,x,y,205)}
  ctx.fillStyle='rgba(80,110,121,.3)';ctx.fillRect(735,300,4,300);
  board(ctx,880,586,150,72);

  ctx.fillStyle='#718e88';ctx.fillRect(47,775,255,45);ctx.fillStyle='#9fb7b2';ctx.fillRect(47,730,80,85);
  ctx.fillStyle='#263f4a';ctx.fillRect(208,746,49,58);ctx.fillStyle=COLORS.cyan;ctx.fillRect(216,756,32,9);
  roundTable(ctx,292,874,34);

  ctx.fillStyle='#725b43';ctx.fillRect(408,758,75,172);ctx.fillRect(503,758,75,172);
  const books=['#4a7e82','#c19254','#83515d','#5b7193'];let b=0;
  for(const bx of [420,515])for(let yy=780;yy<900;yy+=34)for(let xx=0;xx<4;xx++){ctx.fillStyle=books[b++%books.length];ctx.fillRect(bx+xx*13,yy,9,22)}

  for(const x of [666,735,806]){ctx.fillStyle='#b3c4c6';ctx.fillRect(x,765,45,92);ctx.strokeStyle='#506871';ctx.strokeRect(x,765,45,92);ctx.fillStyle='#5f7982';ctx.fillRect(x+11,781,23,48)}

  board(ctx,902,755,105,62);roundTable(ctx,1080,838,45);sofa(ctx,1010,895,120);

  sofa(ctx,1262,760,150);sofa(ctx,1440,760,150);roundTable(ctx,1420,858,34);ctx.fillStyle='#725a43';ctx.fillRect(1570,675,58,115);

  ctx.fillStyle='rgba(255,255,255,.08)';
  for(let x=340;x<1180;x+=55)for(let y=280;y<650;y+=55)ctx.fillRect(x,y,2,2);

  if(images){
    const decor=images.get('scene:decor'),cabinets=images.get('scene:cabinets');
    cropAsset(ctx,cabinets,0,0,48,64,410,754,.95);
    cropAsset(ctx,cabinets,0,0,48,64,503,754,.95);
    cropAsset(ctx,cabinets,0,0,48,64,1558,680,.72);
    for(const [x,y,small] of [[305,225,false],[1190,224,false],[838,674,true],[350,676,true],[1602,250,false],[1204,632,true]] as Array<[number,number,boolean]>){
      cropAsset(ctx,decor,small?32:48,48,16,32,x,y,small?1.05:1.28);
    }
    cropAsset(ctx,decor,0,0,16,48,1228,694,1.15);
    cropAsset(ctx,decor,96,48,48,32,70,33,1.15);
    cropAsset(ctx,decor,96,48,48,32,1275,34,1.15);
    cropAsset(ctx,decor,0,96,16,16,330,34,1.2);
  }
}
function drawAgent(ctx:CanvasRenderingContext2D,agent:RoomAgentView,rt:RuntimeAgent,img:HTMLImageElement|undefined,time:number,selected:boolean,singleSprite=false){
  const working=isWorking(agent.state),walking=Math.hypot(rt.tx-rt.x,rt.ty-rt.y)>3;
  const bob=walking?Math.sin(time/95+rt.phase)*3:working?Math.sin(time/180+rt.phase)*1.5:Math.sin(time/420+rt.phase)*.8;
  ctx.save();ctx.translate(rt.x,rt.y+bob);

  ctx.globalAlpha=agent.state==='offline'?.42:agent.state==='paused'?.62:1;
  ctx.fillStyle='rgba(13,24,28,.28)';ctx.beginPath();ctx.ellipse(0,15,16,7,0,0,Math.PI*2);ctx.fill();

  if(selected){ctx.strokeStyle='#69d4e7';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,14,24,12,0,0,Math.PI*2);ctx.stroke()}

  if(img?.complete&&img.naturalWidth){
    ctx.imageSmoothingEnabled=false;
    if(singleSprite){
      const targetH=working&&!walking?64:70;
      const scale=targetH/img.naturalHeight;
      const targetW=img.naturalWidth*scale;
      ctx.drawImage(img,-targetW/2,-targetH+14,targetW,targetH);
    }else{
      const frames=Math.max(1,Math.floor(img.naturalWidth/32));
      const frame=walking?Math.floor(time/110+rt.phase)%Math.min(frames,6):Math.floor(time/420+rt.phase)%Math.min(frames,6);
      ctx.drawImage(img,frame*32,0,32,32,-24,-42,48,48);
    }
  }else{
    ctx.fillStyle='#385e78';ctx.fillRect(-12,-29,24,32);ctx.fillStyle='#d3b18d';ctx.beginPath();ctx.arc(0,-35,10,0,Math.PI*2);ctx.fill();
  }

  const name=agent.name.length>18?agent.name.slice(0,16)+'…':agent.name;
  ctx.font='700 11px Inter,system-ui,sans-serif';const tw=Math.max(76,ctx.measureText(name).width+26);
  roundedRect(ctx,-tw/2,22,tw,26,7);ctx.fillStyle='rgba(9,22,29,.88)';ctx.fill();ctx.strokeStyle='rgba(130,177,196,.26)';ctx.stroke();
  ctx.fillStyle=statusColor(agent.state);ctx.beginPath();ctx.arc(-tw/2+10,35,4,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#ecf7fb';ctx.textAlign='center';ctx.fillText(name,4,39);

  const showBubble=working||agent.state==='error'||agent.state==='blocked'||time<rt.bubbleUntil;
  if(showBubble&&agent.activity){
    ctx.font='600 10px Inter,system-ui,sans-serif';const text=agent.activity.length>34?agent.activity.slice(0,32)+'…':agent.activity;
    const bw=Math.min(220,Math.max(92,ctx.measureText(text).width+26));
    roundedRect(ctx,-bw/2,-78,bw,28,8);ctx.fillStyle='rgba(248,250,246,.95)';ctx.fill();ctx.strokeStyle='rgba(36,62,70,.24)';ctx.stroke();
    ctx.fillStyle='#243940';ctx.fillText(text,0,-60);
    ctx.beginPath();ctx.moveTo(-6,-50);ctx.lineTo(3,-44);ctx.lineTo(7,-50);ctx.fillStyle='rgba(248,250,246,.95)';ctx.fill();
  }

  if(working){
    const p=.5+.5*Math.sin(time/250+rt.phase);ctx.strokeStyle='rgba(99,217,158,'+(0.18+p*.3)+')';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,-20,26+p*3,0,Math.PI*2);ctx.stroke();
  }
  ctx.restore();
}

export function OfficeGameCanvas({agents,onSelect,lastHandoff}:Props){
  const canvasRef=useRef<HTMLCanvasElement|null>(null);
  const miniRef=useRef<HTMLCanvasElement|null>(null);
  const viewportRef=useRef<HTMLDivElement|null>(null);
  const entitiesRef=useRef(new Map<string,RuntimeAgent>());
  const cameraRef=useRef<Camera>({x:0,y:0,zoom:.7});
  const dragRef=useRef<{id:number;x:number;y:number;cx:number;cy:number}|null>(null);
  const [zoom,setZoom]=useState(.7);
  const [dragging,setDragging]=useState(false);
  const [ready,setReady]=useState(false);
  const imagesRef=useRef(new Map<string,HTMLImageElement>());
  const licensedRuntimeRef=useRef<LicensedDevelopmentRuntime|null>(null);
  const [v3Ready,setV3Ready]=useState(false);

  const positioned=useMemo(()=>{
    const count:Record<StationKind,number>={development:0,research:0,lead:0,operations:0};
    return agents.map((agent,index)=>{
      const stationIndex=count[agent.station]++;
      const v3Home=v3Ready&&agent.station==='development'
        ? DEVELOPMENT_V3_WORKSTATIONS[stationIndex%DEVELOPMENT_V3_WORKSTATIONS.length]
        : null;
      const home=v3Home?{x:v3Home.agentX,y:v3Home.agentY}:stationPosition(agent,stationIndex);
      return{agent,pos:behaviorPosition(agent,home,index,v3Ready)};
    });
  },[agents,v3Ready]);

  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{
      try{
        let data:{assets?:AssetRecord[]}|null=null;
        try{
          data=await api.getRoomAssetRegistry() as {assets?:AssetRecord[]};
        }catch{
          const response=await fetch('/office-assets/licensed/registry.json',{cache:'no-store'});
          if(response.ok)data=await response.json() as {assets?:AssetRecord[]};
        }
        if(!data)return;
        const registry=new Map<string,AssetRecord>((data.assets??[]).map(asset=>[asset.id,asset]));
        const gate=validateDevelopmentV3Registry(registry);
        if(!gate.ok)return;
        const images=new Map<string,HTMLImageElement>();
        const ids=requiredDevelopmentV3AssetIds();
        let loaded=0;
        await Promise.all(ids.map(id=>new Promise<void>(resolve=>{
          const asset=registry.get(id);if(!asset){resolve();return}
          const img=new Image();images.set(id,img);
          img.onload=()=>{loaded++;resolve()};img.onerror=()=>resolve();img.src=asset.runtime.uri;
        })));
        if(cancelled||loaded!==ids.length)return;
        licensedRuntimeRef.current={registry,images};
        setV3Ready(true);
      }catch{
        // Licensed art is optional in public-source builds and loaded from app data in desktop runtime.
      }
    };
    void load();
    return()=>{cancelled=true};
  },[]);

  useEffect(()=>{
    const map=imagesRef.current;let pending=0;
    const queue:Array<[string,string]>=[
      ...(Object.entries(SPRITES) as Array<[StationKind,string]>).map(([kind,url])=>[kind,url] as [string,string]),
      ...Object.entries(SCENE_ASSETS).map(([key,url])=>['scene:'+key,url] as [string,string]),
    ];
    for(const [key,url] of queue){
      if(map.has(key))continue;pending++;const img=new Image();img.src=url;img.onload=()=>{pending--;if(pending<=0)setReady(true)};img.onerror=()=>{pending--;if(pending<=0)setReady(true)};map.set(key,img);
    }
    if(pending===0)setReady(true);
  },[]);

  useEffect(()=>{
    const now=performance.now();
    const map=entitiesRef.current;
    for(const {agent,pos} of positioned){
      const existing=map.get(agent.id);
      if(!existing){
        const seed=hash(agent.id);const spawn={x:330+(seed%140),y:625+((seed>>>8)%35)};
        map.set(agent.id,{id:agent.id,x:spawn.x,y:spawn.y,tx:pos.x,ty:pos.y,vx:0,vy:0,frame:0,phase:(seed%1000)/100,bubbleUntil:now+2400,previousActivity:agent.activity,spawnDone:false});
      }else{
        existing.tx=pos.x;existing.ty=pos.y;
        if(existing.previousActivity!==agent.activity){existing.previousActivity=agent.activity;existing.bubbleUntil=now+2400}
      }
    }
    for(const id of [...map.keys()])if(!positioned.some(x=>x.agent.id===id))map.delete(id);
  },[positioned]);

  const fit=()=>{
    const el=viewportRef.current;if(!el)return;const r=el.getBoundingClientRect();
    if(v3Ready){
      const b=DEVELOPMENT_V3_BOUNDS;
      const z=clamp(Math.min((r.width-54)/b.width,(r.height-54)/b.height),.62,1.16);
      cameraRef.current={x:r.width/2-(b.x+b.width/2)*z,y:r.height/2-(b.y+b.height/2)*z,zoom:z};setZoom(z);return;
    }
    const z=clamp(Math.min((r.width-28)/WORLD_W,(r.height-28)/WORLD_H),MIN_ZOOM,1);
    cameraRef.current={x:(r.width-WORLD_W*z)/2,y:(r.height-WORLD_H*z)/2,zoom:z};setZoom(z);
  };
  useEffect(()=>{const el=viewportRef.current;if(!el)return;const ro=new ResizeObserver(fit);ro.observe(el);fit();return()=>ro.disconnect()},[v3Ready]);

  const constrain=(camera:Camera)=>{
    const el=viewportRef.current;if(!el)return camera;const r=el.getBoundingClientRect(),margin=100;
    const sw=WORLD_W*camera.zoom,sh=WORLD_H*camera.zoom;
    return{...camera,x:sw<=r.width?(r.width-sw)/2:clamp(camera.x,r.width-sw-margin,margin),y:sh<=r.height?(r.height-sh)/2:clamp(camera.y,r.height-sh-margin,margin)};
  };
  const zoomAt=(next:number,clientX?:number,clientY?:number)=>{
    const el=viewportRef.current;if(!el)return;const r=el.getBoundingClientRect(),current=cameraRef.current,z=clamp(next,MIN_ZOOM,MAX_ZOOM);
    const px=(clientX??r.left+r.width/2)-r.left,py=(clientY??r.top+r.height/2)-r.top,wx=(px-current.x)/current.zoom,wy=(py-current.y)/current.zoom;
    cameraRef.current=constrain({zoom:z,x:px-wx*z,y:py-wy*z});setZoom(z);
  };

  useEffect(()=>{
    const canvas=canvasRef.current,mini=miniRef.current,viewport=viewportRef.current;if(!canvas||!mini||!viewport)return;
    let raf=0,last=performance.now();
    const render=(time:number)=>{
      const rect=viewport.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
      const w=Math.max(1,Math.floor(rect.width*dpr)),h=Math.max(1,Math.floor(rect.height*dpr));
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
      const ctx=canvas.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);ctx.imageSmoothingEnabled=false;
      const dt=Math.min(.05,(time-last)/1000);last=time;
      const camera=cameraRef.current;ctx.save();ctx.translate(camera.x,camera.y);ctx.scale(camera.zoom,camera.zoom);
      const licensed=licensedRuntimeRef.current;
      if(v3Ready&&licensed)drawDevelopmentV3Back(ctx,licensed,time);
      else drawWorld(ctx,time,imagesRef.current);

      const byId=new Map(positioned.map(x=>[x.agent.id,x.agent]));
      for(const rt of entitiesRef.current.values()){
        const agent=byId.get(rt.id);if(!agent)continue;
        const dx=rt.tx-rt.x,dy=rt.ty-rt.y,dist=Math.hypot(dx,dy);
        if(dist>1){const speed=agent.state==='offline'?80:190;const step=Math.min(dist,speed*dt);rt.x+=dx/dist*step;rt.y+=dy/dist*step;if(dist<5)rt.spawnDone=true}
        let agentImage=imagesRef.current.get(agent.station),singleSprite=false;
        if(v3Ready&&licensed&&agent.station==='development'){
          const sprite=DEVELOPMENT_V3_AGENT_SPRITES[hash(agent.id)%DEVELOPMENT_V3_AGENT_SPRITES.length];
          const spriteId=isWorking(agent.state)?sprite.working:sprite.idle;
          agentImage=licensed.images.get(spriteId)??agentImage;
          singleSprite=Boolean(licensed.images.get(spriteId));
        }
        drawAgent(ctx,agent,rt,agentImage,time,agent.selected,singleSprite);
      }
      if(v3Ready&&licensed)drawDevelopmentV3Front(ctx,licensed,time);

      if(lastHandoff){
        const from=positioned.find(x=>x.agent.name===lastHandoff.from||x.agent.id===lastHandoff.from);
        const to=positioned.find(x=>x.agent.name===lastHandoff.to||x.agent.id===lastHandoff.to);
        if(from&&to){const a=entitiesRef.current.get(from.agent.id),b=entitiesRef.current.get(to.agent.id);if(a&&b){ctx.strokeStyle='rgba(105,212,231,.68)';ctx.lineWidth=3;ctx.setLineDash([10,8]);ctx.beginPath();ctx.moveTo(a.x,a.y-18);ctx.lineTo(b.x,b.y-18);ctx.stroke();ctx.setLineDash([])}}
      }
      ctx.restore();

      const mdpr=Math.min(devicePixelRatio||1,2),mw=172,mh=100;
      if(mini.width!==Math.floor(mw*mdpr)||mini.height!==Math.floor(mh*mdpr)){mini.width=Math.floor(mw*mdpr);mini.height=Math.floor(mh*mdpr)}
      const m=mini.getContext('2d');if(m){m.setTransform(mdpr,0,0,mdpr,0,0);m.clearRect(0,0,mw,mh);m.save();m.scale(mw/WORLD_W,mh/WORLD_H);if(v3Ready&&licensed)drawDevelopmentV3Mini(m,licensed,time);else drawWorld(m,time,imagesRef.current);for(const rt of entitiesRef.current.values()){m.fillStyle='#173c4d';m.fillRect(rt.x-7,rt.y-7,14,14)}m.restore();const vw=rect.width/camera.zoom/WORLD_W*mw,vh=rect.height/camera.zoom/WORLD_H*mh,vx=(-camera.x/camera.zoom)/WORLD_W*mw,vy=(-camera.y/camera.zoom)/WORLD_H*mh;m.strokeStyle='rgba(236,248,251,.82)';m.lineWidth=1.5;m.strokeRect(clamp(vx,0,mw),clamp(vy,0,mh),Math.min(vw,mw),Math.min(vh,mh))}
      raf=requestAnimationFrame(render);
    };
    raf=requestAnimationFrame(render);return()=>cancelAnimationFrame(raf);
  },[positioned,lastHandoff,ready,v3Ready]);

  const hit=(clientX:number,clientY:number)=>{
    const el=viewportRef.current;if(!el)return null;const r=el.getBoundingClientRect(),c=cameraRef.current,wx=(clientX-r.left-c.x)/c.zoom,wy=(clientY-r.top-c.y)/c.zoom;
    let best:{agent:RoomAgentView;d:number}|null=null;
    for(const {agent} of positioned){const rt=entitiesRef.current.get(agent.id);if(!rt)continue;const d=Math.hypot(wx-rt.x,wy-(rt.y-12));if(d<36&&(!best||d<best.d))best={agent,d}}
    return best?.agent??null;
  };
  const pointerDown=(event:React.PointerEvent<HTMLDivElement>)=>{if((event.target as HTMLElement).closest('.room-game-controls,.room-game-minimap'))return;const picked=hit(event.clientX,event.clientY);if(picked){onSelect(picked);return}const c=cameraRef.current;dragRef.current={id:event.pointerId,x:event.clientX,y:event.clientY,cx:c.x,cy:c.y};event.currentTarget.setPointerCapture(event.pointerId);setDragging(true)};
  const pointerMove=(event:React.PointerEvent<HTMLDivElement>)=>{const d=dragRef.current;if(!d||d.id!==event.pointerId)return;cameraRef.current=constrain({...cameraRef.current,x:d.cx+(event.clientX-d.x),y:d.cy+(event.clientY-d.y)})};
  const pointerUp=(event:React.PointerEvent<HTMLDivElement>)=>{if(dragRef.current?.id===event.pointerId)dragRef.current=null;setDragging(false)};
  const keyDown=(event:React.KeyboardEvent<HTMLDivElement>)=>{const c=cameraRef.current,step=event.shiftKey?110:55;let next=c;if(event.key==='+'||event.key==='='){event.preventDefault();zoomAt(c.zoom*1.14);return}if(event.key==='-'){event.preventDefault();zoomAt(c.zoom/1.14);return}if(event.key==='0'){event.preventDefault();fit();return}if(event.key==='ArrowLeft'||event.key.toLowerCase()==='a')next={...c,x:c.x+step};else if(event.key==='ArrowRight'||event.key.toLowerCase()==='d')next={...c,x:c.x-step};else if(event.key==='ArrowUp'||event.key.toLowerCase()==='w')next={...c,y:c.y+step};else if(event.key==='ArrowDown'||event.key.toLowerCase()==='s')next={...c,y:c.y-step};else return;event.preventDefault();cameraRef.current=constrain(next)};

  return <div ref={viewportRef} className={'room-game-shell'+(dragging?' dragging':'')} tabIndex={0} onKeyDown={keyDown} onWheel={event=>{event.preventDefault();zoomAt(cameraRef.current.zoom*(event.deltaY>0 ? .9 : 1.1),event.clientX,event.clientY)}} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
    <canvas ref={canvasRef} className="room-game-canvas" aria-label="Sala 2D operacional"/>
    <div className="room-game-controls" onPointerDown={event=>event.stopPropagation()}>
      <button type="button" onClick={()=>zoomAt(cameraRef.current.zoom/1.16)} aria-label="Afastar">−</button>
      <span>{Math.round(zoom*100)}%</span>
      <button type="button" onClick={()=>zoomAt(cameraRef.current.zoom*1.16)} aria-label="Aproximar">+</button>
      <i/>
      <button type="button" className="wide" onClick={fit}>Visão geral</button>
    </div>
    <div className="room-game-minimap" onPointerDown={event=>event.stopPropagation()}>
      <canvas ref={miniRef}/>
    </div>
    <div className="room-game-hint">Arraste ou use WASD/setas · Scroll para zoom · Clique em um Agent para selecionar</div>
    <div className="room-game-a11y" aria-live="polite">
      {agents.map(agent=><button key={agent.id} type="button" disabled={agent.disabled} onClick={()=>onSelect(agent)}>{agent.name} · {agent.state} · {agent.activity}</button>)}
      {lastHandoff&&<span>Handoff: {lastHandoff.from} para {lastHandoff.to}</span>}
    </div>
    {!ready&&<div className="room-game-loading">Preparando sala…</div>}
  </div>;
}
