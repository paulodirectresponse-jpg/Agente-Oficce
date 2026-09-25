import type { AssetRegistry } from '../assets/assetRegistry.js';
import type { AssetCalibrationCatalog } from '../assets/assetCalibration.js';
import {
  drawCompiledPrefabsAfterCharacters,
  drawCompiledPrefabsBeforeCharacters,
  drawCompiledPrefabs,
} from '../assets/prefabRenderer.js';
import type { Development52BRuntime } from './developmentPrefabRoom.js';
import { DEVELOPMENT_52B_BOUNDS } from './developmentPrefabRoom.js';

export const DEVELOPMENT_52B_FLOOR_ID='floor.luxury.01.warm.oak.patch';
export const DEVELOPMENT_52B_TOP_WALL_ID='architecture.luxury.05.straight.interior.wall';

export type Development52BRenderRuntime={
  registry:AssetRegistry;
  calibrations:AssetCalibrationCatalog;
  room:Development52BRuntime;
  images:Map<string,HTMLImageElement>;
};

function roundedRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
}

function drawFloor(ctx:CanvasRenderingContext2D,runtime:Development52BRenderRuntime){
  const b=DEVELOPMENT_52B_BOUNDS;
  ctx.fillStyle='#061722';ctx.fillRect(0,0,1680,980);
  ctx.fillStyle='#0d2a38';ctx.fillRect(b.x-28,b.y-28,b.width+56,b.height+56);
  ctx.fillStyle='#d7c79e';ctx.fillRect(b.x-16,b.y-16,b.width+32,b.height+32);
  ctx.fillStyle='#a85f28';ctx.fillRect(b.x,b.y,b.width,b.height);

  const tile=runtime.images.get(DEVELOPMENT_52B_FLOOR_ID);
  if(tile?.complete&&tile.naturalWidth){
    ctx.save();ctx.imageSmoothingEnabled=false;
    ctx.globalAlpha=.95;
    const calibration=runtime.calibrations.require(DEVELOPMENT_52B_FLOOR_ID);
    const source=calibration.alphaBounds;
    const tileW=Math.round(source.width*calibration.canonicalScale);
    const tileH=Math.round(source.height*calibration.canonicalScale);
    const firstX=b.x-Math.ceil((((b.x%tileW)+tileW)%tileW));
    const firstY=b.y-Math.ceil((((b.y%tileH)+tileH)%tileH));
    for(let row=0,y=firstY;y<b.y+b.height;row++,y+=tileH){
      const rowStart=firstX-(row%2?Math.floor(tileW/2):0);
      for(let x=rowStart;x<b.x+b.width;x+=tileW){
        const clipped={
          x:Math.max(x,b.x),y:Math.max(y,b.y),
          width:Math.min(x+tileW,b.x+b.width)-Math.max(x,b.x),
          height:Math.min(y+tileH,b.y+b.height)-Math.max(y,b.y),
        };
        if(clipped.width<=0||clipped.height<=0)continue;
        const sx=source.x+(clipped.x-x)/tileW*source.width;
        const sy=source.y+(clipped.y-y)/tileH*source.height;
        const sw=clipped.width/tileW*source.width;
        const sh=clipped.height/tileH*source.height;
        ctx.drawImage(tile,sx,sy,sw,sh,clipped.x,clipped.y,clipped.width,clipped.height);
      }
    }
    ctx.restore();
    ctx.fillStyle='rgba(36,18,9,.08)';ctx.fillRect(b.x,b.y,b.width,b.height);
  }else{
    ctx.fillStyle='#9c633a';ctx.fillRect(b.x,b.y,b.width,b.height);
  }

  const wall=runtime.images.get(DEVELOPMENT_52B_TOP_WALL_ID);
  if(wall?.complete&&wall.naturalWidth){
    const calibration=runtime.calibrations.require(DEVELOPMENT_52B_TOP_WALL_ID);
    const source=calibration.alphaBounds;
    const moduleWidth=source.width*calibration.canonicalScale;
    const moduleHeight=source.height*calibration.canonicalScale;
    ctx.save();ctx.imageSmoothingEnabled=false;
    for(let i=0;i<5;i++){
      ctx.drawImage(wall,source.x,source.y,source.width,source.height,
        Math.round(b.x+8+i*moduleWidth),b.y+14,Math.ceil(moduleWidth),Math.ceil(moduleHeight));
    }
    ctx.fillStyle='rgba(29,38,43,.58)';
    ctx.fillRect(b.x+9,b.y+43,b.width-18,76);
    ctx.restore();
  }

  const vignette=ctx.createRadialGradient(
    b.x+b.width*.5,b.y+b.height*.44,120,
    b.x+b.width*.5,b.y+b.height*.44,b.width*.72,
  );
  vignette.addColorStop(0,'rgba(255,192,104,.02)');
  vignette.addColorStop(.68,'rgba(7,24,31,.01)');
  vignette.addColorStop(1,'rgba(3,15,22,.06)');
  ctx.fillStyle=vignette;ctx.fillRect(b.x,b.y,b.width,b.height);
}

function drawIdentity(ctx:CanvasRenderingContext2D){
  const b=DEVELOPMENT_52B_BOUNDS;
  roundedRect(ctx,b.x+46,b.y+50,250,56,8);
  ctx.fillStyle='rgba(5,27,40,.94)';ctx.fill();
  ctx.strokeStyle='rgba(80,207,231,.48)';ctx.lineWidth=2;ctx.stroke();
  ctx.fillStyle='#6bdcf1';ctx.font='700 18px ui-monospace,SFMono-Regular,Consolas,monospace';ctx.textAlign='left';
  ctx.fillText('</>',b.x+66,b.y+84);
  ctx.fillStyle='#effbff';ctx.font='800 18px Inter,system-ui,sans-serif';
  ctx.fillText('DEVELOPMENT',b.x+111,b.y+84);
  ctx.fillStyle='rgba(88,218,239,.82)';ctx.fillRect(b.x+46,b.y+104,250,3);
}

function drawAmbientLighting(ctx:CanvasRenderingContext2D,time:number){
  const b=DEVELOPMENT_52B_BOUNDS;
  ctx.save();ctx.globalCompositeOperation='screen';
  const warm=[
    [b.x+115,b.y+160],
    [b.x+b.width*.47,b.y+155],
    [b.x+b.width-125,b.y+160],
    [b.x+95,b.y+b.height-160],
    [b.x+b.width-110,b.y+b.height-160],
    [b.x+b.width*.5-80,b.y+b.height-50],
    [b.x+b.width*.5+80,b.y+b.height-50],
  ];
  for(const [x,y] of warm){
    const g=ctx.createRadialGradient(x,y,0,x,y,110);
    g.addColorStop(0,'rgba(255,184,86,.15)');
    g.addColorStop(1,'rgba(255,184,86,0)');
    ctx.fillStyle=g;ctx.fillRect(x-110,y-110,220,220);
  }
  for(const x of [b.x+38,b.x+310,b.x+1190]){
    const y=b.y+96;
    const halo=ctx.createRadialGradient(x,y,0,x,y,62);
    halo.addColorStop(0,'rgba(255,196,103,.27)');
    halo.addColorStop(1,'rgba(255,196,103,0)');
    ctx.fillStyle=halo;ctx.fillRect(x-62,y-62,124,124);
  }
  const p=.045+.012*Math.sin(time/920);
  const cool=ctx.createRadialGradient(b.x+b.width*.58,b.y+b.height*.40,30,b.x+b.width*.58,b.y+b.height*.40,520);
  cool.addColorStop(0,`rgba(50,197,224,${p})`);
  cool.addColorStop(1,'rgba(50,197,224,0)');
  ctx.fillStyle=cool;ctx.fillRect(b.x,b.y,b.width,b.height);
  ctx.restore();
}

export function drawDevelopment52BBack(
  ctx:CanvasRenderingContext2D,
  runtime:Development52BRenderRuntime,
  _time:number,
){
  drawFloor(ctx,runtime);
  drawCompiledPrefabsBeforeCharacters(ctx,runtime.room.room.prefabs,runtime.images);
  drawIdentity(ctx);
}

export function drawDevelopment52BFront(
  ctx:CanvasRenderingContext2D,
  runtime:Development52BRenderRuntime,
  time:number,
){
  drawCompiledPrefabsAfterCharacters(ctx,runtime.room.room.prefabs,runtime.images);
  drawAmbientLighting(ctx,time);
}

export function drawDevelopment52BMini(
  ctx:CanvasRenderingContext2D,
  runtime:Development52BRenderRuntime,
  time:number,
){
  drawFloor(ctx,runtime);
  drawCompiledPrefabs(ctx,runtime.room.room.prefabs,runtime.images);
  drawIdentity(ctx);
  drawAmbientLighting(ctx,time);
}

export function requiredDevelopment52BAssetIds(runtime:Development52BRuntime){
  const ids=new Set<string>([DEVELOPMENT_52B_FLOOR_ID,DEVELOPMENT_52B_TOP_WALL_ID]);
  for(const prefab of runtime.room.prefabs)for(const node of prefab.nodes)ids.add(node.assetId);
  return [...ids];
}
