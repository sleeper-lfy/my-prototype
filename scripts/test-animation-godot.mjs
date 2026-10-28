import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAnimationProject, renderAnimationFrame, getAnimationRenderBounds, applyMotionPreset } from '../src/animationModel.js';
import { MOTION_PRESETS } from '../src/motionPresets.js';
import { createAnimationGodotFiles } from '../server/animationGodot.js';
import { decodePng } from './compare-png.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/v0.4.1/animation-godot');
const game=await fs.mkdtemp(path.join(os.tmpdir(),'studio-animation-godot-'));
const report={passed:false,nativeWindows:false,checks:[],artApproval:'pending independent visual review'};
const resultFile=path.join(out,'runtime.json'),screenshotFile=path.join(out,'animation.png');
await fs.mkdir(out,{recursive:true});
await Promise.all([resultFile,screenshotFile].map(f=>fs.rm(f,{force:true})));
const run=(label,args)=>{
 const r=spawnSync(process.env.GODOT_BIN||'godot',args,{encoding:'utf8',timeout:120000,env:{...process.env,XDG_DATA_HOME:path.join(game,'userdata'),XDG_CONFIG_HOME:path.join(game,'config'),XDG_CACHE_HOME:path.join(game,'cache')}});
 report.checks.push({label,status:r.status,stdout:r.stdout,stderr:r.stderr});
 if(r.status!==0||/SCRIPT ERROR|Parse Error|^ERROR:/m.test(r.stderr||''))throw Error(label+': '+(r.stderr||r.error));
};
try{
 const initial=createAnimationProject();
 const p=applyMotionPreset(initial,MOTION_PRESETS[0].id,initial.clips[0].id);
 report.motionSource=p.clips[0].motionSource;
 // Verify duration is genuinely variable, rather than implicitly fixed FPS.
 p.clips[0].frames[1].durationMs=175;
 const attack=p.clips.find(c=>c.id==='attack-right')||p.clips.find(c=>c.action==='attack');
 attack.frames[3].root.x += 80; attack.frames[3].root.y -= 70;
 const bounds=getAnimationRenderBounds(p);
 if(bounds.x>=0&&bounds.y>=0||bounds.x+bounds.width<=64)throw Error('Test must extend outside body reference');
 const generated=createAnimationGodotFiles(p);
 for(const [name,bytes]of Object.entries(generated.files)){
  const dest=path.join(game,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes);
 }
 await fs.writeFile(path.join(out,'animation-map.json'),generated.files['animation-map.json']);
 run('engine version',['--version']);
 run('import native resources',['--headless','--editor','--path',game,'--import']);
 run('play and capture exported scene',['--path',game,'--audio-driver','Dummy','--rendering-method','gl_compatibility','--','--studio-verify','--studio-result='+resultFile,'--studio-screenshot='+screenshotFile]);
 report.runtime=JSON.parse(await fs.readFile(resultFile,'utf8'));
 if(!report.runtime.passed)throw Error('Runtime verification failed');
 const checkScreenshot=async(file,clip,index)=>{
  const screenshot=decodePng(await fs.readFile(file));
  if(screenshot.width!==bounds.width*4+32||screenshot.height!==bounds.height*4+64)throw Error('Unexpected expanded viewport dimensions');
  const frame=renderAnimationFrame(p,clip.id,clip.frames[index].id,bounds);
  let sampled=0,mismatched=0,outsideBodyPixels=0;
  for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
   const source=(y*frame.width+x)*4;if(frame.pixels[source+3]!==255)continue;
   const target=((48+y*4+2)*screenshot.width+16+x*4+2)*4;
   sampled++;if([0,1,2].some(c=>Math.abs(frame.pixels[source+c]-screenshot.rgba[target+c])>1))mismatched++;
   const worldX=x+bounds.x,worldY=y+bounds.y;
   if(worldX<0||worldX>=64||worldY<0||worldY>=96)outsideBodyPixels++;
  }
  if(sampled<50||mismatched!==0)throw Error('Rendered pixels do not match the expanded model frame');
  return {width:screenshot.width,height:screenshot.height,sampledOpaquePixels:sampled,mismatchedPixels:mismatched,outsideBodyPixels,origin:frame.origin};
 };
 report.screenshot=await checkScreenshot(screenshotFile,p.clips[0],0);
 const attackScreenshot=path.join(out,'attack-outside-body.png');
 const attackResult=path.join(out,'attack-runtime.json');
 await Promise.all([attackScreenshot,attackResult].map(f=>fs.rm(f,{force:true})));
 run('capture attack beyond body reference',['--path',game,'--audio-driver','Dummy','--rendering-method','gl_compatibility','--','--studio-verify','--studio-result='+attackResult,'--studio-screenshot='+attackScreenshot,'--studio-capture-clip='+attack.id,'--studio-capture-frame=3']);
 report.attackScreenshot=await checkScreenshot(attackScreenshot,attack,3);
 if(report.attackScreenshot.outsideBodyPixels===0)throw Error('Attack pixels outside body were not preserved');
 if(JSON.stringify(report.attackScreenshot.origin)!==JSON.stringify(report.screenshot.origin))throw Error('Origin changed between idle and attack');
 report.bodyReference=p.canvas;report.renderBounds=bounds;
 report.passed=true;
 console.log('Animation Godot verified: actual playback, all frame durations, events, shared origin, expanded attack bounds and pixel-matched screenshots.');
}catch(error){report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');await fs.rm(game,{recursive:true,force:true});}
