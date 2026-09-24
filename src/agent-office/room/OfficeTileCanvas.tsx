import { useEffect, useRef } from 'react';

type Rect={x:number;y:number;w:number;h:number};
type OfficeAssets={floors:HTMLImageElement|null,cabinets:HTMLImageElement|null,decor:HTMLImageElement|null,kitchen:HTMLImageElement|null,living:HTMLImageElement|null};
function crop(ctx:CanvasRenderingContext2D,img:HTMLImageElement|null,sx:number,sy:number,sw:number,sh:number,t:number,x:number,y:number,scale=1){
  if(!img||!img.complete||!img.naturalWidth)return false;
  const unit=t/16;ctx.drawImage(img,sx,sy,sw,sh,x*t,y*t,sw*unit*scale,sh*unit*scale);return true;
}
function tileTexture(ctx:CanvasRenderingContext2D,img:HTMLImageElement|null,t:number,r:Rect,row:number,colBase=0,alpha=.42){
  if(!img||!img.complete||!img.naturalWidth)return;
  ctx.save();ctx.globalAlpha=alpha;
  const cols=Math.ceil(r.w),rows=Math.ceil(r.h),sheetCols=14;
  for(let yy=0;yy<rows;yy++)for(let xx=0;xx<cols;xx++){
    const sx=((colBase+(xx%4))%sheetCols)*16,sy=(row+(yy%2))*16;
    ctx.drawImage(img,sx,sy,16,16,(r.x+xx)*t,(r.y+yy)*t,t,t);
  }
  ctx.restore();
}
function pixelPlant(ctx:CanvasRenderingContext2D,a:OfficeAssets,t:number,x:number,y:number,small=false){
  if(!crop(ctx,a.decor,small?32:48,48,16,32,t,x,y,1.35))plant(ctx,t,x,y);
}
function pixelBookshelf(ctx:CanvasRenderingContext2D,a:OfficeAssets,t:number,x:number,y:number,scale=1){
  if(!crop(ctx,a.cabinets,0,0,48,64,t,x,y,scale))bookshelf(ctx,t,x,y,3*scale,4*scale);
}
function pixelLamp(ctx:CanvasRenderingContext2D,a:OfficeAssets,t:number,x:number,y:number){
  if(!crop(ctx,a.decor,0,0,16,48,t,x,y,1.18))floorLamp(ctx,t,x,y);
}
function pixelPainting(ctx:CanvasRenderingContext2D,a:OfficeAssets,t:number,x:number,y:number){
  if(!crop(ctx,a.decor,96,48,48,32,t,x,y,1.08))artWall(ctx,t,x,y);
}
function pixelClock(ctx:CanvasRenderingContext2D,a:OfficeAssets,t:number,x:number,y:number){
  crop(ctx,a.decor,0,96,16,16,t,x,y,1.15);
}
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
function vending(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){
  ctx.fillStyle='#38576b';ctx.fillRect(x*t,y*t,1.7*t,3.2*t);ctx.strokeStyle='#223b4a';ctx.strokeRect(x*t,y*t,1.7*t,3.2*t);
  ctx.fillStyle='#72bfd2';ctx.fillRect((x+.3)*t,(y+.35)*t,1.1*t,1.2*t);ctx.fillStyle='#d7b65a';for(let i=0;i<3;i++)ctx.fillRect((x+.34+i*.34)*t,(y+.55)*t,.22*t,.28*t);
  ctx.fillStyle='#203a48';ctx.fillRect((x+.3)*t,(y+1.9)*t,1.1*t,.65*t);ctx.fillStyle='#5ed39b';ctx.fillRect((x+1.25)*t,(y+2.35)*t,.12*t,.12*t);
}
function waterCooler(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){
  ctx.fillStyle='#31505d';ctx.fillRect(x*t,(y+1)*t,1.1*t,1.5*t);ctx.fillStyle='#9fd6df';ctx.beginPath();ctx.ellipse((x+.55)*t,(y+.55)*t,.4*t,.65*t,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#e7f0ec';ctx.fillRect((x+.18)*t,(y+1.15)*t,.74*t,.28*t);ctx.fillStyle='#61b9ce';ctx.fillRect((x+.28)*t,(y+1.75)*t,.18*t,.18*t);
}
function cabinet(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w=2.2,h=2.6,color='#6f7e7d'){
  ctx.fillStyle=color;ctx.fillRect(x*t,y*t,w*t,h*t);ctx.strokeStyle='rgba(32,53,61,.55)';ctx.strokeRect(x*t,y*t,w*t,h*t);
  for(let row=0;row<3;row++){ctx.strokeRect((x+.16)*t,(y+.18+row*.78)*t,(w-.32)*t,.62*t);ctx.fillStyle='#2f4a54';ctx.fillRect((x+w-.45)*t,(y+.46+row*.78)*t,.16*t,.08*t)}
}
function floorLamp(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){
  ctx.fillStyle='#4f5857';ctx.fillRect((x+.43)*t,(y+.7)*t,.12*t,2.6*t);ctx.fillStyle='#d8bd73';ctx.beginPath();ctx.moveTo(x*t,(y+.7)*t);ctx.lineTo((x+1)*t,(y+.7)*t);ctx.lineTo((x+.78)*t,y*t);ctx.lineTo((x+.22)*t,y*t);ctx.closePath();ctx.fill();
  ctx.fillStyle='rgba(247,220,139,.12)';ctx.beginPath();ctx.arc((x+.5)*t,(y+.6)*t,1.4*t,0,Math.PI*2);ctx.fill();
}
function stool(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,color='#48616d'){
  ctx.fillStyle=color;ctx.beginPath();ctx.arc((x+.45)*t,(y+.35)*t,.45*t,0,Math.PI*2);ctx.fill();ctx.fillStyle='#344850';ctx.fillRect((x+.37)*t,(y+.7)*t,.16*t,.65*t);
}
function taskBoard(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w=4.4,h=2.4){
  ctx.fillStyle='#d9d5c9';ctx.fillRect(x*t,y*t,w*t,h*t);ctx.strokeStyle='#6d6156';ctx.strokeRect(x*t,y*t,w*t,h*t);
  const colors=['#dfbd56','#75afc5','#d9877c','#83a96f'];let n=0;
  for(let r=0;r<2;r++)for(let c=0;c<4;c++){ctx.fillStyle=colors[n++%colors.length];ctx.fillRect((x+.35+c*.9)*t,(y+.35+r*.8)*t,.62*t,.48*t)}
}
function arcade(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){
  ctx.fillStyle='#263f52';ctx.fillRect(x*t,y*t,1.7*t,3*t);ctx.fillStyle='#503f66';ctx.fillRect((x+.18)*t,(y+.18)*t,1.34*t,.8*t);ctx.fillStyle='#69c4d9';ctx.fillRect((x+.35)*t,(y+.35)*t,1*t,.35*t);ctx.fillStyle='#d79a5e';ctx.fillRect((x+.4)*t,(y+1.35)*t,.9*t,.3*t);ctx.fillStyle='#171f29';ctx.fillRect((x+.3)*t,(y+1.85)*t,1.1*t,.85*t);
}
function divider(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w:number,h=.25,color='#536d77'){ctx.fillStyle=color;ctx.fillRect(x*t,y*t,w*t,h*t);ctx.fillStyle='rgba(255,255,255,.08)';ctx.fillRect(x*t,y*t,w*t,.04*t)}
function glassWall(ctx:CanvasRenderingContext2D,t:number,x:number,y:number,w:number,h:number){
  ctx.fillStyle='rgba(154,199,210,.18)';ctx.fillRect(x*t,y*t,w*t,h*t);ctx.strokeStyle='rgba(63,94,108,.65)';ctx.strokeRect(x*t,y*t,w*t,h*t);
  for(let i=1;i<Math.floor(w/2);i++){ctx.beginPath();ctx.moveTo((x+i*2)*t,y*t);ctx.lineTo((x+i*2)*t,(y+h)*t);ctx.stroke()}
}
function artWall(ctx:CanvasRenderingContext2D,t:number,x:number,y:number){for(const [dx,dy,w,h,c] of [[0,0,2.4,1.5,'#456e8a'],[2.8,.25,1.6,2,'#8a5e73'],[4.8,0,2.1,1.4,'#6d8a60']] as const){ctx.fillStyle='#e4ded1';ctx.fillRect((x+dx)*t,(y+dy)*t,w*t,h*t);ctx.fillStyle=c;ctx.fillRect((x+dx+.18)*t,(y+dy+.18)*t,(w-.36)*t,(h-.36)*t)}}
function draw(ctx:CanvasRenderingContext2D,w:number,h:number,a:OfficeAssets,time=0){
  const t=Math.min(w/COLS,h/ROWS),ox=(w-COLS*t)/2,oy=(h-ROWS*t)/2;ctx.save();ctx.translate(ox,oy);
  ctx.fillStyle='#cbbba4';ctx.fillRect(0,0,COLS*t,ROWS*t);
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){ctx.strokeStyle='rgba(84,70,55,.065)';ctx.strokeRect(x*t,y*t,t,t)}
  const R={
    project:{x:.6,y:.6,w:13,h:8.5},design:{x:14.4,y:.6,w:9,h:8.5},meeting:{x:46,y:.6,w:17.4,h:8.5},infra:{x:39.8,y:.6,w:5.5,h:8.5},
    cafe:{x:.6,y:27.6,w:13,h:9.7},library:{x:14.4,y:27.6,w:9,h:9.7},lounge:{x:46,y:25.4,w:17.4,h:11.9},focus:{x:24.2,y:27.6,w:7.8,h:9.7},
    sprint:{x:32.8,y:27.6,w:12.5,h:9.7},reception:{x:.6,y:10.2,w:10.3,h:7.2},phone:{x:.6,y:18.1,w:10.3,h:8.6}
  } satisfies Record<string,Rect>;
  room(ctx,t,R.project,'#d8c8ae','Projeto');
  room(ctx,t,R.design,'#c6d2d0','Design');
  room(ctx,t,R.meeting,'#c2ced0','Reunião');
  room(ctx,t,R.infra,'#adc1c8','Infra');
  room(ctx,t,R.cafe,'#c5d0c7','Café');
  room(ctx,t,R.library,'#c1cabb','Biblioteca');
  room(ctx,t,R.lounge,'#c9becc','Lounge');
  room(ctx,t,R.focus,'#c7cdc0','Focus');
  room(ctx,t,R.sprint,'#c4c8d0','Sprint');
  room(ctx,t,R.reception,'#c9d2c8','Recepção');
  room(ctx,t,R.phone,'#c8c3b6','Phone booths');
  tileTexture(ctx,a.floors,t,R.project,0,0,.34);tileTexture(ctx,a.floors,t,R.design,10,4,.32);tileTexture(ctx,a.floors,t,R.meeting,2,3,.34);tileTexture(ctx,a.floors,t,R.infra,14,7,.36);
  tileTexture(ctx,a.floors,t,R.cafe,10,4,.35);tileTexture(ctx,a.floors,t,R.library,4,0,.33);tileTexture(ctx,a.floors,t,R.lounge,10,0,.30);tileTexture(ctx,a.floors,t,R.focus,12,7,.29);
  tileTexture(ctx,a.floors,t,R.sprint,6,0,.32);tileTexture(ctx,a.floors,t,R.reception,6,0,.30);tileTexture(ctx,a.floors,t,R.phone,12,7,.28);
  ctx.fillStyle='rgba(105,139,151,.07)';ctx.fillRect(11.6*t,10.2*t,34*t,16.5*t);
  wall(ctx,t,11.5,9.5,34.2);wall(ctx,t,11.5,26.8,34.2);wall(ctx,t,45.7,9.5,.2,17.3);
  ctx.fillStyle='rgba(83,110,124,.12)';ctx.fillRect(11.8*t,23.8*t,33.5*t,2.3*t);
  ctx.fillStyle='rgba(39,58,68,.45)';ctx.font=`700 ${Math.max(6,t*.31)}px ui-monospace,monospace`;ctx.fillText('MAIN CORRIDOR',29.2*t,25.2*t);
  whiteboard(ctx,t,2.2,2.8,8,3.4);taskBoard(ctx,t,7.6,6.15,4.8,1.5);artWall(ctx,t,15.5,2.2);meeting(ctx,t,51,3.2);server(ctx,t,40.4,2.1,5.8);server(ctx,t,42.35,2.1,5.8);
  cabinet(ctx,t,18.2,5.7,1.7,2.1,'#819291');cabinet(ctx,t,20.2,5.7,1.7,2.1,'#819291');waterCooler(ctx,t,37.8,5.6);
  glassWall(ctx,t,46.1,8.4,17.2,.35);
  reception(ctx,t,2.4,13.2);plant(ctx,t,8.8,11.7);printer(ctx,t,7.8,15.5);vending(ctx,t,8.7,13.25);waterCooler(ctx,t,1.35,14.1);
  phoneBooth(ctx,t,2,20.3);phoneBooth(ctx,t,4.8,20.3);phoneBooth(ctx,t,7.6,20.3);
  kitchen(ctx,t,1.8,30.2);roundTable(ctx,t,10.7,32.6,1.25);stool(ctx,t,9.4,31.2);stool(ctx,t,11.7,31.3);vending(ctx,t,10.8,34.2);
  bookshelf(ctx,t,15.4,29.5,3.2,6.3);bookshelf(ctx,t,19.1,29.5,3.2,6.3);ctx.fillStyle='#788e77';ctx.fillRect(16.1*t,35.9*t,5.6*t,.55*t);floorLamp(ctx,t,22,30.2);roundTable(ctx,t,20.8,34.7,.75);
  phoneBooth(ctx,t,25.2,30);phoneBooth(ctx,t,28.2,30);plant(ctx,t,30.2,34.5);
  rug(ctx,t,34,29.4,9.2,5.7,'#748698');roundTable(ctx,t,38.5,32.2,1.35);whiteboard(ctx,t,34.5,29.9,2.8,2.1);sofa(ctx,t,40.1,34.5,3.4);
  rug(ctx,t,48,29,13.2,6.6);sofa(ctx,t,49,31.4,5.4);sofa(ctx,t,56.1,31.4,4.2);roundTable(ctx,t,54.8,34.1,1.1);plant(ctx,t,61,29.8);bookshelf(ctx,t,59.2,26.5,2.5,3.6);floorLamp(ctx,t,48.3,28.2);arcade(ctx,t,61,33.4);
  ctx.fillStyle='#1c3847';ctx.fillRect(13.2*t,11.1*t,5.3*t,4.3*t);ctx.fillStyle='#72c0d1';for(let i=0;i<4;i++)ctx.fillRect(13.75*t,(12+i*.72)*t,3.5*t,.17*t);
  rug(ctx,t,19.2,12.7,22.3,10.4,'#78909a');doubleDesk(ctx,t,20.5,14.2);doubleDesk(ctx,t,20.5,19.2);doubleDesk(ctx,t,32.5,14.2);doubleDesk(ctx,t,32.5,19.2);
  divider(ctx,t,29.3,12.7,.2,10.3,'#516d77');taskBoard(ctx,t,37.2,22.1,4.3,2.2);printer(ctx,t,17.6,22.4);waterCooler(ctx,t,43.2,21.8);
  ctx.fillStyle='#435d68';ctx.fillRect(12.8*t,17.2*t,2.2*t,1.6*t);ctx.fillStyle='#8eb3be';ctx.fillRect(13.15*t,17.55*t,1.5*t,.55*t);
  for(const [x,y] of [[10.8,9.6],[44.4,10.2],[44,25.6],[23.2,26.5],[31.3,10.2],[17.8,10.5],[61.4,10.1],[12.2,26.2]])plant(ctx,t,x,y);
  ctx.fillStyle='#866e55';ctx.fillRect(47.7*t,11.1*t,6.6*t,.7*t);ctx.fillStyle='#273f4b';for(let i=0;i<4;i++)ctx.fillRect((48+i*1.45)*t,10.1*t,.95*t,.95*t);
  ctx.fillStyle='#526c79';ctx.fillRect(56.5*t,11*t,5.4*t,2.2*t);ctx.fillStyle='#6fc4d3';ctx.fillRect(57.1*t,11.55*t,4.2*t,.18*t);ctx.fillRect(57.1*t,12*t,3.3*t,.18*t);
  ctx.fillStyle='rgba(98,119,127,.2)';for(let x=13;x<45;x+=4)ctx.fillRect(x*t,26.1*t,1.6*t,.25*t);
  ctx.fillStyle='rgba(34,58,68,.44)';ctx.font=`700 ${Math.max(6,t*.34)}px ui-monospace,monospace`;ctx.fillText('DEV HUB',26.4*t,11.7*t);ctx.fillText('OPS POD',36.6*t,11.7*t);
  ctx.fillStyle='rgba(255,255,255,.05)';for(let x=13;x<45;x+=2.5)for(let y=10.5;y<26;y+=2.5){ctx.fillRect(x*t,y*t,.06*t,.06*t)}

  /* Real CC0 pixel-art details layered over the vector fallback. */
  pixelBookshelf(ctx,a,t,15.3,29.3,.9);pixelBookshelf(ctx,a,t,19.0,29.3,.9);pixelBookshelf(ctx,a,t,58.9,26.7,.72);
  pixelPainting(ctx,a,t,2.5,1.45);pixelPainting(ctx,a,t,16.0,1.5);pixelPainting(ctx,a,t,50.3,1.5);
  pixelClock(ctx,a,t,11.55,1.5);pixelClock(ctx,a,t,44.0,1.55);pixelClock(ctx,a,t,61.1,1.5);
  for(const [x,y,small] of [[10.7,9.35,false],[44.0,9.95,false],[43.8,25.45,true],[23.0,26.4,true],[31.15,10.15,false],[17.65,10.35,true],[61.0,10.0,false],[12.05,26.0,true],[60.7,29.3,false],[8.8,28.4,true]] as Array<[number,number,boolean]>)pixelPlant(ctx,a,t,x,y,small);
  pixelLamp(ctx,a,t,47.8,28.2);pixelLamp(ctx,a,t,61.45,28.15);pixelLamp(ctx,a,t,22.0,29.6);
  const pulse=.35+.35*((Math.sin(time/420)+1)/2);ctx.save();ctx.globalAlpha=pulse;ctx.fillStyle='#60e3a3';
  for(const [x,y] of [[41.25,3.0],[43.1,4.4],[41.2,6.0],[43.0,7.0]]){ctx.beginPath();ctx.arc(x*t,y*t,.09*t,0,Math.PI*2);ctx.fill()}
  ctx.restore();
  ctx.restore();
}
export function OfficeTileCanvas(){
  const ref=useRef<HTMLCanvasElement|null>(null);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    let disposed=false,raf=0,last=0;
    const assets:OfficeAssets={floors:null,cabinets:null,decor:null,kitchen:null,living:null};
    const render=(time=0)=>{const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight),dpr=Math.min(window.devicePixelRatio||1,2),nextW=Math.max(1,Math.floor(width*dpr)),nextH=Math.max(1,Math.floor(height*dpr));if(canvas.width!==nextW||canvas.height!==nextH){canvas.width=nextW;canvas.height=nextH}const ctx=canvas.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,width,height);draw(ctx,width,height,assets,time)};
    const load=(key:keyof OfficeAssets,url:string)=>{const img=new Image();assets[key]=img;img.src=url;img.onload=()=>{if(!disposed)render(performance.now())}};
    load('floors','/office-assets/floorswalls_LRK.png');load('cabinets','/office-assets/cabinets_LRK.png');load('decor','/office-assets/decorations_LRK.png');load('kitchen','/office-assets/kitchen_LRK.png');load('living','/office-assets/livingroom_LRK.png');
    const tick=(time:number)=>{if(disposed)return;if(time-last>180){last=time;render(time)}raf=requestAnimationFrame(tick)};
    const ro=new ResizeObserver(()=>render(performance.now()));ro.observe(canvas);render(performance.now());raf=requestAnimationFrame(tick);
    return()=>{disposed=true;cancelAnimationFrame(raf);ro.disconnect()};
  },[]);
  return <canvas ref={ref} className="office-tile-canvas" aria-hidden="true"/>;
}
