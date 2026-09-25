import type { AssetLayer, AssetRecord } from '../assets/assetRegistry.js';
import {
  DEVELOPMENT_V3_APPROVED_BACKGROUND_ID,
  DEVELOPMENT_V3_ASSETS,
  DEVELOPMENT_V3_BOUNDS,
  DEVELOPMENT_V3_LAYER_ORDER,
  DEVELOPMENT_V3_PLACEMENTS,
  type DevelopmentV3Placement,
} from './developmentV3.js';

export type LicensedDevelopmentRuntime={
  registry:Map<string,AssetRecord>;
  images:Map<string,HTMLImageElement>;
};

function roundedRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
}

function assetImage(runtime:LicensedDevelopmentRuntime,id:string){
  return runtime.images.get(id);
}

function drawApprovedBackdrop(ctx:CanvasRenderingContext2D,runtime:LicensedDevelopmentRuntime){
  const img=assetImage(runtime,DEVELOPMENT_V3_APPROVED_BACKGROUND_ID);
  if(!img?.complete||!img.naturalWidth)return false;
  const b=DEVELOPMENT_V3_BOUNDS;
  ctx.fillStyle='#061722';ctx.fillRect(0,0,1680,980);
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(img,b.x,b.y,b.width,b.height);
  ctx.restore();
  return true;
}

function drawShadow(ctx:CanvasRenderingContext2D,p:DevelopmentV3Placement,img:HTMLImageElement){
  const w=img.naturalWidth*p.scale,h=img.naturalHeight*p.scale;
  ctx.save();
  ctx.fillStyle='rgba(4,13,18,.26)';
  ctx.beginPath();
  ctx.ellipse(p.x,p.y+Math.min(10,h*.05),Math.max(16,w*.34),Math.max(6,Math.min(18,h*.06)),0,0,Math.PI*2);
  ctx.fill();
  ctx.restore();
}

function drawPlacement(ctx:CanvasRenderingContext2D,p:DevelopmentV3Placement,runtime:LicensedDevelopmentRuntime){
  const img=assetImage(runtime,p.assetId);
  if(!img?.complete||!img.naturalWidth)return;
  if(p.shadow)drawShadow(ctx,p,img);
  const w=img.naturalWidth*p.scale,h=img.naturalHeight*p.scale;
  const ax=p.anchorX??.5,ay=p.anchorY??1;
  ctx.save();
  ctx.globalAlpha=p.alpha??1;
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(img,p.x-w*ax,p.y-h*ay,w,h);
  ctx.restore();
}

function drawFloor(ctx:CanvasRenderingContext2D,runtime:LicensedDevelopmentRuntime){
  const tile=assetImage(runtime,DEVELOPMENT_V3_ASSETS.floor);
  const b=DEVELOPMENT_V3_BOUNDS;
  ctx.fillStyle='#0a1c28';ctx.fillRect(0,0,1680,980);
  ctx.fillStyle='#122d3b';ctx.fillRect(b.x-28,b.y-28,b.width+56,b.height+56);
  ctx.fillStyle='#1a3a49';ctx.fillRect(b.x-16,b.y-16,b.width+32,b.height+32);
  if(!tile?.complete||!tile.naturalWidth){
    ctx.fillStyle='#b69469';ctx.fillRect(b.x,b.y,b.width,b.height);return;
  }
  const size=32;
  for(let y=b.y;y<b.y+b.height;y+=size){
    for(let x=b.x;x<b.x+b.width;x+=size){
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(tile,x,y,size,size);
    }
  }
  ctx.fillStyle='rgba(7,29,38,.04)';ctx.fillRect(b.x,b.y,b.width,b.height);
}

function drawIdentity(ctx:CanvasRenderingContext2D,time:number){
  const b=DEVELOPMENT_V3_BOUNDS;
  const pulse=.5+.5*Math.sin(time/650);
  roundedRect(ctx,b.x+44,b.y+45,300,62,10);
  ctx.fillStyle='rgba(5,25,36,.92)';ctx.fill();
  ctx.strokeStyle='rgba(94,210,232,.38)';ctx.lineWidth=2;ctx.stroke();
  ctx.fillStyle='#e8f8fb';ctx.font='800 22px Inter,system-ui,sans-serif';ctx.textAlign='left';
  ctx.fillText('</>  DEVELOPMENT',b.x+68,b.y+85);
  ctx.fillStyle=`rgba(91,214,236,${.65+pulse*.35})`;ctx.fillRect(b.x+44,b.y+105,300,4);

}

function drawLighting(ctx:CanvasRenderingContext2D,time:number){
  const b=DEVELOPMENT_V3_BOUNDS;
  ctx.save();ctx.globalCompositeOperation='screen';
  const warm=[[b.x+90,b.y+170],[b.x+1010,b.y+180],[b.x+170,b.y+690],[b.x+930,b.y+690]];
  for(const [x,y] of warm){
    const g=ctx.createRadialGradient(x,y,0,x,y,115);
    g.addColorStop(0,'rgba(255,189,91,.20)');g.addColorStop(1,'rgba(255,189,91,0)');
    ctx.fillStyle=g;ctx.fillRect(x-115,y-115,230,230);
  }
  const p=.08+.02*Math.sin(time/900);
  const cool=ctx.createRadialGradient(b.x+650,b.y+420,40,b.x+650,b.y+420,520);
  cool.addColorStop(0,`rgba(47,193,224,${p})`);cool.addColorStop(1,'rgba(47,193,224,0)');
  ctx.fillStyle=cool;ctx.fillRect(b.x+60,b.y+30,1080,760);
  ctx.restore();
}

export function drawDevelopmentV3Layer(
  ctx:CanvasRenderingContext2D,
  runtime:LicensedDevelopmentRuntime,
  layer:AssetLayer,
){
  if(layer==='floor')drawFloor(ctx,runtime);
  for(const p of DEVELOPMENT_V3_PLACEMENTS)if(p.layer===layer)drawPlacement(ctx,p,runtime);
}

export function drawDevelopmentV3Back(ctx:CanvasRenderingContext2D,runtime:LicensedDevelopmentRuntime,time:number){
  if(drawApprovedBackdrop(ctx,runtime))return;
  for(const layer of DEVELOPMENT_V3_LAYER_ORDER){
    if(layer==='character'||layer==='furniture_front'||layer==='wall_front'||layer==='fx'||layer==='overlay')continue;
    drawDevelopmentV3Layer(ctx,runtime,layer);
  }
  drawIdentity(ctx,time);
}

export function drawDevelopmentV3Front(ctx:CanvasRenderingContext2D,runtime:LicensedDevelopmentRuntime,time:number){
  if(assetImage(runtime,DEVELOPMENT_V3_APPROVED_BACKGROUND_ID)?.complete)return;
  drawDevelopmentV3Layer(ctx,runtime,'furniture_front');
  drawDevelopmentV3Layer(ctx,runtime,'wall_front');
  drawLighting(ctx,time);

  const b=DEVELOPMENT_V3_BOUNDS;
  ctx.save();
  ctx.fillStyle='rgba(31,133,157,.08)';ctx.fillRect(b.x+330,b.y+b.height-22,480,20);
  ctx.strokeStyle='rgba(106,211,234,.32)';ctx.strokeRect(b.x+330,b.y+b.height-22,480,20);
  ctx.restore();
}

export function drawDevelopmentV3Mini(ctx:CanvasRenderingContext2D,runtime:LicensedDevelopmentRuntime,time:number){
  drawDevelopmentV3Back(ctx,runtime,time);
  drawDevelopmentV3Front(ctx,runtime,time);
}
