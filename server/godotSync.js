import { createHash } from "node:crypto";
import { createGodotFiles } from "./godot.js";
import { createMapGodotFiles } from "./mapGodot.js";
const hash = (b) => createHash("sha256").update(b).digest("hex");
export function planGodotSync(previous, incoming, actual) {
  const paths = new Set([
    ...Object.keys(previous.files || {}),
    ...Object.keys(incoming.files || {}),
  ]);
  return [...paths].sort().map((path) => {
    if (
      !/^studio_generated\/[A-Za-z0-9_./-]+$/.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Invalid managed Godot path.");
    const old = previous.files?.[path],
      next = incoming.files?.[path],
      now = actual[path];
    return {
      path,
      action:
        next === now
          ? "unchanged"
          : now !== undefined && now !== old
            ? "conflict"
            : next
              ? "write"
              : "delete",
      before: old ?? null,
      current: now ?? null,
      after: next ?? null,
    };
  });
}
export const syncScript = `import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),at=args.indexOf('--project');
if(at<0||!args[at+1])throw new Error('Usage: node sync.mjs --project <Godot-folder> [--apply] [--accept studio_generated/path]');
const root=await fs.realpath(path.resolve(args[at+1])),source=path.dirname(fileURLToPath(import.meta.url));
for(const name of ['.studio-sync.json','.studio-backups']){try{if((await fs.lstat(path.join(root,name))).isSymbolicLink())throw new Error('Symlink in update metadata path.');}catch(e){if(e.code!=='ENOENT')throw e;}}
const sha=b=>createHash('sha256').update(b).digest('hex');
const incoming=JSON.parse(await fs.readFile(path.join(source,'incoming-manifest.json')));
let previous={files:{}};try{previous=JSON.parse(await fs.readFile(path.join(root,'.studio-sync.json')));}catch(e){if(e.code!=='ENOENT')throw e;}
const paths=[...new Set([...Object.keys(previous.files||{}),...Object.keys(incoming.files)])].sort(),plan=[];
for(const name of paths){
 if(!/^studio_generated\\/[A-Za-z0-9_./-]+$/.test(name)||name.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Unsafe managed path');
 let cursor=root;for(const segment of name.split('/')){cursor=path.join(cursor,segment);try{if((await fs.lstat(cursor)).isSymbolicLink())throw new Error('Symlink in managed path');}catch(e){if(e.code!=='ENOENT')throw e;}}
 let current;try{current=sha(await fs.readFile(path.join(root,name)));}catch(e){if(e.code!=='ENOENT')throw e;}
 const before=previous.files?.[name],after=incoming.files[name];
 plan.push({path:name,action:current===after?'unchanged':current!==undefined&&current!==before?'conflict':after?'write':'delete',current:current??null,after:after??null});
}
console.log(JSON.stringify({plan,userFilesOutsideManagedDirectory:'preserved'},null,2));
if(args.includes('--apply')){
 const accepted=new Set(args.flatMap((v,i)=>v==='--accept'?[args[i+1]]:[]));
 if(plan.some(p=>p.action==='conflict'&&!accepted.has(p.path)))throw new Error('Unaccepted conflicts. Preview and pass --accept <exact-path> for each reviewed conflict.');
 for(const item of plan.filter(p=>p.after!==null&&p.action!=='unchanged')){const bytes=await fs.readFile(path.join(source,'incoming',item.path));if(sha(bytes)!==item.after)throw new Error('Incoming checksum mismatch: '+item.path);}
 const backup=path.join(root,'.studio-backups',new Date().toISOString().replace(/[:.]/g,'-'));
 for(const item of plan.filter(p=>p.action!=='unchanged')){
  const dest=path.join(root,item.path);if(item.current!==null){const data=await fs.readFile(dest);if(sha(data)!==item.current)throw new Error('File changed after preview: '+item.path);await fs.mkdir(path.dirname(path.join(backup,item.path)),{recursive:true});await fs.writeFile(path.join(backup,item.path),data);}
  if(item.after!==null){await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(source,'incoming',item.path),dest);}else await fs.rm(dest,{force:true});
 }
 await fs.writeFile(path.join(root,'.studio-sync.json'),JSON.stringify(incoming,null,2));
 try{await fs.access(path.join(root,'project.godot'));}catch{await fs.copyFile(path.join(source,'starter-project.godot'),path.join(root,'project.godot'));}
 console.log(JSON.stringify({applied:true,backup}));
}
`;
export async function createWorkspaceGodot(workspace, readAsset, options = {}) {
  const files = {},
    activeUI =
      workspace.uiPages.find((p) => p.id === workspace.activeUIId) ||
      workspace.uiPages[0],
    activeMap =
      workspace.maps.find((p) => p.id === workspace.activeMapId) ||
      workspace.maps[0],
    useMap = options.kind === "map" ? !!activeMap : !activeUI;
  for (const [kind, documents] of [
    ["ui", workspace.uiPages],
    ["maps", workspace.maps],
  ])
    for (const doc of documents) {
      const generated =
          kind === "ui" ? createGodotFiles(doc) : createMapGodotFiles(doc),
        prefix = `studio_generated/${kind}/${doc.id}/`;
      for (const [name, text] of Object.entries(generated.files)) {
        if (name === "project.godot") continue;
        files[prefix + name] = Buffer.from(
          text.replaceAll("res://", `res://${prefix}`),
        );
      }
      for (const asset of generated.assets)
        files[prefix + asset.destination] = await readAsset(asset.src);
    }
  const manifest = {
    schemaVersion: 1,
    projectId: workspace.id,
    files: Object.fromEntries(
      Object.entries(files).map(([name, b]) => [name, hash(b)]),
    ),
  };
  const first = useMap
    ? `studio_generated/maps/${activeMap.id}/map.tscn`
    : `studio_generated/ui/${activeUI.id}/main.tscn`;
  const width = useMap ? 1280 : activeUI.canvas.width;
  const height = useMap ? 800 : activeUI.canvas.height;
  const starter = `config_version=5\n\n[application]\nconfig/name=${JSON.stringify(workspace.name)}\nrun/main_scene=${JSON.stringify("res://" + first)}\n\n[display]\nwindow/size/viewport_width=${width}\nwindow/size/viewport_height=${height}\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n`;
  return {
    files,
    manifest,
    starter,
    syncScript,
  };
}
