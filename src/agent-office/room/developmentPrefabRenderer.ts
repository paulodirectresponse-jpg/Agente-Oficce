import type { AssetRegistry } from '../assets/assetRegistry.js';
import type { AssetCalibrationCatalog } from '../assets/assetCalibration.js';
import {
  drawCompiledPrefabsAfterCharacters,
  drawCompiledPrefabsBeforeCharacters,
  drawCompiledPrefabs,
} from '../assets/prefabRenderer.js';
import type { Development52BRuntime } from './developmentPrefabRoom.js';
import { DEVELOPMENT_52B_BOUNDS } from './developmentPrefabRoom.js';

export const DEVELOPMENT_52B_FLOOR_ID='floor.architecture.001.floor.wood.plank.tile.3957bd6a02';

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
  ctx.fillStyle='#173b4b';ctx.fillRect(b.x-16,b.y-16,b.width+32,b.height+32);

  const tile=runtime.images.get(DEVELOPMENT_52B_FLOOR_ID);
  if(tile?.complete&&tile.naturalWidth){
    ctx.save();ctx.imageSmoothingEnabled=false;
    const size=32;
    for(let y=b.y;y<b.y+b.height;y+=size){
      for(let x=b.x;x<b.x+b.width;x+=size){
        ctx.drawImage(tile,x,y,size,size);
      }
    }
    ctx.restore();
  }else{
    ctx.fillStyle='#9c633a';ctx.fillRect(b.x,b.y,b.width,b.height);
  }

  const vignette=ctx.createRadialGradient(
    b.x+b.width*.5,b.y+b.height*.44,120,
    b.x+b.width*.5,b.y+b.height*.44,b.width*.72,
  );
  vignette.addColorStop(0,'rgba(255,192,104,.025)');
  vignette.addColorStop(.68,'rgba(7,24,31,.015)');
  vignette.addColorStop(1,'rgba(3,15,22,.12)');
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
  ];
  for(const [x,y] of warm){
    const g=ctx.createRadialGradient(x,y,0,x,y,110);
    g.addColorStop(0,'rgba(255,184,86,.15)');
    g.addColorStop(1,'rgba(255,184,86,0)');
    ctx.fillStyle=g;ctx.fillRect(x-110,y-110,220,220);
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
  const ids=new Set<string>([DEVELOPMENT_52B_FLOOR_ID]);
  for(const prefab of runtime.room.prefabs)for(const node of prefab.nodes)ids.add(node.assetId);
  return [...ids];
}
