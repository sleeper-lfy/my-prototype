import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectGodotImport,buildGodotSourceUpdate,previewGodotMerge} from '../src/godotImport.js';
import {inspectPixelImage,buildAssetIndex,planAssetUpdate} from '../src/assetInspection.js';
import {previewTaskPatch} from '../src/codexTasks.js';
import fs from 'node:fs/promises';
const scene='[gd_scene format=3]\n[node name="Root" type="Control"]\noffset_right = 640.0\noffset_bottom = 480.0\n[node name="Title" type="Label" parent="."]\noffset_right = 200.0\noffset_bottom = 40.0\ntext = "Before"\n[node name="Custom" type="Node" parent="."]\nmetadata/business = "retain"\n';
test('Godot readback edits supported text while preserving unknown nodes and detects external conflicts',()=>{
 const p=inspectGodotImport(scene).project;assert.equal(p.nodes.length,2);p.nodes[1].style.text='After';
 const result=buildGodotSourceUpdate(p,scene);assert.equal(result.canExport,true);assert.match(result.text,/text = "After"/);assert.match(result.text,/metadata\/business = "retain"/);
 const conflict=buildGodotSourceUpdate(p,scene.replace('"Before"','"External"'));assert.ok(conflict.conflicts.length);assert.equal(conflict.canExport,false);
 const incoming=structuredClone(p);incoming.nodes[1].style.text='Merged';p.nodes[1].locked=true;assert.ok(previewGodotMerge(p,incoming).conflicts.length);
});
test('asset checks find fractional scales and edge/palette anomalies; replacement preserves stable IDs',async()=>{
 const ui=JSON.parse(await fs.readFile(new URL('../examples/character.project.json',import.meta.url)));const snapshot={ui};const index=buildAssetIndex(snapshot);assert.ok(index.some(e=>e.references.length));
 const entry=index.find(e=>e.assetKind!=='font');const next=planAssetUpdate(snapshot,entry.key,{provenance:{author:'Author',license:'CC0',source:'local',notes:''}});assert.deepEqual(next.project.nodes,ui.nodes);assert.equal(next.project.assets.find(a=>a.id===entry.assetId).provenance.license,'CC0');
 const result=inspectPixelImage({width:2,height:1,pixels:[255,0,0,128,0,0,0,0]},{palette:['#000000']});assert.ok(result.fringe);assert.ok(result.outsidePalette);
});
test('Codex task patch stays scoped and rejects stale revisions',async()=>{
 const ui=JSON.parse(await fs.readFile(new URL('../examples/character.project.json',import.meta.url)));const patch=JSON.parse(await fs.readFile(new URL('../examples/recruit.patch.json',import.meta.url)));patch.baseRevision=ui.revision;const task={kind:'ui',projectId:ui.id,baseRevision:ui.revision,reviewIds:patch.reviewIds,status:'exported'};
 const result=previewTaskPatch(task,ui,patch);assert.ok(result.summary.changedFields);assert.equal(result.artAcceptance,'manual');patch.baseRevision++;assert.throws(()=>previewTaskPatch(task,ui,patch),/changed/);
});
