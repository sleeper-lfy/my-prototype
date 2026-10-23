# Phase 1 integration contract

The app is a local React + Konva editor served by Node, bound to 127.0.0.1:4380. No account or AI API. Node >=22.12 (24 LTS recommended). Source project: `examples/character.project.json`. Working copy: ignored `data/project.json`; imported assets in `data/assets/`. Immutable bundled originals in `public/assets/`. All modules are ESM JavaScript.

```js
{
  schemaVersion: 1, id: 'ashfall', name: 'Ashfall · Character dossier', revision: 1,
  canvas: {width: 960, height: 600, background: '#121719'},
  tokens: {colors: {gold:'#cfb779',ink:'#121719'}, fonts: {body:'Georgia'}, rules: ['...']},
  assets: [{id:'portrait',name:'The Warden',kind:'portrait',src:'/assets/warden.svg'},
           {id:'panel',name:'Panel',kind:'nineSlice',src:'/assets/panel.svg',margins:{left:12,top:12,right:12,bottom:12}}],
  nodes: [{id:'stable-id',name:'Recruit button',type:'Button',parentId:null,
    frame:{x:30,y:30,width:200,height:48},
    style:{fill:'#cfb779',stroke:'#e0cb98',strokeWidth:1,radius:3,color:'#161b1d',fontSize:18,fontFamily:'Georgia',text:'RECRUIT',align:'center',opacity:1},
    layout:{mode:'free',gap:12,padding:0},assetId:null,
    buttonAssets:{normal:'asset-id',hover:'asset-id',pressed:'asset-id'},
    locked:false,visible:true}],
  reviews:[{id:'review-1',nodeId:'stable-id',target:'Button label',expected:'Change to RECRUIT · 240',protectedProperties:['frame.x','frame.y','frame.width','frame.height'],priority:'high',status:'pending',createdAt:'ISO date'}],
  history:[]
}
```

Allowed node types: `Control`, `TextureRect`, `Label`, `Button`, `Panel`, `HBoxContainer`, `VBoxContainer`, `MarginContainer`. Groups use Control. Frame coordinates are parent-relative. Paint order is nodes array order among siblings. Parent graph is acyclic. A child of a Container gets its display position from its parent's layout, not its saved x/y; prohibit dragging those children and state why. Containers use gap/padding and child dimensions, with minimum dimensions preserved in Godot. Free layout Control does not override child frames.

Patch exchange (`examples/recruit.patch.json`):
```js
{schemaVersion:1, projectId:'ashfall', baseRevision:1, summary:'Improve recruitment CTA',
 reviewIds:['review-1'], changes:[{nodeId:'stable-id',set:{'style.text':'RECRUIT · 240'}}]}
```
Only explicit scalar property paths from an allowlist may change. Reject unknown paths, invalid values, changes to protected properties, unrelated nodes (must belong to listed pending reviews), missing IDs, duplicate changes to same property, locked nodes, and stale base revisions. Validate atomically before applying; append exact before/after diff to history, increment revision once and mark addressed reviews `modified`. User can advance to `review`, then `approved`. Approval is manual. Rollback verifies changed values still match patch output and restores originals; never silently overwrite subsequent edits.

Shared `src/model.js` exports (core agent owns): `validateProject(project)` (throws on invalid, returns project); `applyPatch(project,patch)` (immutable returns project); `rollbackPatch(project,historyId)` (immutable returns project); `buildFeedback(project,nodeScreenshots={})` returns object with projectId,baseRevision,reviews,nodes,context,tokens,assets (pending reviews only, stable IDs, parent context, restrictions); `computeLayout(project)` returns Map(nodeId -> absolute `{x,y,width,height}`); `makeId(prefix)`; `diffProjects(before,after)` returns field diff array. Pure model tests in tests/model.test.js.

Godot `server/godot.js` exports `createGodotFiles(project)` returning `{files: {'project.godot':'...', 'main.tscn':'...', 'capture.gd':'...', 'node-map.json':'...'}, assets:[{src:'/assets/warden.svg',destination:'assets/warden.svg'}]}`. No filesystem IO in this function. Correctly escape resources and strings. Root Control uses project's canvas size. Metadata studio_id on every exported design node. Static Theme/StyleBoxFlat for panel/button; TextureRect for assets; StyleBoxTexture for nineSlice Panel, texture button styles supported. Container layout semantics follow computed minimum sizes; represent padding with wrapper MarginContainer where necessary. Test script CLI uses real Godot and persists machine-readable runtime results and screenshot. Exporter agent owns server/godot.js, scripts/test-godot.js, tests/godot.test.js.

Server API (root agent owns): GET /api/project → project; PUT /api/project body project → project (atomic save, version conflict guard); POST /api/reset → sample; GET /api/example-patch → patch rebased to current revision when relevant target is present; POST /api/patch body patch → updated project; POST /api/rollback body {historyId} → project; POST /api/feedback body {baseRevision,screenshots:{nodeId:'data:image/png;base64,...'}} → {path,downloadUrl,count}; POST /api/godot → {path,downloadUrl}; POST /api/assets body {name,kind,dataUrl} → asset (stored file; client adds record to project). GET /api/files/:name for ZIP downloads. POST /api/import body project → project with server revision. Every mutation error returns status >=400 and {error: message}. APIs require JSON and reject cross-origin requests. Body cap 30MB. Public read assets from /assets and /local-assets. Keep both server disk state and frontend synced after each saved edit. Server revision CAS uses request revision = disk revision + 1 for UI edits; patch uses baseRevision. Feedback rejects screenshots from a stale baseRevision. Import/save checks asset files exist before replacing the working document.

Frontend (UI agent owns src/App.jsx, src/styles.css, src/main.jsx, index.html): render true Konva nodes; layer selection; drag/resize; zoom/pan; snapping; multi-select; align/group/duplicate; lock; undo/redo; property editing; assets/tokens; review form + statuses; feedback ZIP export; patch file import + sample patch; before/after field history + safe rollback; JSON import/export; Godot ZIP. Reuse model computeLayout. Vite root repository; API served by same Node process. No separate frontend process required. No image-only drag demo.
