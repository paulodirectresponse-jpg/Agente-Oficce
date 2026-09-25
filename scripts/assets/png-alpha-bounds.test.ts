import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { pngAlphaBounds } from './png-alpha-bounds.js';

function chunk(type:string,data:Buffer){
  const out=Buffer.alloc(12+data.length);
  out.writeUInt32BE(data.length,0);
  out.write(type,4,4,'ascii');
  data.copy(out,8);
  // Scanner intentionally does not depend on CRC verification.
  out.writeUInt32BE(0,8+data.length);
  return out;
}

function rgbaPng(width:number,height:number,pixels:Array<[number,number,number,number]>){
  const signature=Buffer.from('89504e470d0a1a0a','hex');
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);
  ihdr[8]=8;ihdr[9]=6;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
  const scan=Buffer.alloc(height*(1+width*4));let offset=0,index=0;
  for(let y=0;y<height;y++){
    scan[offset++]=0;
    for(let x=0;x<width;x++){
      const [r,g,b,a]=pixels[index++];
      scan[offset++]=r;scan[offset++]=g;scan[offset++]=b;scan[offset++]=a;
    }
  }
  return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}

describe('PNG alpha bounds scanner',()=>{
  it('finds the visible rectangle instead of using transparent canvas padding',()=>{
    const transparent:[number,number,number,number]=[0,0,0,0];
    const visible:[number,number,number,number]=[20,40,60,255];
    const pixels=[
      transparent,transparent,transparent,transparent,
      transparent,visible,visible,transparent,
      transparent,visible,visible,transparent,
    ];
    const bounds=pngAlphaBounds(rgbaPng(4,3,pixels));
    expect(bounds).toEqual({x:1,y:1,width:2,height:2,opaquePixels:4});
  });

  it('returns a safe 1x1 bound for a fully transparent PNG',()=>{
    const px:[number,number,number,number]=[0,0,0,0];
    expect(pngAlphaBounds(rgbaPng(2,2,[px,px,px,px]))).toEqual({x:0,y:0,width:1,height:1,opaquePixels:0});
  });
});
