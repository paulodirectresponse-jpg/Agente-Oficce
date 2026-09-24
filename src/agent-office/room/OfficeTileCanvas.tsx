import { useEffect, useRef } from 'react';

type Rect={x:number;y:number;w:number;h:number};
const COLS=64,ROWS=38;
function room(ctx:CanvasRenderingContext2D,t:number,r:Rect,fill:string,label:string){
  ctx.fillStyle=fill;ctx.fillRect(r.x*t,r.y*t,r.w*t,r.h*t);
  ctx.strokeStyle='#38515d';ctx.lineWidth=Math.max(2,t*.15);ctx.strokeRect(r.x*t,r.y*t,r.w*t,r.h*t);
  ctx.fillStyle='rgba(24,44,52,.58)';ctx.font=`700 ${Math.max(7,t*.38)}px ui-monospace,monospace`;ctx.fillText(label.toUpperCase(),(r.x+.55)*t,(r.y+.95)*t);
}
function wall(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w:number,h=.22){ctx.fillStyle='#38515d';ctx.fillRect(x*t,y*t,w*t,h*t)}
function rug(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w:number,h:number,color='#8f7892'){
  ctx.fillStyle=color;ctx.globalAlpha=.34;ctx.fillRect(x*t,y*t,w*t,h*t);ctx.globalAlpha=1;
  ctx.strokeStyle='rgba(255,255,255,.1)';for(let i=.35;i<w;i+=.7){ctx.beginPath();ctx.moveTo((x+i)*t,y*t);ctx.lineTo((x+i)*t,(y+h)*t);ctx.stroke()}
}
function desk(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w=4){
  ctx.fillStyle='#6e5842';ctx.fillRect(x*t,y*t,w*t,.65*t);ctx.fillStyle='#3e342c';ctx.fillRect((x+.25)*t,(y+.62)*t,.28*t,.75*t);ctx.fillRect((x+w-.52)*t,(y+.62)*t,.28*t,.75*t);
  ctx.fillStyle='#173849';ctx.fillRect((x+1.1)*t,(y-.8)*t,1.2*t,.8*t);ctx.strokeStyle='#4b7285';ctx.strokeRect((x+1.1)*t,(y-.8)*t,1.2*t,.8*t);ctx.fillStyle='#54b7cb';ctx.fillRect((x+1.25)*t,(y-.58)*t,.9*t,.11*t);ctx.fillRect((x+1.25)*t,(y-.36)*t,.7*t,.1*t);
  ctx.fillStyle='#293f49';ctx.fillRect((x+.35)*t,(y+.85)*t,.65*t,.55*t);
}
function doubleDesk(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){desk(ctx,t,x,y,4.5);desk(ctx,t,x+5.2,y,4.5)}
function plant(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){
  ctx.fillStyle='#6c4f3c';ctx.fillRect((x+.32)*t,(y+.62)*t,.5*t,.6*t);ctx.fillStyle='#4b8d61';for(const [dx,dy] of [[0,0],[.45,-.2],[.8,.05],[.4,.35]]){ctx.beginPath();ctx.arc((x+dx+.3)*t,(y+dy+.35)*t,.33*t,0,Math.PI*2);ctx.fill()}
}
function sofa(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w=5){
  ctx.fillStyle='#4e6886';ctx.fillRect(x*t,y*t,w*t,1.4*t);ctx.fillStyle='#617d9f';for(let i=0;i<w;i+=1.65)ctx.fillRect((x+i+.08)*t,(y+.15)*t,1.45*t,1*t);ctx.fillStyle='#364c63';ctx.fillRect((x-.18)*t,(y+.28)*t,.35*t,1.1*t);ctx.fillRect((x+w-.17)*t,(y+.28)*t,.35*t,1.1*t);
}
function bookshelf(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w=3,h=4){
  ctx.fillStyle='#725b43';ctx.fillRect(x*t,y*t,w*t,h*t);const colors=['#4a7e82','#c19254','#83515d','#5b7193'];let n=0;
  for(let row=0;row<Math.max(1,Math.floor(h/1.1)-1);row++)for(let col=0;col<Math.max(2,Math.floor(w/.55));col++){ctx.fillStyle=colors[n++%colors.length];ctx.fillRect((x+.22+col*.5)*t,(y+.35+row*1.05)*t,.31*t,.68*t)}
}
function server(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,h=5){
  ctx.fillStyle='#203541';ctx.fillRect(x*t,y*t,1.8*t,h*t);ctx.strokeStyle='#496676';ctx.strokeRect(x*t,y*t,1.8*t,h*t);
  for(let i=0;i<Math.floor(h/.7)-1;i++){ctx.fillStyle='#17303d';ctx.fillRect((x+.2)*t,(y+.35+i*.7)*t,1.4*t,.45*t);ctx.fillStyle='#54d89d';ctx.fillRect((x+1.28)*t,(y+.5+i*.7)*t,.12*t,.12*t)}
}
function meeting(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){
  ctx.fillStyle='#7b624f';ctx.beginPath();ctx.ellipse((x+3)*t,(y+1.6)*t,3*t,1.4*t,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#2c4c5c';for(const [dx,dy] of [[-.2,1.2],[6.1,1.2],[2.1,-.2],[3.7,-.2],[2.1,3.1],[3.7,3.1]])ctx.fillRect((x+dx)*t,(y+dy)*t,.55*t,.8*t);
}
function coffee(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){
  ctx.fillStyle='#75908c';ctx.fillRect(x*t,(y+2.2)*t,5*t,1.1*t);ctx.fillStyle='#9eb5b1';ctx.fillRect(x*t,y*t,1.6*t,2.15*t);ctx.strokeStyle='#647c7c';ctx.strokeRect(x*t,y*t,1.6*t,2.15*t);ctx.fillStyle='#253f49';ctx.fillRect((x+3)*t,(y+.5)*t,1.25*t,1.3*t);ctx.fillStyle='#77c5ce';ctx.fillRect((x+3.25)*t,(y+.75)*t,.75*t,.35*t);
}
function printer(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){ctx.fillStyle='#697f87';ctx.fillRect(x*t,y*t,1.8*t,1.25*t);ctx.fillStyle='#d7e4e1';ctx.fillRect((x+.3)*t,(y-.35)*t,1.2*t,.5*t);ctx.fillStyle='#28434f';ctx.fillRect((x+.35)*t,(y+.45)*t,1.1*t,.34*t)}
function whiteboard(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w=5,h=2.7){ctx.fillStyle='#e4e0d4';ctx.fillRect(x*t,y*t,w*t,h*t);ctx.strokeStyle='#685a4c';ctx.lineWidth=t*.12;ctx.strokeRect(x*t,y*t,w*t,h*t);ctx.fillStyle='#e0bd55';ctx.fillRect((x+.45)*t,(y+.45)*t,1.1*t,.45*t);ctx.fillStyle='#8ec0cd';ctx.fillRect((x+1.8)*t,(y+.5)*t,1.5*t,.22*t);ctx.fillRect((x+1.8)*t,(y+1)*t,2.1*t,.22*t)}
function roundTable(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,r=1.2){ctx.fillStyle='#8b6b50';ctx.beginPath();ctx.arc(x*t,y*t,r*t,0,Math.PI*2);ctx.fill();ctx.fillStyle='#304f5e';for(let a=0;a<4;a++){const angle=a*Math.PI/2;ctx.fillRect((x+Math.cos(angle)*(r+1)-.3)*t,(y+Math.sin(angle)*(r+1)-.3)*t,.6*t,.6*t)}}
function phoneBooth(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){ctx.fillStyle='#adc1c3';ctx.fillRect(x*t,y*t,2.2*t,3*t);ctx.strokeStyle='#48606a';ctx.strokeRect(x*t,y*t,2.2*t,3*t);ctx.fillStyle='#617b83';ctx.fillRect((x+.45)*t,(y+.45)*t,1.3*t,1.6*t);ctx.fillStyle='#2b4957';ctx.fillRect((x+.8)*t,(y+2.25)*t,.6*t,.35*t)}
function reception(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){ctx.fillStyle='#7b6653';ctx.fillRect(x*t,y*t,5.8*t,1.4*t);ctx.fillStyle='#b8a08b';ctx.fillRect((x+.3)*t,(y+.2)*t,5.2*t,.45*t);ctx.fillStyle='#24424e';ctx.fillRect((x+2.1)*t,(y-.8)*t,1.5*t,.8*t);ctx.fillStyle='#59b6c9';ctx.fillRect((x+2.35)*t,(y-.55)*t,1*t,.12*t)}
function kitchen(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){coffee(ctx,t,x,y);ctx.fillStyle='#718c86';ctx.fillRect((x+5.5)*t,y*t,4.2*t,3.3*t);ctx.fillStyle='#394e53';ctx.fillRect((x+6)*t,(y+.4)*t,1.2*t,.9*t);ctx.fillStyle='#a5bdad';ctx.fillRect((x+7.6)*t,(y+.4)*t,1.6*t,.9*t);ctx.fillStyle='#b4955f';ctx.fillRect((x+6.3)*t,(y+1.8)*t,2.4*t,.35*t)}
function artWall(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){for(const [dx,dy,w,h,c] of [[0,0,2.4,1.5,'#456e8a'],[2.8,.25,1.6,2,'#8a5e73'],[4.8,0,2.1,1.4,'#6d8a60']] as const){ctx.fillStyle='#e4ded1';ctx.fillRect((x+dx)*t,(y+dy)*t,w*t,h*t);ctx.fillStyle=c;ctx.fillRect((x+dx+.18)*t,(y+dy+.18)*t,(w-.36)*t,(h-.36)*t)}}
function draw(ctx:CanvasRenderingContext2D,w:number,h:number){
  const t=Math.min(w/COLS,h/ROWS),ox=(w-COLS*t)/2,oy=(h-ROWS*t)/2;ctx.save();ctx.translate(ox,oy);
  ctx.fillStyle='#cbbba4';ctx.fillRect(0,0,COLS*t,ROWS*t);
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){ctx.strokeStyle='rgba(84,70,55,.065)';ctx.strokeRect(x*t,y*t,t,t)}
  room(ctx,t,{x:.6,y:.6,w:13,h:8.5},'#d8c8ae','Projeto');
  room(ctx,t,{x:14.4,y:.6,w:9,h:8.5},'#c6d2d0','Design');
  room(ctx,t,{x:46,y:.6,w:17.4,h:8.5},'#c2ced0','Reunião');
  room(ctx,t,{x:39.8,y:.6,w:5.5,h:8.5},'#adc1c8','Infra');
  room(ctx,t,{x:.6,y:27.6,w:13,h:9.7},'#c5d0c7','Café');
  room(ctx,t,{x:14.4,y:27.6,w:9,h:9.7},'#c1cabb','Biblioteca');
  room(ctx,t,{x:46,y:25.4,w:17.4,h:11.9},'#c9becc','Lounge');
  room(ctx,t,{x:24.2,y:27.6,w:7.8,h:9.7},'#c7cdc0','Focus');
  room(ctx,t,{x:32.8,y:27.6,w:12.5,h:9.7},'#c4c8d0','Sprint');
  room(ctx,t,{x:.6,y:10.2,w:10.3,h:7.2},'#c9d2c8','Recepção');
  room(ctx,t,{x:.6,y:18.1,w:10.3,h:8.6},'#c8c3b6','Phone booths');
  ctx.fillStyle='rgba(105,139,151,.07)';ctx.fillRect(11.6*t,10.2*t,34*t,16.5*t);
  wall(ctx,t,11.5,9.5,34.2);wall(ctx,t,11.5,26.8,34.2);wall(ctx,t,45.7,9.5,.2,17.3);
  ctx.fillStyle='rgba(83,110,124,.12)';ctx.fillRect(11.8*t,23.8*t,33.5*t,2.3*t);
  ctx.fillStyle='rgba(39,58,68,.45)';ctx.font=`700 ${Math.max(6,t*.31)}px ui-monospace,monospace`;ctx.fillText('MAIN CORRIDOR',29.2*t,25.2*t);
  whiteboard(ctx,t,2.2,2.8,8,3.4);artWall(ctx,t,15.5,2.2);meeting(ctx,t,51,3.2);server(ctx,t,40.4,2.1,5.8);server(ctx,t,42.35,2.1,5.8);
  reception(ctx,t,2.4,13.2);plant(ctx,t,8.8,11.7);printer(ctx,t,7.8,15.5);
  phoneBooth(ctx,t,2,20.3);phoneBooth(ctx,t,4.8,20.3);phoneBooth(ctx,t,7.6,20.3);
  kitchen(ctx,t,1.8,30.2);roundTable(ctx,t,10.7,32.6,1.25);
  bookshelf(ctx,t,15.4,29.5,3.2,6.3);bookshelf(ctx,t,19.1,29.5,3.2,6.3);ctx.fillStyle='#788e77';ctx.fillRect(16.1*t,35.9*t,5.6*t,.55*t);
  phoneBooth(ctx,t,25.2,30);phoneBooth(ctx,t,28.2,30);plant(ctx,t,30.2,34.5);
  rug(ctx,t,34,29.4,9.2,5.7,'#748698');roundTable(ctx,t,38.5,32.2,1.35);whiteboard(ctx,t,34.5,29.9,2.8,2.1);sofa(ctx,t,40.1,34.5,3.4);
  rug(ctx,t,48,29,13.2,6.6);sofa(ctx,t,49,31.4,5.4);sofa(ctx,t,56.1,31.4,4.2);roundTable(ctx,t,54.8,34.1,1.1);plant(ctx,t,61,29.8);bookshelf(ctx,t,59.2,26.5,2.5,3.6);
  ctx.fillStyle='#1c3847';ctx.fillRect(13.2*t,11.1*t,5.3*t,4.3*t);ctx.fillStyle='#72c0d1';for(let i=0;i<4;i++)ctx.fillRect(13.75*t,(12+i*.72)*t,3.5*t,.17*t);
  doubleDesk(ctx,t,20.5,14.2);doubleDesk(ctx,t,20.5,19.2);doubleDesk(ctx,t,32.5,14.2);doubleDesk(ctx,t,32.5,19.2);
  ctx.fillStyle='#435d68';ctx.fillRect(12.8*t,17.2*t,2.2*t,1.6*t);ctx.fillStyle='#8eb3be';ctx.fillRect(13.15*t,17.55*t,1.5*t,.55*t);
  for(const [x,y] of [[10.8,9.6],[44.4,10.2],[44,25.6],[23.2,26.5],[31.3,10.2],[17.8,10.5],[61.4,10.1],[12.2,26.2]])plant(ctx,t,x,y);
  ctx.fillStyle='#866e55';ctx.fillRect(47.7*t,11.1*t,6.6*t,.7*t);ctx.fillStyle='#273f4b';for(let i=0;i<4;i++)ctx.fillRect((48+i*1.45)*t,10.1*t,.95*t,.95*t);
  ctx.fillStyle='#526c79';ctx.fillRect(56.5*t,11*t,5.4*t,2.2*t);ctx.fillStyle='#6fc4d3';ctx.fillRect(57.1*t,11.55*t,4.2*t,.18*t);ctx.fillRect(57.1*t,12*t,3.3*t,.18*t);
  ctx.fillStyle='rgba(98,119,127,.2)';for(let x=13;x<45;x+=4)ctx.fillRect(x*t,26.1*t,1.6*t,.25*t);
  ctx.restore();
}
export function OfficeTileCanvas(){
  const ref=useRef<HTMLCanvasElement|null>(null);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const render=()=>{const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight),dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.max(1,Math.floor(width*dpr));canvas.height=Math.max(1,Math.floor(height*dpr));const ctx=canvas.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,width,height);draw(ctx,width,height)};
    const ro=new ResizeObserver(render);ro.observe(canvas);render();return()=>ro.disconnect();
  },[]);
  return <canvas ref={ref} className="office-tile-canvas" aria-hidden="true"/>;
}
