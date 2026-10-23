import { inflateSync, deflateSync } from 'node:zlib';

// Small dependency-free decoder for the non-interlaced 8-bit RGB/RGBA PNGs
// emitted by Chromium and Godot. Rejects unsupported inputs explicitly.
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG signature');
  let width, height, channels;
  const idat = [];
  for (let at = 8; at < buffer.length;) {
    const size = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const chunk = buffer.subarray(at + 8, at + 8 + size);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      if (chunk[8] !== 8 || ![2,6].includes(chunk[9]) || chunk[12] !== 0) throw new Error('Comparison requires non-interlaced 8-bit RGB/RGBA PNG');
      channels = chunk[9] === 6 ? 4 : 3;
    }
    if (type === 'IDAT') idat.push(chunk);
    at += size + 12;
  }
  if (!width || !height || !channels || width * height > 30000000) throw new Error('Invalid/oversized PNG');
  const packed = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (packed.length !== (stride + 1) * height) throw new Error('PNG data size mismatch');
  const raw = Buffer.alloc(stride * height);
  const paeth = (a,b,c) => { const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); return pa<=pb&&pa<=pc?a:pb<=pc?b:c; };
  for (let y=0;y<height;y++) {
    const filter = packed[y*(stride+1)];
    if (filter>4) throw new Error('Invalid PNG row filter');
    for (let x=0;x<stride;x++) {
      const at=y*stride+x, left=x>=channels?raw[at-channels]:0, up=y?raw[at-stride]:0, upperLeft=y&&x>=channels?raw[at-stride-channels]:0;
      const predictor = [0,left,up,Math.floor((left+up)/2),paeth(left,up,upperLeft)][filter];
      raw[at]=(packed[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  const rgba=Buffer.alloc(width*height*4);
  for(let pixel=0;pixel<width*height;pixel++) { raw.copy(rgba,pixel*4,pixel*channels,pixel*channels+3);rgba[pixel*4+3]=channels===4?raw[pixel*channels+3]:255; }
  return {width,height,rgba};
}

function crc32(buffer) { let crc=0xffffffff;for(const b of buffer){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
export function encodePng({width,height,rgba}) {
  const chunk=(type,data)=>{const kind=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([kind,data])));return Buffer.concat([len,kind,data,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const rows=Buffer.alloc(height*(width*4+1));
  for(let y=0;y<height;y++)rgba.copy(rows,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

export function comparePng(referenceBuffer, actualBuffer) {
  const reference=decodePng(referenceBuffer),actual=decodePng(actualBuffer);
  if(reference.width!==actual.width||reference.height!==actual.height)throw new Error(`Screenshot size mismatch: reference ${reference.width}x${reference.height}, Godot ${actual.width}x${actual.height}`);
  const diff=Buffer.alloc(actual.rgba.length);let total=0,changed=0,large=0;
  for(let p=0;p<actual.width*actual.height;p++){
    let largest=0;
    for(let c=0;c<3;c++){const d=Math.abs(reference.rgba[p*4+c]-actual.rgba[p*4+c]);total+=d;largest=Math.max(largest,d);diff[p*4+c]=Math.min(255,d*4);}
    if(largest>0)changed++;if(largest>25)large++;diff[p*4+3]=255;
  }
  const pixels=actual.width*actual.height;
  return {metrics:{width:actual.width,height:actual.height,meanAbsoluteError:total/(pixels*3*255),changedPixelRatio:changed/pixels,over10PercentDifferenceRatio:large/pixels,pixelPerfect:changed===0,note:'Numerical comparison only. Font rasterization and nine-slice sampling can differ; independent visual acceptance is required.'},differencePng:encodePng({width:actual.width,height:actual.height,rgba:diff})};
}
