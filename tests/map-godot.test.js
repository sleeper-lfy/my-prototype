import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapGodotFiles } from '../server/mapGodot.js';
import { createVillageMap, isWalkable, getMapRenderLayers, getActorLayerId } from '../src/mapModel.js';

test('map export uses native TileMapLayer serialization and retains all stable IDs',()=>{
  const map=createVillageMap(),{files,assets}=createMapGodotFiles(map),mapping=JSON.parse(files['node-map.json']);
  assert.match(files['map.tscn'],/type="TileMapLayer"/);
  assert.match(files['map.tscn'],/tile_shape = 1\ntile_layout = 5/);
  assert.match(files['map.tscn'],/y_sort_enabled = true/);
  assert.equal(mapping.layers.length,map.layers.length);assert.equal(mapping.objects.length,map.objects.length);assert.equal(mapping.markers.length,map.markers.length);
  assert.equal(mapping.cellCount,map.layers.reduce((n,layer)=>n+Object.keys(layer.cells).length,0));
  let index=0;for(let y=0;y<map.grid.height;y++)for(let x=0;x<map.grid.width;x++)assert.equal(mapping.walkability[index++],isWalkable(map,x,y));
  for(const layer of mapping.layers){const body=files['map.tscn'].split(`metadata/studio_id = "${layer.id}"`)[0];const encoded=[...body.matchAll(/tile_map_data = PackedByteArray\(([^)]*)\)/g)].at(-1)[1];const bytes=Buffer.from(encoded.split(',').map(Number));assert.equal(bytes.readUInt16LE(0),0);assert.equal(bytes.length,2+layer.cells.length*12);layer.cells.forEach((cell,index)=>{const at=2+index*12;assert.equal(bytes.readInt16LE(at),cell.x);assert.equal(bytes.readInt16LE(at+2),cell.y);assert.equal(bytes.readUInt16LE(at+4),cell.sourceId);});}
  assert.ok(mapping.testPath.length>1);assert.ok(mapping.colliders.length>0);assert.equal(new Set(assets.map(asset=>asset.destination)).size,assets.length);
});

test('hidden objects stay hidden while collisions remain and cropped assets are preserved',()=>{
  const map=createVillageMap();const object=map.objects[0],layer=map.layers.find(item=>item.id===object.layerId),asset=map.assets.find(item=>item.id===object.assetId);
  layer.visible=false;asset.atlas={x:4,y:3,width:32,height:48};object.width=75.5;object.height=101.25;object.anchorX=.3;object.anchorY=.8;object.blocking=true;
  const{files}=createMapGodotFiles(map),mapping=JSON.parse(files['node-map.json']),entry=mapping.objects.find(item=>item.id===object.id);
  assert.equal(entry.visible,false);assert.deepEqual(entry.size,{x:75.5,y:101.25});assert.deepEqual(entry.offset,{x:-75.5*.3,y:-101.25*.8});
  assert.ok(mapping.colliders.find(item=>item.id===object.id));assert.match(files['map.tscn'],/studio_crop = Rect2i\(4, 3, 32, 48\)/);
  assert.match(files['sprite_display.gd'],/image\.get_region/);assert.match(files['map_runtime.gd'],/direct_space_state\.intersect_point/);
});

test('map export rejects malformed input and labels unsupported navigation/3D features',()=>{
  const map=createVillageMap();map.objects[0].assetId='missing';assert.throws(()=>createMapGodotFiles(map));
  const{files}=createMapGodotFiles(createVillageMap()),warnings=JSON.parse(files['export-warnings.json']);
  assert.ok(warnings.some(item=>item.code==='grid-navigation'));assert.ok(warnings.some(item=>item.code==='isometric-2d'));assert.match(files['project.godot'],/"4.3"/);
  assert.deepEqual(JSON.parse(files['map.json']),createVillageMap());
});

test('Godot preserves real layer bands, actor layer and multi-cell placement footprints',()=>{
  const map=createVillageMap();
  map.layers.push({id:'foreground',name:'Foreground',visible:true,locked:false,cells:{'12,6':'grass'}});
  map.actorLayerId='foreground';
  const asset=map.assets.find(item=>item.id==='house');
  map.objects.push({id:'placed-house',name:'Placed house',assetId:asset.id,layerId:'foreground',x:12,y:6,width:asset.width,height:asset.height,anchorX:.5,anchorY:1,blocking:true,footprint:structuredClone(asset.footprint)});
  map.objects[0].layerId=map.layers[0].id;
  const{files}=createMapGodotFiles(map),mapping=JSON.parse(files['node-map.json']),bands=getMapRenderLayers(map);
  for(const band of bands){assert.equal(mapping.layers.find(layer=>layer.id===band.layer.id).zIndex,band.terrainZ);for(const object of band.objects)assert.equal(mapping.objects.find(item=>item.id===object.id).zIndex,band.objectZ);}
  assert.equal(mapping.actorLayerId,getActorLayerId(map));assert.equal(mapping.actorZ,bands.at(-1).objectZ);
  assert.equal(mapping.actorVisible,true);assert.deepEqual(asset.footprint,{width:2,height:2});
  for(const[x,y]of[[12,6],[13,6],[12,7],[13,7]])assert.equal(mapping.walkability[y*map.grid.width+x],false);
  assert.ok(mapping.colliders.some(collider=>collider.id==='placed-house'));
  map.layers.at(-1).visible=false;
  const hidden=JSON.parse(createMapGodotFiles(map).files['node-map.json']);assert.equal(hidden.actorVisible,false);assert.equal(hidden.objects.find(item=>item.id==='placed-house').visible,false);assert.equal(hidden.walkability[6*map.grid.width+12],false);
});
