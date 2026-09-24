import { inflateSync } from 'node:zlib';

type Chunk={type:string;data:Buffer};

function chunks(buffer:Buffer){
  const signature='89504e470d0a1a0a';
  if(buffer.subarray(0,8).toString('hex')!==signature)throw new Error('Not a PNG file');
  const out:Chunk[]=[];let offset=8;
  while(offset+12<=buffer.length){
    const length=buffer.readUInt32BE(offset);
    const type=buffer.subarray(offset+4,offset+8).toString('ascii');
    const data=buffer.subarray(offset+8,offset+8+length);
    out.push({type,data});
    offset+=12+length;
    if(type==='IEND')break;
  }
  return out;
}

function paeth(a:number,b:number,c:number){
  const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
  return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
}

function unfilter(raw:Buffer,height:number,bpp:number,rowBytes:number){
  const out=Buffer.alloc(rowBytes*height);let input=0;
  for(let y=0;y<height;y++){
    const filter=raw[input++];
    const rowStart=y*rowBytes;
    const prevStart=(y-1)*rowBytes;
    for(let x=0;x<rowBytes;x++){
      const value=raw[input++];
      const left=x>=bpp?out[rowStart+x-bpp]:0;
      const up=y>0?out[prevStart+x]:0;
      const upLeft=y>0&&x>=bpp?out[prevStart+x-bpp]:0;
      let decoded=value;
      if(filter===1)decoded=(value+left)&255;
      else if(filter===2)decoded=(value+up)&255;
      else if(filter===3)decoded=(value+Math.floor((left+up)/2))&255;
      else if(filter===4)decoded=(value+paeth(left,up,upLeft))&255;
      else if(filter!==0)throw new Error(`Unsupported PNG filter: ${filter}`);
      out[rowStart+x]=decoded;
    }
  }
  return out;
}

function unpackSample(row:Buffer,x:number,bitDepth:number){
  if(bitDepth===8)return row[x];
  if(bitDepth===16)return row.readUInt16BE(x*2)>>>8;
  const perByte=8/bitDepth;
  const byte=row[Math.floor(x/perByte)];
  const shift=(perByte-1-(x%perByte))*bitDepth;
  const mask=(1<<bitDepth)-1;
  return ((byte>>shift)&mask)*255/mask;
}

export type PngAlphaBounds={x:number;y:number;width:number;height:number;opaquePixels:number};

export function pngAlphaBounds(buffer:Buffer):PngAlphaBounds{
  const cs=chunks(buffer);
  const ihdr=cs.find(c=>c.type==='IHDR')?.data;
  if(!ihdr)throw new Error('PNG missing IHDR');
  const width=ihdr.readUInt32BE(0),height=ihdr.readUInt32BE(4),bitDepth=ihdr[8],colorType=ihdr[9],interlace=ihdr[12];
  if(interlace!==0)throw new Error('Interlaced PNG is not supported by calibration scanner');
  const idat=Buffer.concat(cs.filter(c=>c.type==='IDAT').map(c=>c.data));
  const raw=inflateSync(idat);
  const channels=colorType===6?4:colorType===4?2:colorType===2?3:1;
  const bitsPerPixel=channels*bitDepth;
  const rowBytes=Math.ceil(width*bitsPerPixel/8);
  const bpp=Math.max(1,Math.ceil(bitsPerPixel/8));
  const scan=unfilter(raw,height,bpp,rowBytes);
  const trns=cs.find(c=>c.type==='tRNS')?.data;
  let minX=width,minY=height,maxX=-1,maxY=-1,opaquePixels=0;

  for(let y=0;y<height;y++){
    const row=scan.subarray(y*rowBytes,(y+1)*rowBytes);
    for(let x=0;x<width;x++){
      let alpha=255;
      if(colorType===6){
        const step=bitDepth===16?8:4;
        alpha=bitDepth===16?row.readUInt16BE(x*step+6)>>>8:row[x*step+3];
      }else if(colorType===4){
        const step=bitDepth===16?4:2;
        alpha=bitDepth===16?row.readUInt16BE(x*step+2)>>>8:row[x*step+1];
      }else if(colorType===3){
        const index=Math.round(unpackSample(row,x,bitDepth)*(2**bitDepth-1)/255);
        alpha=trns&&index<trns.length?trns[index]:255;
      }else if(colorType===2&&trns){
        const step=bitDepth===16?6:3;
        const r=bitDepth===16?row.readUInt16BE(x*step):row[x*step]*257;
        const g=bitDepth===16?row.readUInt16BE(x*step+2):row[x*step+1]*257;
        const b=bitDepth===16?row.readUInt16BE(x*step+4):row[x*step+2]*257;
        if(r===trns.readUInt16BE(0)&&g===trns.readUInt16BE(2)&&b===trns.readUInt16BE(4))alpha=0;
      }else if(colorType===0&&trns){
        const gray=Math.round(unpackSample(row,x,bitDepth)*257);
        if(gray===trns.readUInt16BE(0))alpha=0;
      }
      if(alpha===0)continue;
      opaquePixels++;
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
    }
  }

  if(maxX<minX||maxY<minY)return{x:0,y:0,width:1,height:1,opaquePixels:0};
  return{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1,opaquePixels};
}
