import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAnimationProject, renderAnimationFrame } from '../src/animationModel.js';
import { createAnimationGodotFiles } from '../server/animationGodot.js';
import { decodePng } from './compare-png.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/v0.4.0/animation-godot');
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
 const p=createAnimationProject();
 // Verify duration is genuinely variable, rather than implicitly fixed FPS.
 p.clips[0].frames[1].durationMs=175;
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
 const screenshot=decodePng(await fs.readFile(screenshotFile));
 if(screenshot.width!==256||screenshot.height!==416)throw Error('Unexpected viewport dimensions');
 const first=p.clips[0],frame=renderAnimationFrame(p,first.id,first.frames[0].id);
 let sampled=0,mismatched=0;
 for(let y=10;y<frame.height;y++)for(let x=0;x<frame.width;x++){
  const source=(y*frame.width+x)*4;if(frame.pixels[source+3]!==255)continue;
  const target=((y*4+2)*screenshot.width+x*4+2)*4;
  sampled++;if([0,1,2].some(c=>Math.abs(frame.pixels[source+c]-screenshot.rgba[target+c])>1))mismatched++;
 }
 report.screenshot={width:screenshot.width,height:screenshot.height,sampledOpaquePixels:sampled,mismatchedPixels:mismatched};
 if(sampled<50||mismatched!==0)throw Error('Rendered pixels do not match the model frame');
 report.passed=true;
 console.log('Animation Godot verified: actual playback, all frame durations, events, textures and pixel-matched screenshot.');
}catch(error){report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');await fs.rm(game,{recursive:true,force:true});}
