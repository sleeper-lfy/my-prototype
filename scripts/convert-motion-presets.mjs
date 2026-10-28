/** Reproducible glTF skeletal-track → projected 2D motion conversion (no runtime dependencies). */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'research/animation-sources/robot-expressive');
const bytes = await fs.readFile(path.join(base, 'RobotExpressive.glb'));
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== '047f5e5fb3bb6d378bd1df16ca6137f2a596c99b3a1b5690b4020c05aaf6f319') throw Error('Source asset checksum differs from the reviewed CC0 source');
if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw Error('Expected glTF 2 GLB');
const jsonLength = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
const binary = bytes.subarray(28 + jsonLength);
const sourceCommit = '68a2712f9d130e8e9813488228dfef3509920fb2';
const sourceRoot = `https://github.com/mrdoob/three.js/blob/${sourceCommit}/examples/models/gltf/RobotExpressive/`;
const source = {
  id: 'robot-expressive', author: 'Tomás Laulhé / Quaternius', modifications: 'Don McCurdy: FBX2glTF conversion, facial morph targets and material cleanup',
  license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: sourceRoot + 'README.md',
  assetUrl: sourceRoot + 'RobotExpressive.glb', upstreamCommit: sourceCommit, sha256, sourceFormat: 'glTF 2.0',
  conversion: 'glTF local quaternion SLERP + translation interpolation → global skeletal segment positions → XY / ZY orthographic projection → 13-bone pixel rig. Original body translation is scaled to a 64-pixel standing skeleton height; no contact IK or gameplay events are inferred. Depth and foreshortening are lost.',
};
const components = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
function accessor(index) {
  const a = gltf.accessors[index], b = gltf.bufferViews[a.bufferView];
  if (a.componentType !== 5126 || a.sparse || b.buffer !== 0) throw Error('This fixed source must use dense Float32 accessors');
  const size = components[a.type], stride = b.byteStride || size * 4, start = (b.byteOffset || 0) + (a.byteOffset || 0);
  return Array.from({length:a.count},(_,i)=>Array.from({length:size},(_,j)=>binary.readFloatLE(start+i*stride+j*4)));
}
const parents = new Map(); gltf.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parents.set(c,i)));
const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function mul(a,b) { const out=Array(16).fill(0); for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return out; }
function trs(node) {
  if(node.matrix)return node.matrix;
  const [x,y,z,w]=node.rotation||[0,0,0,1], [sx,sy,sz]=node.scale||[1,1,1], [tx,ty,tz]=node.translation||[0,0,0];
  return [(1-2*y*y-2*z*z)*sx,(2*x*y+2*z*w)*sx,(2*x*z-2*y*w)*sx,0,(2*x*y-2*z*w)*sy,(1-2*x*x-2*z*z)*sy,(2*y*z+2*x*w)*sy,0,(2*x*z+2*y*w)*sz,(2*y*z-2*x*w)*sz,(1-2*x*x-2*y*y)*sz,0,tx,ty,tz,1];
}
function positions(nodes) { const matrices=new Map(); const get=i=>{if(!matrices.has(i))matrices.set(i,mul(parents.has(i)?get(parents.get(i)):identity,trs(nodes[i])));return matrices.get(i);}; return nodes.map((_,i)=>get(i).slice(12,15)); }
function slerp(a,b,t) { let dot=a.reduce((s,v,i)=>s+v*b[i],0);if(dot<0){b=b.map(v=>-v);dot=-dot;}let out;if(dot>.9995)out=a.map((v,i)=>v+(b[i]-v)*t);else{const theta=Math.acos(Math.min(1,dot)),sin=Math.sin(theta);out=a.map((v,i)=>(v*Math.sin((1-t)*theta)+b[i]*Math.sin(t*theta))/sin);}const n=Math.hypot(...out);return out.map(v=>v/n); }
function valueAt(track,time) {
  const times=track.times;let right=times.findIndex(v=>v>=time);if(right<0)return track.values.at(-1);if(right===0)return track.values[0];
  const left=right-1,t=(time-times[left])/(times[right]-times[left]);
  if(track.interpolation==='STEP')return track.values[left];
  if(track.interpolation!=='LINEAR')throw Error('Unsupported source interpolation');
  return track.path==='rotation'?slerp(track.values[left],track.values[right],t):track.values[left].map((v,i)=>v+(track.values[right][i]-v)*t);
}
const segments={torso:[8,11,-90],head:[11,14,-90],leftUpperArm:[17,19,106],leftForearm:[19,20,85],rightUpperArm:[37,39,74],rightForearm:[39,40,95],leftThigh:[55,57,90],leftShin:[57,59,90],leftFoot:[3,5,0],rightThigh:[60,62,90],rightShin:[62,64,90],rightFoot:[67,69,0]};
const round=v=>Math.round(v*1000)/1000, wrap=v=>((v+180)%360+360)%360-180;
const rest=positions(gltf.nodes), standingHeight=rest[14][1]-Math.min(rest[5][1],rest[69][1]);
const pixelScale=64/standingHeight;
const presets=[];
for(const [name,action,loop] of [['Idle','idle',true],['Walking','walk',true],['Running','walk',true],['Punch','attack',false]]) {
  const animation=gltf.animations.find(a=>a.name===name);if(!animation)throw Error('Missing source clip '+name);
  const tracks=animation.channels.filter(c=>c.target.path!=='weights').map(c=>{const s=animation.samplers[c.sampler];return {node:c.target.node,path:c.target.path,interpolation:s.interpolation||'LINEAR',times:accessor(s.input).map(v=>v[0]),values:accessor(s.output)};});
  const duration=Math.max(...tracks.map(t=>t.times.at(-1))), samples=Math.max(13,Math.ceil(duration*24)+1);
  const poses=Array.from({length:samples},(_,i)=>{const nodes=gltf.nodes.map(n=>({...n}));for(const t of tracks)nodes[t.node][t.path]=valueAt(t,i/(samples-1)*duration);return positions(nodes);});
  const framesByDirection={};
  for(const [direction,horizontal,sign] of [['down',0,1],['up',0,-1],['right',2,1],['left',2,-1]]) {
    let previous={};
    framesByDirection[direction]=poses.map((world,i)=>{
      const pose={};
      for(const [id,[a,b,targetAngle]] of Object.entries(segments)) {
        const dx=(world[b][horizontal]-world[a][horizontal])*sign,dy=-(world[b][1]-world[a][1]);
        const length=Math.hypot(...world[b].map((v,j)=>v-world[a][j]));
        // End-on bones have no defined projected orientation; retain their previous measured orientation.
        const delta=Math.hypot(dx,dy)<length*.035?(previous[id]??0):wrap(Math.atan2(dy,dx)*180/Math.PI-targetAngle);
        pose[id]=round(delta);
      }
      previous=pose;
      return {time:round(i/(samples-1)),pose,root:{x:round((world[6][horizontal]-poses[0][6][horizontal])*sign*pixelScale),y:round(-(world[6][1]-poses[0][6][1])*pixelScale)},contacts:[]};
    });
  }
  presets.push({id:'quaternius-'+name.toLowerCase(),name,action,loop,durationMs:round(duration*1000),source:{...source,clip:name,trackCount:tracks.length,sampleCount:samples},framesByDirection,frames:framesByDirection.down});
}
const licenseNotice = 'RobotExpressive model and skeletal animations by Tomás Laulhé / Quaternius. Modifications by Don McCurdy. Licensed CC0 1.0 according to the upstream README: '+source.url+'\nFixed upstream commit: '+sourceCommit+'\nAsset SHA-256: '+sha256+'\nCanonical license: '+source.licenseUrl+'\n\n'+await fs.readFile(path.join(base,'CC0-1.0.txt'),'utf8');
const output='/** Generated by scripts/convert-motion-presets.mjs from the pinned CC0 RobotExpressive asset. */\nexport const MOTION_SOURCE = '+JSON.stringify(source,null,2)+';\nexport const MOTION_LICENSE_NOTICE = '+JSON.stringify(licenseNotice)+';\nexport const MOTION_PRESETS = '+JSON.stringify(presets)+';\n';
const outputFile=path.join(root,'src/motionPresets.js');
if(process.argv.includes('--check')) {if(await fs.readFile(outputFile,'utf8')!==output)throw Error('Generated motion presets differ; rerun converter');console.log('Motion presets reproduce exactly from pinned source');}
else await fs.writeFile(outputFile,output);
await fs.writeFile(path.join(base,'manifest.json'),JSON.stringify({source,bytes:bytes.length,pixelScale,segments:Object.fromEntries(Object.entries(segments).map(([name,[a,b,angle]])=>[name,{fromNode:a,from:gltf.nodes[a].name,toNode:b,to:gltf.nodes[b].name,targetRestAngle:angle}])),presets:presets.map(p=>({id:p.id,clip:p.source.clip,durationMs:p.durationMs,trackCount:p.source.trackCount,sampleCount:p.source.sampleCount})),outputSha256:createHash('sha256').update(output).digest('hex')},null,2)+'\n');
console.log(JSON.stringify(presets.map(p=>({id:p.id,durationMs:p.durationMs,samples:p.source.sampleCount})),null,2));
