import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillageMap, validateMap, isWalkable, isCellWalkable, findPath, getMapRenderLayers, moveMapObject, getActorWalkability } from '../src/mapModel.js';
import { analyzeMapPlayability, objectOccludesActor } from '../src/mapPlayability.js';
import { createMapGodotFiles } from '../server/mapGodot.js';
import { transformBlock } from '../src/studioFeatures.js';

function fixture() {
  const map=createVillageMap();map.grid.width=8;map.grid.height=8;
  for(const layer of map.layers)layer.cells={};
  map.objects=[];map.blocked=[];map.markers=[{id:'spawn',type:'spawn',name:'Spawn',x:0,y:0},{id:'exit',type:'exit',name:'Exit',x:7,y:7}];
  map.reviews=[];return map;
}
test('actor footprint cannot squeeze through a one-cell passage and bounds reject its full size',()=>{
  const map=fixture();map.blocked=Array.from({length:8},(_,y)=>`3,${y}`).filter(k=>k!=='3,4');
  assert.ok(findPath(map,{x:0,y:0},{x:7,y:7}).length);
  map.playability={actor:{width:2,height:2}};
  assert.equal(findPath(map,{x:0,y:0},{x:6,y:6}).length,0);
  assert.equal(isWalkable(map,7,6),false);
  const flags=getActorWalkability(map);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)assert.equal(Boolean(flags[y*8+x]),isWalkable(map,x,y));
});
test('occupancy, collision and occlusion stay independent and movement preserves their relative coordinates',()=>{
  const map=fixture();const object={id:'house',name:'House',assetId:'house',layerId:'decoration',x:2,y:2,width:160,height:160,anchorX:.5,anchorY:1,blocking:true,footprint:{width:3,height:3},collision:{x:1,y:1,width:1,height:1},occlusion:{x:-1,y:0,width:4,height:2,depthOffset:2,fade:true}};map.objects.push(object);
  validateMap(map);assert.equal(isCellWalkable(map,2,2),true);assert.equal(isCellWalkable(map,3,3),false);
  assert.equal(objectOccludesActor(object,{x:1,y:2}),true);assert.equal(objectOccludesActor(object,{x:5,y:2}),false);
  const moved=moveMapObject(map,{objectId:'house',x:3,y:3});
  assert.deepEqual(moved.objects[0].collision,object.collision);assert.equal(isCellWalkable(moved,4,4),false);assert.equal(isCellWalkable(moved,3,3),true);
  assert.throws(()=>moveMapObject(map,{objectId:'house',x:0,y:0}),/occlusion region/);
  assert.equal(map.objects[0].x,2);
});
test('one reachability report covers all exits, blocked spawn, adjacent interactions and revision',()=>{
  const map=fixture();map.blocked=['7,7','4,4'];map.markers.push({id:'interact',name:'Chest',type:'interaction',x:4,y:4},{id:'exit-ok',name:'Door',type:'exit',x:6,y:6});
  const report=analyzeMapPlayability(map);assert.equal(report.passed,false);assert.equal(report.revision,map.revision);
  assert.equal(report.destinations.find(d=>d.markerId==='exit').reachable,false);
  assert.equal(report.destinations.find(d=>d.markerId==='interact').reachable,true);
  const end=report.destinations.find(d=>d.markerId==='interact').route.at(-1);assert.equal(Math.abs(end.x-4)+Math.abs(end.y-4),1);
  assert.ok(report.destinations.find(d=>d.markerId==='exit-ok').route.length);
  map.blocked.push('0,0');assert.ok(analyzeMapPlayability(map).issues.some(i=>i.code==='blocked-spawn'));
});
test('region validation rejects fractional cells, outside map geometry and invalid actor footprints',()=>{
  const map=fixture();map.playability={actor:{width:1.5,height:1}};assert.throws(()=>validateMap(map),/actor footprint/);
  map.playability.actor.width=9;assert.throws(()=>validateMap(map),/actor footprint/);
  map.playability.actor.width=1;const original=createVillageMap().objects.find(o=>o.assetId==='house');map.objects=[{...original,x:2,y:2,collision:{x:0,y:0,width:1.5,height:1}}];
  assert.throws(()=>validateMap(map),/collision region/);map.objects[0].collision={x:0,y:0,width:7,height:1};assert.throws(()=>validateMap(map),/collision region/);
});
test('native export includes actor footprint, independent collider and occlusion anchors without moving artwork',()=>{
  const map=fixture();map.playability={actor:{width:2,height:1}};map.markers[1].x=6;
  const source=createVillageMap().objects.find(o=>o.assetId==='house');map.objects=[{...source,x:2,y:2,collision:{x:0,y:1,width:2,height:1},occlusion:{x:0,y:0,width:3,height:2,depthOffset:1,fade:true}}];
  const {files}=createMapGodotFiles(map),mapping=JSON.parse(files['node-map.json']),entry=mapping.objects[0];
  assert.deepEqual(mapping.actorFootprint,{width:2,height:1});assert.deepEqual(entry.collision,map.objects[0].collision);assert.equal(entry.position.y+entry.offset.y,(2+2)*map.grid.tileHeight/2-map.objects[0].height*map.objects[0].anchorY);
  assert.match(files['map_runtime.gd'],/actor_size/);assert.match(files['map_runtime.gd'],/KEY_E/);assert.ok(JSON.parse(files['playability-report.json']).destinations.length);
  assert.equal(mapping.collisionCells.filter(Boolean).length,2);assert.equal(getMapRenderLayers(map).find(b=>b.layer.id==='decoration').objects[0].id,source.id);
});
test('map block rotation and mirror transform relative collision and occlusion rectangles',()=>{
  const block={kind:'map-block',width:4,height:4,grid:{tileWidth:64,tileHeight:32},layers:[],assets:[],blocked:[],markers:[],objects:[{id:'o',assetId:'a',x:0,y:0,footprint:{width:2,height:3},collision:{x:1,y:0,width:1,height:2},occlusion:{x:0,y:0,width:2,height:3,depthOffset:1,fade:true}}]};
  const rotated=transformBlock(block,{rotation:90}).objects[0];
  assert.deepEqual(rotated.footprint,{width:3,height:2});assert.deepEqual(rotated.collision,{x:1,y:1,width:2,height:1});assert.equal(rotated.occlusion.fade,true);
  const mirrored=transformBlock(block,{mirror:true}).objects[0];assert.deepEqual(mirrored.collision,{x:0,y:0,width:1,height:2});
});
