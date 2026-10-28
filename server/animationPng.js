import { zlibSync } from 'fflate';
function crc32(bytes) { let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
/** Lossless RGBA encoder. No scaling, palette conversion, or external process. */
export function encodeAnimationPng({width,height,pixels}) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>512||height>512||pixels.length!==width*height*4)throw Error('Invalid animation PNG dimensions');
  const chunk=(name,data)=>{const type=Buffer.from(name),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([size,type,data,crc]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const stride=width*4,raw=Buffer.alloc(height*(stride+1));
  for(let y=0;y<height;y++)raw.set(pixels.subarray?pixels.subarray(y*stride,(y+1)*stride):pixels.slice(y*stride,(y+1)*stride),y*(stride+1)+1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlibSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
