import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { createGodotFiles } from '../server/godot.js';
import { comparePng, decodePng } from './compare-png.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const source=path.resolve(root,option('--project','examples/character.project.json'));
const artifacts=path.resolve(root,option('--out','artifacts'));
const out=path.join(artifacts,'godot-project');
const godot=process.env.GODOT_BIN || 'godot';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const summary={startedAt:new Date().toISOString(),source:path.relative(root,source),passed:false,checks:[],screenshot:{status:'not-run'},comparison:{status:'not-requested'}};
await fs.mkdir(artifacts,{recursive:true});
await fs.mkdir(out,{recursive:true});
const cache=path.join(root,'.cache','godot');
for(const dir of ['data','config','cache'])await fs.mkdir(path.join(cache,dir),{recursive:true});
const env={...process.env,XDG_DATA_HOME:path.join(cache,'data'),XDG_CONFIG_HOME:path.join(cache,'config'),XDG_CACHE_HOME:path.join(cache,'cache')};
const run=(name,commandArgs)=>{
  const run=spawnSync(godot,commandArgs,{env,cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
  const result={name,exitCode:run.status,signal:run.signal,error:run.error?.message,stdout:run.stdout,stderr:run.stderr};
  summary.checks.push(result);
  if(run.status!==0||run.error)throw new Error(`${name} failed: ${run.error?.message||run.stderr||run.stdout}`);
  return result;
};
try {
  const sourceBytes=await fs.readFile(source);
  const project=JSON.parse(sourceBytes.toString('utf8'));
  summary.project={id:project.id,revision:project.revision,nodeCount:project.nodes.length,sourceSha256:sha256(sourceBytes)};
  const generated=createGodotFiles(project);
  const zipFiles={};
  for(const [filename,content] of Object.entries(generated.files)){
    await fs.mkdir(path.dirname(path.join(out,filename)),{recursive:true});
    await fs.writeFile(path.join(out,filename),content);zipFiles[filename]=strToU8(content);
  }
  for(const asset of generated.assets){
    const assetFile=asset.src.startsWith('/local-assets/')?path.join(root,'data','assets',asset.src.slice('/local-assets/'.length)):path.join(root,'public',asset.src);
    const bytes=await fs.readFile(assetFile);
    await fs.mkdir(path.dirname(path.join(out,asset.destination)),{recursive:true});
    await fs.writeFile(path.join(out,asset.destination),bytes);zipFiles[asset.destination]=bytes;
  }
  const licenseFile=path.join(root,'public','assets','FONT-LICENSE.txt');
  try{const license=await fs.readFile(licenseFile);await fs.writeFile(path.join(out,'FONT-LICENSE.txt'),license);zipFiles['FONT-LICENSE.txt']=license;}catch(error){if(error.code!=='ENOENT')throw error;}
  const artworkLicense=await fs.readFile(path.join(root,'LICENSE'));
  await fs.writeFile(path.join(out,'ARTWORK-LICENSE.txt'),artworkLicense);zipFiles['ARTWORK-LICENSE.txt']=artworkLicense;
  await fs.writeFile(path.join(artifacts,'godot-export.zip'),zipSync(zipFiles));
  const headlessResult=path.join(artifacts,'godot-headless.json');
  const renderResult=path.join(artifacts,'godot-render.json');
  const screenshot=path.join(artifacts,'godot.png');
  for(const target of [headlessResult,renderResult,screenshot])await fs.rm(target,{force:true});
  run('version',['--version']);
  run('import',['--headless','--editor','--path',out,'--import']);
  run('headless scene validation',['--headless','--path',out,'--audio-driver','Dummy','--','--studio-verify',`--studio-result=${headlessResult}`]);
  summary.headless=JSON.parse(await fs.readFile(headlessResult,'utf8'));
  if(!summary.headless.passed||summary.headless.nodeCount!==project.nodes.length)throw new Error('Headless validation did not check all design nodes');
  const graphical=process.platform!=='linux'||Boolean(process.env.DISPLAY)||Boolean(process.env.WAYLAND_DISPLAY);
  if(args.includes('--headless-only'))summary.screenshot={status:'explicitly-skipped',note:'Only node assertions were requested; image rendering is not verified.'};
  else {
    if(!graphical)throw new Error('Screenshot requires a desktop display. On Linux set DISPLAY to Xorg/Xvfb; on Windows run from your desktop. Use --headless-only only if you explicitly intend to skip rendering.');
    run('rendered scene validation',['--path',out,'--audio-driver','Dummy','--rendering-method','gl_compatibility','--','--studio-verify',`--studio-result=${renderResult}`,`--studio-screenshot=${screenshot}`]);
    summary.render=JSON.parse(await fs.readFile(renderResult,'utf8'));
    const bytes=await fs.readFile(screenshot),image=decodePng(bytes);
    if(!summary.render.passed||!summary.render.screenshot.written||image.width!==project.canvas.width||image.height!==project.canvas.height)throw new Error('Rendered validation or screenshot dimensions failed');
    summary.screenshot={status:'passed',path:path.relative(root,screenshot),width:image.width,height:image.height,sha256:sha256(bytes)};
    const reference=option('--reference',null);
    if(reference){
      const referenceBytes=await fs.readFile(path.resolve(root,reference));
      const compared=comparePng(referenceBytes,bytes);
      await fs.writeFile(path.join(artifacts,'godot-difference.png'),compared.differencePng);
      summary.comparison={status:'measured',reference,referenceSha256:sha256(referenceBytes),...compared.metrics};
    }
  }
  summary.passed=true;
  console.log(`Godot verified ${project.nodes.length} nodes. Screenshot: ${summary.screenshot.status}.`);
} catch(error) { summary.error=error.message;console.error(error.message);process.exitCode=1; }
finally {summary.finishedAt=new Date().toISOString();await fs.writeFile(path.join(artifacts,'godot-results.json'),JSON.stringify(summary,null,2));}
