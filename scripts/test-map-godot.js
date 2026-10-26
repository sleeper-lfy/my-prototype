import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { createMapGodotFiles } from '../server/mapGodot.js';
import { decodePng, comparePng } from './compare-png.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const option=(name,fallback)=>{const index=args.indexOf(name);if(index>=0&&!args[index+1])throw new Error(`Missing ${name} value`);return index<0?fallback:args[index+1];};
const source=path.resolve(root,option('--project','examples/village.map.json'));
const artifacts=path.resolve(root,option('--out','artifacts/v0.2.0/godot-map'));
const dataDir=path.resolve(root,option('--data-dir',process.env.STUDIO_DATA_DIR||'data'));
const executable=process.env.GODOT_BIN||'godot';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const summary={startedAt:new Date().toISOString(),passed:false,source:path.relative(root,source),checks:[],screenshot:{status:'not-run'},comparison:{status:'not-requested'}};
await fs.mkdir(artifacts,{recursive:true});
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'studio-map-godot-'));
const exported=path.join(temporary,'project');
await fs.mkdir(exported);
const env={...process.env,XDG_DATA_HOME:path.join(temporary,'data'),XDG_CONFIG_HOME:path.join(temporary,'config'),XDG_CACHE_HOME:path.join(temporary,'cache')};
const run=(name,params)=>{
  const result=spawnSync(executable,params,{env,cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
  summary.checks.push({name,exitCode:result.status,signal:result.signal,error:result.error?.message,stdout:result.stdout,stderr:result.stderr});
  if(result.status!==0||result.error||/SCRIPT ERROR|Parse Error|Failed to load script|^ERROR:/m.test(result.stderr||''))throw new Error(`${name} failed: ${result.error?.message||result.stderr||result.stdout}`);
  return result;
};

async function captureEditorReference(project, mapping) {
  // Use the editor's actual React/Konva MapScene, not a second approximation of
  // its drawing algorithm. Isolated cached harness files never alter user data.
  const directory=path.join(root,'.cache',path.basename(temporary));
  await fs.mkdir(directory,{recursive:true});
  const relative=path.relative(root,directory).split(path.sep).join('/');
  await fs.writeFile(path.join(directory,'map.json'),JSON.stringify(project));
  await fs.writeFile(path.join(directory,'mapping.json'),JSON.stringify(mapping));
  await fs.writeFile(path.join(directory,'index.html'),'<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:1280px;height:800px;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="./entry.jsx"></script></body></html>');
  await fs.writeFile(path.join(directory,'entry.jsx'),`import React from 'react';
import {createRoot} from 'react-dom/client';
import {Stage,Layer,Group,Rect} from 'react-konva';
import {MapScene} from '/src/MapWorkspace.jsx';
const project=await fetch('./map.json').then(r=>r.json());
const mapping=await fetch('./mapping.json').then(r=>r.json());
const images={};
await Promise.all(project.assets.map(asset=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{images[asset.src]=image;resolve();};image.onerror=()=>reject(new Error('Missing image '+asset.src));image.src=asset.src;})));
const origin=mapping.transform.origin,zoom=mapping.transform.zoom;
function Reference(){React.useEffect(()=>{requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__mapReferenceReady=true;}));},[]);return <Stage width={1280} height={800}><Layer><Rect width={1280} height={800} fill={mapping.viewport.background}/><Group x={origin.x} y={origin.y} scaleX={zoom} scaleY={zoom}><MapScene project={project} images={images} editable={false} showMarkers={false}/></Group></Layer></Stage>;}
createRoot(document.getElementById('root')).render(<Reference/>);
`);
  const {createServer}=await import('vite');
  const server=await createServer({root,configFile:false,cacheDir:path.join(temporary,'vite-cache'),logLevel:'error',optimizeDeps:{entries:[path.join(directory,'entry.jsx')]},server:{host:'127.0.0.1',port:0},plugins:[{name:'studio-map-reference-assets',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
    const asset=project.assets.find(item=>item.src===req.url&&item.src.startsWith('/local-assets/'));
    if(!asset)return next();
    try{const content=await fs.readFile(path.join(dataDir,'assets',asset.src.slice('/local-assets/'.length)));const extension=asset.src.split('.').pop().toLowerCase();res.setHeader('Content-Type',extension==='svg'?'image/svg+xml':`image/${extension==='jpg'?'jpeg':extension}`);res.end(content);}catch{res.statusCode=404;res.end('Missing local asset');}
  });}}]});
  const reference=path.join(artifacts,'editor-reference.png');
  try{
    await server.listen();
    const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}/${relative}/index.html`;
    const python=`import sys, os, shutil\nfrom playwright.sync_api import sync_playwright\nwith sync_playwright() as p:\n browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN') or shutil.which('chromium') or shutil.which('chromium-browser'),headless=True,args=['--no-sandbox'])\n page=browser.new_page(viewport={'width':1280,'height':800},device_scale_factor=1)\n errors=[]\n page.on('pageerror',lambda error:errors.append(str(error)))\n page.goto(sys.argv[1],wait_until='networkidle')\n page.wait_for_function('window.__mapReferenceReady === true',timeout=30000)\n if errors: raise RuntimeError(str(errors))\n page.locator('canvas').first.screenshot(path=sys.argv[2])\n browser.close()\n`;
    await new Promise((resolve,reject)=>{
      const child=spawn(process.env.PYTHON_BIN||(process.platform==='win32'?'python':'python3'),['-c',python,url,reference],{env,stdio:['ignore','pipe','pipe']});
      let output='';const timeout=setTimeout(()=>{child.kill();reject(new Error('Editor reference browser timed out.'));},60000);
      child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
      child.on('error',error=>{clearTimeout(timeout);reject(error);});child.on('close',code=>{clearTimeout(timeout);if(code!==0)reject(new Error(`Editor reference failed: ${output}`));else resolve();});
    });
    summary.checks.push({name:'actual editor MapScene rendered in Chromium',exitCode:0,source:'src/MapWorkspace.jsx',overlays:'markers, selection and preview player hidden'});
    return reference;
  }finally{await server.close();await fs.rm(directory,{recursive:true,force:true});}
}
try{
  const bytes=await fs.readFile(source),project=JSON.parse(bytes);
  summary.project={id:project.id,revision:project.revision,sourceSha256:sha256(bytes),layerCount:project.layers.length,objectCount:project.objects.length};
  await fs.writeFile(path.join(artifacts,'source-map.json'),bytes);
  summary.project.snapshot=path.relative(root,path.join(artifacts,'source-map.json'));
  const generated=createMapGodotFiles(project),zipFiles={};
  const automaticReference=args.includes('--compare-editor')?await captureEditorReference(project,JSON.parse(generated.files['node-map.json'])):null;
  for(const[name,content]of Object.entries(generated.files)){await fs.mkdir(path.dirname(path.join(exported,name)),{recursive:true});await fs.writeFile(path.join(exported,name),content);zipFiles[name]=strToU8(content);}
  summary.assets=[];
  for(const asset of generated.assets){
    const original=asset.src.startsWith('/local-assets/')?path.join(dataDir,'assets',asset.src.slice('/local-assets/'.length)):path.join(root,'public',asset.src);
    const content=await fs.readFile(original);
    await fs.mkdir(path.dirname(path.join(exported,asset.destination)),{recursive:true});await fs.writeFile(path.join(exported,asset.destination),content);zipFiles[asset.destination]=content;
    summary.assets.push({...asset,sha256:sha256(content),bytes:content.length});
  }
  zipFiles['ARTWORK-LICENSE.txt']=await fs.readFile(path.join(root,'LICENSE'));
  const archive=zipSync(zipFiles,{level:6});await fs.writeFile(path.join(artifacts,'godot-map.zip'),archive);
  summary.archive={path:path.relative(root,path.join(artifacts,'godot-map.zip')),sha256:sha256(archive),bytes:archive.length};
  await fs.writeFile(path.join(artifacts,'node-map.json'),generated.files['node-map.json']);
  await fs.writeFile(path.join(artifacts,'export-warnings.json'),generated.files['export-warnings.json']);
  const headless=path.join(artifacts,'headless.json'),render=path.join(artifacts,'render.json'),screenshot=path.join(artifacts,'map.png');
  for(const file of[headless,render,screenshot])await fs.rm(file,{force:true});
  const version=run('version',['--version']);summary.godot=version.stdout.trim();
  run('import',['--headless','--editor','--path',exported,'--import']);
  run('headless scene, navigation and physics',['--headless','--path',exported,'--audio-driver','Dummy','--','--studio-verify',`--studio-result=${headless}`]);
  summary.headless=JSON.parse(await fs.readFile(headless));
  if(!summary.headless.passed||summary.headless.projectId!==project.id||summary.headless.revision!==project.revision)throw new Error('Runtime validation does not match the source map.');
  if(args.includes('--headless-only'))summary.screenshot={status:'explicitly-skipped',note:'No rendered screenshot verified.'};
  else{
    if(process.platform==='linux'&&!process.env.DISPLAY&&!process.env.WAYLAND_DISPLAY)throw new Error('A graphical display is required; set DISPLAY or use --headless-only to explicitly skip rendering.');
    run('rendered map and movement',['--path',exported,'--audio-driver','Dummy','--rendering-method','gl_compatibility','--','--studio-verify',`--studio-result=${render}`,`--studio-screenshot=${screenshot}`,...(args.includes('--map-only')||automaticReference?['--studio-map-only']:[])]);
    summary.render=JSON.parse(await fs.readFile(render));
    const png=await fs.readFile(screenshot),image=decodePng(png);
    if(!summary.render.passed||!summary.render.screenshot.written||image.width!==1280||image.height!==800)throw new Error('Rendered map verification failed.');
    const colors=new Set();for(let at=0;at<image.rgba.length;at+=4)colors.add(`${image.rgba[at]},${image.rgba[at+1]},${image.rgba[at+2]}`);
    if(source===path.join(root,'examples/village.map.json')&&colors.size<100)throw new Error('Rendered sample image lacks expected village content.');
    summary.screenshot={status:'passed',path:path.relative(root,screenshot),width:image.width,height:image.height,sha256:sha256(png),uniqueColors:colors.size,mode:args.includes('--map-only')||automaticReference?'map-only':'with-preview-player'};
    const reference=automaticReference||option('--reference',null);
    if(reference){const referenceBytes=await fs.readFile(path.resolve(root,reference));const compared=comparePng(referenceBytes,png);await fs.writeFile(path.join(artifacts,'difference.png'),compared.differencePng);summary.comparison={status:'measured',reference:path.relative(root,path.resolve(root,reference)),referenceSha256:sha256(referenceBytes),...compared.metrics,referenceSource:automaticReference?'actual-editor-MapScene':'user-supplied',note:'SVG rasterization and texture filtering can differ. Numeric fidelity is separate from art approval; manually supplied references must match the exported revision.'};}
  }
  summary.passed=true;console.log(`Godot map ${project.id} verified: ${summary.headless.cellCount} cells, ${summary.headless.physicsBlockedCells} blocked cells, ${summary.headless.walkedSteps} walking steps. Screenshot: ${summary.screenshot.status}.`);
}catch(error){summary.error=error.message;console.error(error.message);process.exitCode=1;}
finally{summary.finishedAt=new Date().toISOString();await fs.writeFile(path.join(artifacts,'results.json'),JSON.stringify(summary,null,2)+'\n');await fs.rm(temporary,{recursive:true,force:true});}
