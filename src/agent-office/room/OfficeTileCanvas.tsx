import { useEffect, useRef } from 'react';

type Rect={x:number;y:number;w:number;h:number};
const COLS=48,ROWS=28;
function drawRoom(ctx:CanvasRenderingContext2D,t:number,r:Rect,fill:string,label:string){
  ctx.fillStyle=fill;ctx.fillRect(r.x*t,r.y*t,r.w*t,r.h*t);
  ctx.strokeStyle='#38515d';ctx.lineWidth=Math.max(2,t*.18);ctx.strokeRect(r.x*t,r.y*t,r.w*t,r.h*t);
  ctx.fillStyle='rgba(24,44,52,.58)';ctx.font=`700 ${Math.max(7,t*.44)}px ui-monospace,monospace`;ctx.fillText(label.toUpperCase(),r.x*t+t*.55,r.y*t+t*.9);
}
function desk(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w=4){
  ctx.fillStyle='#6e5842';ctx.fillRect(x*t,y*t,w*t,.65*t);ctx.fillStyle='#3e342c';ctx.fillRect((x+.25)*t,(y+.62)*t,.28*t,.75*t);ctx.fillRect((x+w-.52)*t,(y+.62)*t,.28*t,.75*t);
  ctx.fillStyle='#173849';ctx.fillRect((x+1.1)*t,(y-.8)*t,1.2*t,.8*t);ctx.strokeStyle='#4b7285';ctx.strokeRect((x+1.1)*t,(y-.8)*t,1.2*t,.8*t);ctx.fillStyle='#54b7cb';ctx.fillRect((x+1.25)*t,(y-.58)*t,.9*t,.11*t);ctx.fillRect((x+1.25)*t,(y-.36)*t,.7*t,.1*t);
}
function plant(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){
  ctx.fillStyle='#6c4f3c';ctx.fillRect((x+.32)*t,(y+.62)*t,.5*t,.6*t);ctx.fillStyle='#4b8d61';for(const [dx,dy] of [[0,0],[.45,-.2],[.8,.05],[.4,.35]])ctx.beginPath(),ctx.arc((x+dx+.3)*t,(y+dy+.35)*t,.33*t,0,Math.PI*2),ctx.fill();
}
function sofa(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w=5){
  ctx.fillStyle='#4e6886';ctx.fillRect(x*t,y*t,w*t,1.4*t);ctx.fillStyle='#617d9f';for(let i=0;i<w;i+=1.65)ctx.fillRect((x+i+.08)*t,(y+.15)*t,1.45*t,1*t);ctx.fillStyle='#364c63';ctx.fillRect((x-.18)*t,(y+.28)*t,.35*t,1.1*t);ctx.fillRect((x+w-.17)*t,(y+.28)*t,.35*t,1.1*t);
}
function bookshelf(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w=3,h=4){
  ctx.fillStyle='#725b43';ctx.fillRect(x*t,y*t,w*t,h*t);
  const colors=['#4a7e82','#c19254','#83515d','#5b7193'];let n=0;
  for(let row=0;row<3;row++)for(let col=0;col<5;col++){ctx.fillStyle=colors[n++%colors.length];ctx.fillRect((x+.25+col*.52)*t,(y+.35+row*1.1)*t,.34*t,.72*t)}
}
function server(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,h=5){
  ctx.fillStyle='#203541';ctx.fillRect(x*t,y*t,1.8*t,h*t);ctx.strokeStyle='#496676';ctx.strokeRect(x*t,y*t,1.8*t,h*t);
  for(let i=0;i<6;i++){ctx.fillStyle='#17303d';ctx.fillRect((x+.2)*t,(y+.35+i*.7)*t,1.4*t,.45*t);ctx.fillStyle='#54d89d';ctx.fillRect((x+1.28)*t,(y+.5+i*.7)*t,.12*t,.12*t)}
}
function meeting(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){
  ctx.fillStyle='#7b624f';ctx.beginPath();ctx.ellipse((x+3)*t,(y+1.6)*t,3*t,1.4*t,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#2c4c5c';for(const [dx,dy] of [[-.2,1.2],[6.1,1.2],[2.1,-.2],[3.7,-.2],[2.1,3.1],[3.7,3.1]])ctx.fillRect((x+dx)*t,(y+dy)*t,.55*t,.8*t);
}
function coffee(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){
  ctx.fillStyle='#75908c';ctx.fillRect(x*t,(y+2.2)*t,5*t,1.1*t);ctx.fillStyle='#9eb5b1';ctx.fillRect(x*t,y*t,1.6*t,2.15*t);ctx.strokeStyle='#647c7c';ctx.strokeRect(x*t,y*t,1.6*t,2.15*t);ctx.fillStyle='#253f49';ctx.fillRect((x+3)*t,(y+.5)*t,1.25*t,1.3*t);ctx.fillStyle='#77c5ce';ctx.fillRect((x+3.25)*t,(y+.75)*t,.75*t,.35*t);
}
function draw(ctx:CanvasRenderingContext2D,w:number,h:number){
  const t=Math.min(w/COLS,h/ROWS),ox=(w-COLS*t)/2,oy=(h-ROWS*t)/2;ctx.save();ctx.translate(ox,oy);
  ctx.fillStyle='#c9b79f';ctx.fillRect(0,0,COLS*t,ROWS*t);
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){ctx.strokeStyle='rgba(86,72,58,.08)';ctx.strokeRect(x*t,y*t,t,t)}
  drawRoom(ctx,t,{x:.5,y:.5,w:12,h:8},'#d7c6ad','Projeto');
  drawRoom(ctx,t,{x:.5,y:18.5,w:12,h:9},'#c5d0c7','Café');
  drawRoom(ctx,t,{x:35.5,y:.5,w:12,h:8},'#c2ced0','Reunião');
  drawRoom(ctx,t,{x:35.5,y:17,w:12,h:10.5},'#c8bdca','Lounge');
  drawRoom(ctx,t,{x:13.2,y:18.5,w:7.5,h:9},'#bdc9bd','Pesquisa');
  drawRoom(ctx,t,{x:31,y:.5,w:4.1,h:8},'#afc1c8','Infra');
  ctx.fillStyle='rgba(104,139,151,.08)';ctx.fillRect(13*t,2*t,18*t,23*t);
  ctx.strokeStyle='#3e5966';ctx.lineWidth=t*.18;ctx.beginPath();ctx.moveTo(13*t,0);ctx.lineTo(13*t,28*t);ctx.moveTo(35*t,0);ctx.lineTo(35*t,28*t);ctx.stroke();
  ctx.fillStyle='rgba(83,110,124,.11)';ctx.fillRect(13*t,24.7*t,22*t,3.3*t);
  ctx.fillStyle='#1c3847';ctx.fillRect(14*t,2*t,5.2*t,4.4*t);ctx.fillStyle='#72c0d1';for(let i=0;i<3;i++)ctx.fillRect(14.5*t,(3+i*.72)*t,3.4*t,.18*t);
  meeting(ctx,t,38,2.5);sofa(ctx,t,38,20,6);coffee(ctx,t,1.7,21.3);bookshelf(ctx,t,14,20.2,3,5.5);server(ctx,t,31.5,2,5);server(ctx,t,33.2,2,5);
  desk(ctx,t,17,9,4.2);desk(ctx,t,23,9,4.2);desk(ctx,t,17,14,4.2);desk(ctx,t,23,14,4.2);
  ctx.fillStyle='#8d765d';ctx.fillRect(2.5*t,3*t,7.2*t,2.5*t);ctx.fillStyle='#d5be65';ctx.fillRect(3*t,3.45*t,1.4*t,.65*t);ctx.fillRect(4.8*t,3.45*t,1.4*t,.65*t);ctx.fillRect(6.6*t,3.45*t,1.4*t,.65*t);ctx.fillStyle='#8eb8c7';ctx.fillRect(4*t,4.4*t,3.7*t,.4*t);
  plant(ctx,t,11.4,10);plant(ctx,t,34.1,16);plant(ctx,t,28.8,23.8);plant(ctx,t,20.2,2.4);plant(ctx,t,45.5,15.2);
  ctx.fillStyle='#2f4652';ctx.fillRect(36.4*t,2*t,2.6*t,1.5*t);ctx.fillStyle='#5cc0d2';ctx.fillRect(36.75*t,2.45*t,1.9*t,.13*t);ctx.fillRect(36.75*t,2.8*t,1.5*t,.13*t);
  ctx.fillStyle='rgba(69,91,103,.23)';ctx.fillRect(14*t,25.2*t,20*t,.18*t);
  ctx.fillStyle='rgba(39,58,68,.45)';ctx.font=`700 ${Math.max(6,t*.34)}px ui-monospace,monospace`;ctx.fillText('MAIN CORRIDOR',27*t,27.2*t);
  ctx.restore();
}
export function OfficeTileCanvas(){
  const ref=useRef<HTMLCanvasElement|null>(null);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const render=()=>{const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.max(1,Math.floor(rect.width*dpr));canvas.height=Math.max(1,Math.floor(rect.height*dpr));const ctx=canvas.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,rect.width,rect.height);draw(ctx,rect.width,rect.height)};
    const ro=new ResizeObserver(render);ro.observe(canvas);render();return()=>ro.disconnect();
  },[]);
  return <canvas ref={ref} className="office-tile-canvas" aria-hidden="true"/>;
}
