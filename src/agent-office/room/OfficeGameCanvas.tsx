import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomAgentView, StationKind } from './roomTypes.js';
import './room-game.css';

const WORLD_W=1680;
const WORLD_H=980;
const MIN_ZOOM=.58;
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
  development:[{x:650,y:372},{x:820,y:372},{x:990,y:372},{x:650,y:540},{x:820,y:540},{x:990,y:540}],
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
function behaviorPosition(agent:RoomAgentView,home:Vec,index:number):Vec{
  const lane=(hash(agent.id)%5)-2;
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
function board(ctx:CanvasRenderingContext2D,x:number,y:number,w=140,h=72){
  ctx.fillStyle='#ded9cb';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#6d6156';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);
  const c=['#e0bd55','#78afc2','#d48478','#86a66e'];let n=0;
  for(let yy=0;yy<2;yy++)for(let xx=0;xx<4;xx++){ctx.fillStyle=c[n++%c.length];ctx.fillRect(x+13+xx*29,y+14+yy*27,21,17)}
}
function drawWorld(ctx:CanvasRenderingContext2D,time:number,images?:Map<string,HTMLImageElement>){
  const pulse=.5+.5*Math.sin(time/550);
  // Zero-cost vertical slice: one dense, premium Development studio using only
  // our CC0 sheets plus Canvas lighting. This intentionally replaces the old
  // full-office schematic while we validate the final art language.
  const x=330,y=125,w=980,h=660;
  ctx.fillStyle='#08141d';ctx.fillRect(0,0,WORLD_W,WORLD_H);
  ctx.fillStyle='#0d2230';ctx.fillRect(190,55,1300,820);

  // corridor / shell
  ctx.fillStyle='#142b38';ctx.fillRect(x-28,y-28,w+56,h+56);
  ctx.fillStyle='#203b49';ctx.fillRect(x-18,y-18,w+36,h+36);
  ctx.fillStyle='#b89f7d';ctx.fillRect(x,y,w,h);

  // warm plank floor
  for(let yy=y;yy<y+h;yy+=26){
    for(let xx=x;xx<x+w;xx+=104){
      const off=((yy-y)/26)%2?52:0;
      ctx.fillStyle=((xx+yy)/26)%2?'#bda786':'#c6b08d';
      ctx.fillRect(xx-off,yy,102,24);
    }
  }

  // dark architectural walls + glass frontage
  ctx.fillStyle='#102633';ctx.fillRect(x,y,w,24);ctx.fillRect(x,y,22,h);ctx.fillRect(x+w-22,y,22,h);
  ctx.fillStyle='#173747';ctx.fillRect(x+22,y+24,w-44,10);
  ctx.fillStyle='rgba(102,200,222,.18)';ctx.fillRect(x+48,y+34,w-96,5);
  ctx.strokeStyle='rgba(117,210,231,.35)';ctx.lineWidth=2;
  for(let gx=x+55;gx<x+w-55;gx+=115){ctx.beginPath();ctx.moveTo(gx,y+34);ctx.lineTo(gx,y+112);ctx.stroke()}
  ctx.fillStyle='rgba(11,28,38,.72)';ctx.fillRect(x+40,y+46,258,54);
  ctx.fillStyle='#dff7ff';ctx.font='800 22px Inter,system-ui,sans-serif';ctx.fillText('</>  DEVELOPMENT',x+62,y+80);
  ctx.fillStyle=`rgba(99,207,228,${.65+pulse*.35})`;ctx.fillRect(x+40,y+99,258,3);

  // carpeted work pod
  ctx.fillStyle='#315d63';ctx.fillRect(x+145,y+180,670,365);
  ctx.fillStyle='rgba(7,24,31,.16)';
  for(let yy=y+194;yy<y+535;yy+=18)for(let xx=x+158;xx<x+800;xx+=18)ctx.fillRect(xx,yy,1,1);

  // back wall dashboard
  roundedRect(ctx,x+610,y+52,285,90,8);ctx.fillStyle='#102a39';ctx.fill();
  ctx.strokeStyle='rgba(92,201,226,.35)';ctx.stroke();
  ctx.fillStyle='#5fd3ea';ctx.fillRect(x+630,y+75,94,5);ctx.fillRect(x+630,y+91,145,4);
  ctx.fillStyle='#6fdda9';for(let i=0;i<7;i++)ctx.fillRect(x+800+i*10,y+112-(i%4)*8,6,16+(i%4)*8);

  // desks: richer pods, screens and warm task light
  const pods=[[x+190,y+270],[x+505,y+270],[x+190,y+438],[x+505,y+438]] as const;
  for(const [dx,dy] of pods){
    ctx.fillStyle='rgba(7,17,24,.25)';ctx.fillRect(dx+8,dy+22,270,55);
    ctx.fillStyle='#8b684b';ctx.fillRect(dx,dy,286,22);
    ctx.fillStyle='#b98b5f';ctx.fillRect(dx+6,dy+3,274,14);
    for(const mx of [dx+42,dx+172]){
      ctx.shadowColor='rgba(78,207,236,.45)';ctx.shadowBlur=18;
      ctx.fillStyle='#102d3c';ctx.fillRect(mx,dy-58,78,55);ctx.shadowBlur=0;
      ctx.strokeStyle='#547d8d';ctx.strokeRect(mx,dy-58,78,55);
      ctx.fillStyle='#59cfe8';ctx.fillRect(mx+10,dy-45,52,4);ctx.fillRect(mx+10,dy-32,37,3);
      ctx.fillStyle='#6fdca9';ctx.fillRect(mx+10,dy-20,24,3);
    }
    ctx.fillStyle='#263f4c';ctx.fillRect(dx+42,dy+33,44,30);ctx.fillRect(dx+172,dy+33,44,30);
  }

  // collaboration island
  roundTable(ctx,x+865,y+330,48);board(ctx,x+825,y+420,125,82);
  ctx.fillStyle='#193442';ctx.fillRect(x+842,y+150,108,84);
  ctx.fillStyle='#63cfe4';ctx.fillRect(x+857,y+168,76,5);ctx.fillStyle='#d9e9e6';ctx.fillRect(x+857,y+184,55,4);

  // planters / visual separators
  for(const p of [{x:x+115,y:y+190},{x:x+115,y:y+500},{x:x+835,y:y+540},{x:x+80,y:y+600},{x:x+905,y:y+590}])plant(ctx,p.x,p.y);
  ctx.fillStyle='#72553d';ctx.fillRect(x+448,y+190,34,350);
  for(let py=y+215;py<y+520;py+=58){ctx.fillStyle='#4c8d63';ctx.beginPath();ctx.arc(x+465,py,23,0,Math.PI*2);ctx.fill()}

  // lounge/review corner inside Development
  sofa(ctx,x+65,y+570,180);roundTable(ctx,x+285,y+615,30);
  ctx.fillStyle='rgba(16,39,51,.82)';ctx.fillRect(x+625,y+575,285,70);
  ctx.fillStyle='#b9d8df';ctx.font='700 12px Inter,system-ui,sans-serif';ctx.fillText('BUILD  •  TEST  •  REVIEW',x+650,y+602);
  ctx.fillStyle='#58cde6';ctx.fillRect(x+650,y+617,190,5);

  // CC0 sheets add real pixel detail over the composed scene.
  if(images){
    const decor=images.get('scene:decor'),cabinets=images.get('scene:cabinets');
    for(const [px,py] of [[x+55,y+145],[x+915,y+120],[x+920,y+520],[x+75,y+500],[x+770,y+145]] as const)
      cropAsset(ctx,decor,48,48,16,32,px,py,1.18);
    cropAsset(ctx,cabinets,0,0,48,64,x+35,y+250,.78);
    cropAsset(ctx,cabinets,0,0,48,64,x+890,y+250,.78);
  }

  // warm lamps + cyan tech light: the reference relies on both.
  ctx.save();ctx.globalCompositeOperation='screen';
  for(const [lx,ly] of [[x+72,y+128],[x+930,y+128],[x+90,y+555]] as const){
    const g=ctx.createRadialGradient(lx,ly,0,lx,ly,85);g.addColorStop(0,'rgba(255,188,92,.25)');g.addColorStop(1,'rgba(255,188,92,0)');
    ctx.fillStyle=g;ctx.fillRect(lx-85,ly-85,170,170);
  }
  const cg=ctx.createRadialGradient(x+490,y+350,20,x+490,y+350,390);cg.addColorStop(0,'rgba(47,182,214,.10)');cg.addColorStop(1,'rgba(47,182,214,0)');
  ctx.fillStyle=cg;ctx.fillRect(x+80,y+20,820,720);ctx.restore();

  // foreground glass gives depth when agents cross the lower edge.
  ctx.fillStyle='rgba(61,155,180,.10)';ctx.fillRect(x+255,y+h-14,470,14);
  ctx.strokeStyle='rgba(118,213,235,.32)';ctx.strokeRect(x+255,y+h-14,470,14);
}
function drawAgent(ctx:CanvasRenderingContext2D,agent:RoomAgentView,rt:RuntimeAgent,img:HTMLImageElement|undefined,time:number,selected:boolean){
  const working=isWorking(agent.state),walking=Math.hypot(rt.tx-rt.x,rt.ty-rt.y)>3;
  const bob=walking?Math.sin(time/95+rt.phase)*3:working?Math.sin(time/180+rt.phase)*1.5:Math.sin(time/420+rt.phase)*.8;
  ctx.save();ctx.translate(rt.x,rt.y+bob);

  ctx.globalAlpha=agent.state==='offline'?.42:agent.state==='paused'?.62:1;
  ctx.fillStyle='rgba(13,24,28,.28)';ctx.beginPath();ctx.ellipse(0,15,16,7,0,0,Math.PI*2);ctx.fill();

  if(selected){ctx.strokeStyle='#69d4e7';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,14,24,12,0,0,Math.PI*2);ctx.stroke()}

  if(img?.complete&&img.naturalWidth){
    const frames=Math.max(1,Math.floor(img.naturalWidth/32));
    const frame=walking?Math.floor(time/110+rt.phase)%Math.min(frames,6):Math.floor(time/420+rt.phase)%Math.min(frames,6);
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(img,frame*32,0,32,32,-24,-42,48,48);
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
    const z=clamp(Math.max(overview,.88),MIN_ZOOM,MAX_ZOOM);
    const focus={x:820,y:455};
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
