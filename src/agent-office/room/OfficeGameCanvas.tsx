import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomAgentView, StationKind } from './roomTypes.js';
import './room-game.css';

const WORLD_W=1680;
const WORLD_H=980;
const MIN_ZOOM=.58;
const MAX_ZOOM=1.9;

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
  development:[{x:595,y:392},{x:805,y:392},{x:1015,y:392},{x:595,y:555},{x:805,y:555},{x:1015,y:555}],
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
  desk:'/office-assets/v2/desk_front.png',
  pc:'/office-assets/v2/pc_front_on_1.png',
  chair:'/office-assets/v2/chair_back.png',
  plantLarge:'/office-assets/v2/plant_large.png',
  plant:'/office-assets/v2/plant.png',
  whiteboard:'/office-assets/v2/whiteboard.png',
  sofa:'/office-assets/v2/sofa_front.png',
  table:'/office-assets/v2/table_small_front.png',
  bookshelf:'/office-assets/v2/bookshelf_double.png',
  coffee:'/office-assets/v2/coffee.png',
  painting:'/office-assets/v2/painting_large.png',
  bin:'/office-assets/v2/bin.png',
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
function behaviorPosition(agent:RoomAgentView,home:Vec,index:number):Vec{
  const lane=(hash(agent.id)%5)-2;
  if(agent.state==='thinking'||agent.state==='planning')return{x:1180+lane*26,y:365+(index%2)*22};
  if(agent.state==='testing'||agent.state==='reviewing')return{x:1115+lane*28,y:665+(index%2)*22};
  if(agent.state==='waiting')return{x:430+lane*24,y:665+(index%2)*20};
  if(agent.state==='resting'||agent.state==='completed')return{x:515+lane*28,y:680+(index%2)*20};
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
function drawSprite(
  ctx:CanvasRenderingContext2D,
  img:HTMLImageElement|undefined,
  x:number,
  y:number,
  scale=1,
  anchorX=.5,
  anchorY=1,
  alpha=1,
){
  if(!img?.complete||!img.naturalWidth)return;
  const w=img.naturalWidth*scale,h=img.naturalHeight*scale;
  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(img,x-w*anchorX,y-h*anchorY,w,h);
  ctx.restore();
}
function spriteShadow(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number){
  ctx.save();
  ctx.fillStyle='rgba(5,15,21,.28)';
  ctx.beginPath();ctx.ellipse(x,y,w,h,0,0,Math.PI*2);ctx.fill();
  ctx.restore();
}
function techGlow(ctx:CanvasRenderingContext2D,x:number,y:number,r=55){
  ctx.save();ctx.globalCompositeOperation='screen';
  const g=ctx.createRadialGradient(x,y,0,x,y,r);
  g.addColorStop(0,'rgba(70,210,238,.22)');
  g.addColorStop(1,'rgba(70,210,238,0)');
  ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);ctx.restore();
}
function drawWorld(ctx:CanvasRenderingContext2D,time:number,images?:Map<string,HTMLImageElement>){
  const pulse=.5+.5*Math.sin(time/620);
  const x=300,y=92,w=1080,h=730;
  ctx.fillStyle='#07131d';ctx.fillRect(0,0,WORLD_W,WORLD_H);

  // Deep architectural shell.
  ctx.fillStyle='#0b202d';ctx.fillRect(x-42,y-42,w+84,h+84);
  ctx.fillStyle='#132e3d';ctx.fillRect(x-30,y-30,w+60,h+60);
  ctx.fillStyle='#1b4050';ctx.fillRect(x-20,y-20,w+40,h+40);

  // Warm floor, intentionally restrained so the actual furniture sprites dominate.
  ctx.fillStyle='#b89c76';ctx.fillRect(x,y,w,h);
  for(let yy=y;yy<y+h;yy+=28){
    for(let xx=x-56;xx<x+w;xx+=112){
      const off=((yy-y)/28)%2?56:0;
      ctx.fillStyle=((xx+yy)/28)%2?'#b49770':'#c1a47d';
      ctx.fillRect(xx+off,yy,110,26);
      ctx.strokeStyle='rgba(83,59,39,.09)';ctx.strokeRect(xx+off,yy,110,26);
    }
  }

  // Thick dark walls and upper glass line.
  ctx.fillStyle='#0d2634';ctx.fillRect(x,y,w,34);ctx.fillRect(x,y,28,h);ctx.fillRect(x+w-28,y,28,h);
  ctx.fillStyle='#173b4a';ctx.fillRect(x+28,y+34,w-56,12);
  ctx.fillStyle='rgba(81,191,218,.15)';ctx.fillRect(x+54,y+46,w-108,8);
  ctx.strokeStyle='rgba(106,214,237,.34)';ctx.lineWidth=2;
  for(let gx=x+68;gx<x+w-68;gx+=132){ctx.beginPath();ctx.moveTo(gx,y+46);ctx.lineTo(gx,y+132);ctx.stroke()}

  // Identity plaque and dashboard.
  roundedRect(ctx,x+52,y+62,282,62,9);ctx.fillStyle='rgba(7,25,35,.88)';ctx.fill();
  ctx.strokeStyle='rgba(94,207,231,.32)';ctx.stroke();
  ctx.fillStyle='#e6f7fb';ctx.font='800 22px Inter,system-ui,sans-serif';ctx.fillText('</>  DEVELOPMENT',x+74,y+101);
  ctx.fillStyle=`rgba(95,215,239,${.58+pulse*.36})`;ctx.fillRect(x+52,y+122,282,4);

  roundedRect(ctx,x+690,y+58,295,100,10);ctx.fillStyle='rgba(9,31,43,.92)';ctx.fill();
  ctx.strokeStyle='rgba(91,194,219,.3)';ctx.stroke();
  ctx.fillStyle='#6ed8ec';ctx.fillRect(x+716,y+84,92,5);ctx.fillRect(x+716,y+101,156,4);
  ctx.fillStyle='#6fdda9';
  for(let i=0;i<8;i++)ctx.fillRect(x+868+i*11,y+132-(i%5)*8,7,20+(i%5)*8);

  // Main rug and subtle zone separation.
  roundedRect(ctx,x+145,y+190,720,385,16);ctx.fillStyle='#285a61';ctx.fill();
  ctx.strokeStyle='rgba(84,183,193,.25)';ctx.stroke();
  ctx.fillStyle='rgba(8,28,34,.12)';
  for(let yy=y+210;yy<y+555;yy+=22)for(let xx=x+165;xx<x+845;xx+=22)ctx.fillRect(xx,yy,2,2);

  if(images){
    const desk=images.get('scene:desk'),pc=images.get('scene:pc'),chair=images.get('scene:chair');
    const plantLarge=images.get('scene:plantLarge'),plant=images.get('scene:plant');
    const whiteboard=images.get('scene:whiteboard'),sofa=images.get('scene:sofa');
    const table=images.get('scene:table'),bookshelf=images.get('scene:bookshelf');
    const coffee=images.get('scene:coffee'),painting=images.get('scene:painting'),bin=images.get('scene:bin');

    // Six real sprite-based workstations.
    const seats=[
      {x:x+295,y:y+335},{x:x+505,y:y+335},{x:x+715,y:y+335},
      {x:x+295,y:y+500},{x:x+505,y:y+500},{x:x+715,y:y+500},
    ];
    for(const [i,s] of seats.entries()){
      spriteShadow(ctx,s.x,s.y+16,70,16);
      techGlow(ctx,s.x,s.y-72,48);
      drawSprite(ctx,desk,s.x,s.y,3.25,.5,1);
      drawSprite(ctx,pc,s.x,s.y-54,3.05,.5,1);
      drawSprite(ctx,chair,s.x,s.y+42,2.75,.5,1);
      if(i%2===0)drawSprite(ctx,coffee,s.x+62,s.y-15,2.25,.5,1,.95);
    }

    // Vertical green separator and perimeter vegetation.
    for(const py of [y+250,y+340,y+430,y+520])drawSprite(ctx,plant,x+515,py,2.75,.5,1);
    drawSprite(ctx,plantLarge,x+112,y+255,3.15,.5,1);
    drawSprite(ctx,plantLarge,x+925,y+555,3.15,.5,1);
    drawSprite(ctx,plant,x+116,y+550,2.7,.5,1);
    drawSprite(ctx,plant,x+908,y+205,2.7,.5,1);

    // Collaboration / review side.
    drawSprite(ctx,whiteboard,x+936,y+438,3.45,.5,1);
    drawSprite(ctx,table,x+930,y+350,3.2,.5,1);
    drawSprite(ctx,plant,x+1002,y+366,2.45,.5,1);
    drawSprite(ctx,bin,x+1015,y+480,2.5,.5,1);

    // Lounge corner and storage.
    drawSprite(ctx,sofa,x+178,y+675,4.0,.5,1);
    drawSprite(ctx,table,x+330,y+690,3.05,.5,1);
    drawSprite(ctx,bookshelf,x+70,y+690,3.15,.5,1);
    drawSprite(ctx,painting,x+1015,y+215,3.0,.5,1);
  }

  // Review status panel and warm/cool light pools.
  roundedRect(ctx,x+640,y+625,300,76,8);ctx.fillStyle='rgba(8,32,43,.9)';ctx.fill();
  ctx.fillStyle='#c8e6eb';ctx.font='700 12px Inter,system-ui,sans-serif';ctx.fillText('BUILD   •   TEST   •   REVIEW',x+665,y+654);
  ctx.fillStyle='#5bd1e8';ctx.fillRect(x+665,y+671,190,5);

  ctx.save();ctx.globalCompositeOperation='screen';
  for(const [lx,ly] of [[x+95,y+160],[x+1010,y+165],[x+155,y+620]] as const){
    const g=ctx.createRadialGradient(lx,ly,0,lx,ly,105);
    g.addColorStop(0,'rgba(255,188,91,.22)');g.addColorStop(1,'rgba(255,188,91,0)');
    ctx.fillStyle=g;ctx.fillRect(lx-105,ly-105,210,210);
  }
  const cg=ctx.createRadialGradient(x+520,y+390,20,x+520,y+390,430);
  cg.addColorStop(0,'rgba(50,192,222,.09)');cg.addColorStop(1,'rgba(50,192,222,0)');
  ctx.fillStyle=cg;ctx.fillRect(x+70,y+80,900,680);ctx.restore();

  // Lower glass facade.
  ctx.fillStyle='rgba(50,144,170,.10)';ctx.fillRect(x+310,y+h-20,460,20);
  ctx.strokeStyle='rgba(112,211,235,.34)';ctx.strokeRect(x+310,y+h-20,460,20);
}
function drawForeground(ctx:CanvasRenderingContext2D,images?:Map<string,HTMLImageElement>){
  if(!images)return;
  const x=300,y=92,h=730;
  const plant=images.get('scene:plant');
  // A few foreground sprites intentionally occlude agents to create real depth.
  drawSprite(ctx,plant,x+485,y+h-6,3.0,.5,1,.98);
  drawSprite(ctx,plant,x+790,y+h-7,3.0,.5,1,.98);
  ctx.fillStyle='rgba(42,139,165,.08)';ctx.fillRect(x+310,y+h-19,460,19);
}
function drawAgent(ctx:CanvasRenderingContext2D,agent:RoomAgentView,rt:RuntimeAgent,img:HTMLImageElement|undefined,time:number,selected:boolean){
  const working=isWorking(agent.state),walking=Math.hypot(rt.tx-rt.x,rt.ty-rt.y)>3;
  const bob=walking?Math.sin(time/95+rt.phase)*3:working?Math.sin(time/180+rt.phase)*1.5:Math.sin(time/420+rt.phase)*.8;
  ctx.save();ctx.translate(rt.x,rt.y+bob);

  ctx.globalAlpha=agent.state==='offline'?.42:agent.state==='paused'?.62:1;
  ctx.fillStyle='rgba(13,24,28,.28)';ctx.beginPath();ctx.ellipse(0,17,18,8,0,0,Math.PI*2);ctx.fill();

  if(selected){ctx.strokeStyle='#69d4e7';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,16,27,13,0,0,Math.PI*2);ctx.stroke()}

  if(img?.complete&&img.naturalWidth){
    const frames=Math.max(1,Math.floor(img.naturalWidth/32));
    const frame=walking?Math.floor(time/110+rt.phase)%Math.min(frames,6):Math.floor(time/420+rt.phase)%Math.min(frames,6);
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(img,frame*32,0,32,32,-30,-52,60,60);
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

  const positioned=useMemo(()=>{
    const count:Record<StationKind,number>={development:0,research:0,lead:0,operations:0};
    return agents.map((agent,index)=>{
      const home=stationPosition(agent,count[agent.station]++);
      return{agent,pos:behaviorPosition(agent,home,index)};
    });
  },[agents]);

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
    const overview=clamp(Math.min((r.width-28)/WORLD_W,(r.height-28)/WORLD_H),MIN_ZOOM,1);
    const z=clamp(Math.max(overview,.98),MIN_ZOOM,MAX_ZOOM);
    const focus={x:835,y:462};
    cameraRef.current={x:r.width/2-focus.x*z,y:r.height/2-focus.y*z,zoom:z};setZoom(z);
  };
  useEffect(()=>{const el=viewportRef.current;if(!el)return;const ro=new ResizeObserver(fit);ro.observe(el);fit();return()=>ro.disconnect()},[]);

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
      drawWorld(ctx,time,imagesRef.current);

      const byId=new Map(positioned.map(x=>[x.agent.id,x.agent]));
      for(const rt of entitiesRef.current.values()){
        const agent=byId.get(rt.id);if(!agent)continue;
        const dx=rt.tx-rt.x,dy=rt.ty-rt.y,dist=Math.hypot(dx,dy);
        if(dist>1){const speed=agent.state==='offline'?80:190;const step=Math.min(dist,speed*dt);rt.x+=dx/dist*step;rt.y+=dy/dist*step;if(dist<5)rt.spawnDone=true}
        drawAgent(ctx,agent,rt,imagesRef.current.get(agent.station),time,agent.selected);
      }
      drawForeground(ctx,imagesRef.current);

      if(lastHandoff){
        const from=positioned.find(x=>x.agent.name===lastHandoff.from||x.agent.id===lastHandoff.from);
        const to=positioned.find(x=>x.agent.name===lastHandoff.to||x.agent.id===lastHandoff.to);
        if(from&&to){const a=entitiesRef.current.get(from.agent.id),b=entitiesRef.current.get(to.agent.id);if(a&&b){ctx.strokeStyle='rgba(105,212,231,.68)';ctx.lineWidth=3;ctx.setLineDash([10,8]);ctx.beginPath();ctx.moveTo(a.x,a.y-18);ctx.lineTo(b.x,b.y-18);ctx.stroke();ctx.setLineDash([])}}
      }
      ctx.restore();

      const mdpr=Math.min(devicePixelRatio||1,2),mw=172,mh=100;
      if(mini.width!==Math.floor(mw*mdpr)||mini.height!==Math.floor(mh*mdpr)){mini.width=Math.floor(mw*mdpr);mini.height=Math.floor(mh*mdpr)}
      const m=mini.getContext('2d');if(m){m.setTransform(mdpr,0,0,mdpr,0,0);m.clearRect(0,0,mw,mh);m.save();m.scale(mw/WORLD_W,mh/WORLD_H);drawWorld(m,time,imagesRef.current);for(const rt of entitiesRef.current.values()){m.fillStyle='#173c4d';m.fillRect(rt.x-7,rt.y-7,14,14)}m.restore();const vw=rect.width/camera.zoom/WORLD_W*mw,vh=rect.height/camera.zoom/WORLD_H*mh,vx=(-camera.x/camera.zoom)/WORLD_W*mw,vy=(-camera.y/camera.zoom)/WORLD_H*mh;m.strokeStyle='rgba(236,248,251,.82)';m.lineWidth=1.5;m.strokeRect(clamp(vx,0,mw),clamp(vy,0,mh),Math.min(vw,mw),Math.min(vh,mh))}
      raf=requestAnimationFrame(render);
    };
    raf=requestAnimationFrame(render);return()=>cancelAnimationFrame(raf);
  },[positioned,lastHandoff,ready]);

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
