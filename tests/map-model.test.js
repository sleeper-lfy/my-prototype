import test from 'node:test';
import assert from 'node:assert/strict';
import { createVillageMap, validateMap, isoToScreen, screenToIso, isWalkable, findPath, applyMapPatch, previewMapPatch, rollbackMapPatch, buildMapFeedback, getAssetFootprint, planMapPlacement, moveMapObject, getActorLayerId, getMapRenderLayers } from '../src/mapModel.js';
const copy = value => structuredClone(value);
function reviewed() {
  const map = createVillageMap();
  map.reviews.push({ id: 'tree-review', target: { type: 'object', objectId: 'tree-01' }, targetText: 'Move the tree away from the entrance', expected: 'Keep its size and move left', protectedProperties: ['width', 'height', 'assetId'], priority: 'high', status: 'pending', createdAt: new Date().toISOString() });
  map.reviews.push({ id: 'road-review', target: { type: 'region', layerId: 'roads', x: 6, y: 10, width: 4, height: 4 }, targetText: 'Widen the road', expected: 'Add a safe walkable edge', protectedProperties: [], priority: 'medium', status: 'pending', createdAt: new Date().toISOString() });
  return map;
}
function patch(map, changes = [{ type: 'object', objectId: 'tree-01', set: { x: 4 } }], reviewIds = ['tree-review']) {
  return { schemaVersion: 1, kind: 'studio-map-patch', projectId: map.id, baseRevision: map.revision, summary: 'Local map improvements', reviewIds, changes };
}

test('map sample is valid and isometric projection round-trips grid and fractional positions', () => {
  const map = createVillageMap();
  assert.equal(validateMap(map), map);
  for (const p of [{ x: 0, y: 0 }, { x: 15, y: 9 }, { x: 2.5, y: 8.25 }]) {
    const screen = isoToScreen(p.x, p.y, map.grid);
    assert.deepEqual(screenToIso(screen.x, screen.y, map.grid), p);
  }
});

test('map validation rejects unsafe JSON, bounds, atlas metadata, references and invalid footprints', () => {
  const invalid = [
    map => { map.grid.width = 129; },
    map => { map.layers[0].cells['-1,0'] = 'grass'; },
    map => { map.layers[0].cells['01,0'] = 'grass'; },
    map => { map.layers[0].cells['0,0'] = 'tree'; },
    map => { map.objects[0].x = 15; },
    map => { map.objects[0].assetId = 'grass'; },
    map => { map.assets[0].src = '/assets/../outside.png'; },
    map => { map.assets[0].atlas = { x: -1, y: 0, width: 64, height: 32 }; },
    map => { map.blocked.push(map.blocked[0]); },
    map => { map.layers[0].cells = JSON.parse('{"__proto__":"grass"}'); },
  ];
  for (const mutate of invalid) { const map = createVillageMap(); mutate(map); assert.throws(() => validateMap(map)); }
});

test('navigation avoids water and complete building footprints and finds a gate-to-exit route', () => {
  const map = createVillageMap();
  assert.equal(isWalkable(map, 4, 4), false);
  assert.equal(isWalkable(map, 12, 10), false);
  assert.equal(isWalkable(map, -1, 0), false);
  const route = findPath(map, { x: 7, y: 14 }, { x: 7, y: 0 });
  assert.equal(route.length, 15);
  assert.ok(route.every(p => isWalkable(map, p.x, p.y)));
  assert.deepEqual(findPath(map, { x: 7, y: 14 }, { x: 4, y: 4 }), []);
  map.layers.find(layer => layer.id === 'decoration').visible = false;
  assert.equal(isWalkable(map, 4, 4), false, 'hidden art does not disable collision');
});

test('review-scoped object patch previews without mutation, applies stable IDs and rolls back only its fields', () => {
  const map = reviewed(); const initial = copy(map); const proposal = patch(map);
  const preview = previewMapPatch(map, proposal);
  assert.deepEqual(map, initial);
  assert.equal(preview.changes[0].before, 5);
  assert.equal(preview.changes[0].after, 4);
  assert.equal(preview.changes[0].index, 0);
  const applied = applyMapPatch(map, proposal);
  assert.equal(applied.objects.find(o => o.id === 'tree-01').x, 4);
  assert.equal(applied.reviews[0].status, 'modified');
  applied.name = 'Unrelated later edit';
  const rolled = rollbackMapPatch(applied, applied.history[0].id);
  assert.equal(rolled.objects.find(o => o.id === 'tree-01').x, 5);
  assert.equal(rolled.name, 'Unrelated later edit');
  assert.equal(rolled.reviews[0].status, 'pending');
  assert.throws(() => rollbackMapPatch(rolled, rolled.history[0].id), /rolled back/);
});

test('partial acceptance records selected diffs and leaves comments pending', () => {
  const map = reviewed();
  const proposal = patch(map, [{ type: 'object', objectId: 'tree-01', set: { x: 4 } }, { type: 'cell', layerId: 'roads', x: 6, y: 12, assetId: 'path' }], ['tree-review', 'road-review']);
  const applied = applyMapPatch(map, proposal, { selectedIndices: [1] });
  assert.equal(applied.objects.find(o => o.id === 'tree-01').x, 5);
  assert.equal(applied.layers.find(l => l.id === 'roads').cells['6,12'], 'path');
  assert.ok(applied.reviews.every(r => r.status === 'pending'));
  assert.equal(applied.history[0].partial, true);
  assert.equal(applied.history[0].changes.length, 1);
  assert.throws(() => applyMapPatch(map, proposal, { selectedIndices: [] }), /indices/);
  assert.throws(() => applyMapPatch(map, proposal, { selectedIndices: [1, 1] }), /indices/);
});

test('region patches support paint, erase and collision changes with conflict-safe rollback', () => {
  const map = reviewed();
  const proposal = patch(map, [{ type: 'cell', layerId: 'roads', x: 6, y: 12, assetId: 'path' }, { type: 'cell', layerId: 'roads', x: 7, y: 12, assetId: null }, { type: 'blocked', x: 9, y: 12, value: true }], ['road-review']);
  const applied = applyMapPatch(map, proposal);
  assert.equal(applied.layers[1].cells['6,12'], 'path');
  assert.equal(applied.layers[1].cells['7,12'], undefined);
  assert.ok(applied.blocked.includes('9,12'));
  const rolled = rollbackMapPatch(applied, applied.history[0].id);
  assert.deepEqual(rolled.layers, map.layers);
  assert.deepEqual(rolled.blocked, map.blocked);
  applied.layers[1].cells['6,12'] = 'water';
  assert.throws(() => rollbackMapPatch(applied, applied.history[0].id), /conflict/);
});

test('patch rejects stale identity, unreviewed edits, duplicate fields, locked layers and protected fields', () => {
  const map = reviewed();
  assert.throws(() => applyMapPatch(map, { ...patch(map), baseRevision: 0 }), /Stale/);
  assert.throws(() => applyMapPatch(map, { ...patch(map), projectId: 'different' }), /belong/);
  assert.throws(() => applyMapPatch(map, patch(map, [{ type: 'object', objectId: 'tree-02', set: { x: 4 } }])), /scope/);
  assert.throws(() => applyMapPatch(map, patch(map, [{ type: 'object', objectId: 'tree-01', set: { width: 100 } }])), /Protected/);
  assert.throws(() => applyMapPatch(map, patch(map, [{ type: 'object', objectId: 'tree-01', set: { id: 'new' } }])), /patchable/);
  assert.throws(() => applyMapPatch(map, patch(map, [patch(map).changes[0], patch(map).changes[0]])), /Duplicate/);
  map.layers.find(layer => layer.id === 'decoration').locked = true;
  assert.throws(() => applyMapPatch(map, patch(map)), /locked/);
});

test('other unresolved reviews protect object paths and overlapping region collision changes', () => {
  const map = reviewed();
  map.reviews.push({ ...copy(map.reviews[0]), id: 'older-tree-review', status: 'modified', protectedProperties: ['x'] });
  assert.throws(() => applyMapPatch(map, patch(map)), /Protected/);
  map.reviews.push({ ...copy(map.reviews[1]), id: 'overlapping-review', status: 'review', target: { type: 'region', layerId: 'ground', x: 8, y: 11, width: 2, height: 2 }, protectedProperties: ['blocked'] });
  assert.throws(() => applyMapPatch(map, patch(map, [{ type: 'blocked', x: 9, y: 12, value: true }], ['road-review'])), /Protected/);
  const feedback = buildMapFeedback(map);
  assert.ok(feedback.constraints.some(c => c.reviewId === 'overlapping-review'));
  assert.ok(feedback.constraints.some(c => c.reviewId === 'older-tree-review'));
  assert.equal(feedback.reviews.length, 2);
});

test('outside-region edits and invalid unselected changes reject atomically', () => {
  const map = reviewed(); const original = copy(map);
  assert.throws(() => applyMapPatch(map, patch(map, [{ type: 'cell', layerId: 'roads', x: 5, y: 12, assetId: 'path' }], ['road-review'])), /scope/);
  assert.throws(() => applyMapPatch(map, patch(map, [{ type: 'cell', layerId: 'ground', x: 6, y: 12, assetId: 'path' }], ['road-review'])), /scope/);
  const proposal = patch(map, [{ type: 'object', objectId: 'tree-01', set: { x: 99 } }, { type: 'cell', layerId: 'roads', x: 6, y: 12, assetId: 'path' }], ['tree-review', 'road-review']);
  assert.throws(() => applyMapPatch(map, proposal, { selectedIndices: [1] }), /object/);
  assert.deepEqual(map, original);
});

test('feedback is compact, includes pending crops metadata and excludes unrelated cells and assets', () => {
  const map = reviewed();
  map.reviews[0].status = 'approved';
  const feedback = buildMapFeedback(map);
  assert.deepEqual(feedback.reviews.map(r => r.id), ['road-review']);
  assert.ok(feedback.layers.every(l => Object.keys(l.cells).every(key => { const [x, y] = key.split(',').map(Number); return x >= 6 && x < 10 && y >= 10 && y < 14; })));
  assert.ok(!feedback.assets.some(a => a.id === 'house'));
  assert.ok(!JSON.stringify(feedback).includes('house-01'));
});

test('collision rollback respects the reviewed layer lock and malformed history is rejected', () => {
  const map = reviewed();
  const applied = applyMapPatch(map, patch(map, [{ type: 'blocked', x: 9, y: 12, value: true }], ['road-review']));
  applied.layers.find(layer => layer.id === 'roads').locked = true;
  assert.throws(() => rollbackMapPatch(applied, applied.history[0].id), /locked/);
  applied.layers.find(layer => layer.id === 'roads').locked = false;
  delete applied.history[0].changes[0].before;
  assert.throws(() => rollbackMapPatch(applied, applied.history[0].id), /history/);
});

test('navigation handles the maximum grid through one collision bitmap', () => {
  const map = createVillageMap();
  map.grid.width = 128; map.grid.height = 128; map.blocked = []; map.objects = [];
  for (let x = 0; x < 127; x++) map.blocked.push(`${x},64`);
  const route = findPath(map, { x: 0, y: 0 }, { x: 0, y: 127 });
  assert.equal(route.length, 382);
  assert.ok(route.some(p => p.x === 127 && p.y === 64));
});


test('map asset footprints are integer cell units with backward-compatible one-cell defaults', () => {
  const map = createVillageMap();
  assert.deepEqual(getAssetFootprint(map.assets.find(a => a.id === 'house')), { width: 2, height: 2 });
  const legacy = structuredClone(map); for (const asset of legacy.assets) delete asset.footprint;
  assert.equal(validateMap(legacy), legacy);
  assert.deepEqual(getAssetFootprint(legacy.assets[0]), { width: 1, height: 1 });
  for (const footprint of [{ width: 1.5, height: 2 }, { width: 0, height: 2 }, { width: 1, height: 129 }]) {
    const invalid = structuredClone(map); invalid.assets[0].footprint = footprint;
    assert.throws(() => validateMap(invalid), /footprint/);
  }
  map.assets[0].footprint = { width: 128, height: 128 };
  assert.equal(validateMap(map), map, 'larger library assets can exist but cannot be placed beyond map bounds');
  assert.throws(() => planMapPlacement(map, { assetId: 'grass', layerId: 'ground', x: 0, y: 0 }), /bounds/);
});

test('palette placement returns a complete tile stamp or correctly sized object without mutating the map', () => {
  const map = createVillageMap(); const before = structuredClone(map);
  const stamp = planMapPlacement(map, { assetId: 'stone', layerId: 'roads', x: 2, y: 3, footprint: { width: 2, height: 3 } });
  assert.equal(stamp.type, 'tile'); assert.equal(stamp.layerId, 'roads');
  assert.deepEqual(stamp.cells, [{ x: 2, y: 3, assetId: 'stone' }, { x: 3, y: 3, assetId: 'stone' }, { x: 2, y: 4, assetId: 'stone' }, { x: 3, y: 4, assetId: 'stone' }, { x: 2, y: 5, assetId: 'stone' }, { x: 3, y: 5, assetId: 'stone' }]);
  const building = planMapPlacement(map, { assetId: 'house', layerId: 'decoration', x: 8, y: 8 });
  assert.equal(building.type, 'object');
  assert.deepEqual(building.object.footprint, { width: 2, height: 2 });
  assert.equal(building.object.width, 160); assert.equal(building.object.height, 160);
  assert.deepEqual(map, before);
  map.objects.push(building.object);
  assert.ok(!isWalkable(map, 8, 8) && !isWalkable(map, 9, 9));
  assert.ok(isWalkable(map, 10, 9));
});

test('oversized palette drops reject atomically and locked layers block tile and object placement', () => {
  const map = createVillageMap(); const initial = structuredClone(map);
  assert.throws(() => planMapPlacement(map, { assetId: 'house', layerId: 'decoration', x: 15, y: 15 }), /bounds/);
  assert.throws(() => planMapPlacement(map, { assetId: 'stone', layerId: 'roads', x: 15, y: 14, footprint: { width: 2, height: 3 } }), /bounds/);
  assert.deepEqual(map, initial, 'no partial stamps at an edge');
  map.layers[1].locked = true; map.layers[3].locked = true;
  assert.throws(() => planMapPlacement(map, { assetId: 'grass', layerId: 'roads', x: 5, y: 5 }), /locked/);
  assert.throws(() => planMapPlacement(map, { assetId: 'tree', layerId: 'decoration', x: 5, y: 5 }), /locked/);
});

test('object movement snaps to whole cells and reassigns layers while preserving stable reviews and art dimensions', () => {
  const map = reviewed(); const initial = structuredClone(map);
  const moved = moveMapObject(map, { objectId: 'tree-01', layerId: 'roads', x: 4, y: 11, footprint: { width: 2, height: 3 } });
  const object = moved.objects.find(o => o.id === 'tree-01');
  assert.equal(object.layerId, 'roads'); assert.equal(object.x, 4); assert.equal(object.y, 11);
  assert.deepEqual(object.footprint, { width: 2, height: 3 });
  assert.equal(object.width, 96); assert.equal(object.height, 128);
  assert.equal(moved.reviews[0].target.objectId, object.id);
  assert.deepEqual(map, initial);
  assert.throws(() => moveMapObject(map, { objectId: 'tree-01', x: 1.5 }), /bounds/);
  assert.throws(() => moveMapObject(map, { objectId: 'house-01', x: 15, y: 15 }), /bounds/);
  map.layers[1].locked = true;
  assert.throws(() => moveMapObject(map, { objectId: 'tree-01', layerId: 'roads' }), /locked/);
  map.layers[1].locked = false; map.layers[3].locked = true;
  assert.throws(() => moveMapObject(map, { objectId: 'tree-01', layerId: 'roads' }), /locked/);
});


test('layer bands interleave terrain and objects in explicit layer order with stable foot sorting', () => {
  const map = createVillageMap();
  const tree = map.objects.find(o => o.id === 'tree-01'); tree.layerId = 'roads';
  const bands = getMapRenderLayers(map);
  assert.deepEqual(bands.map(b => [b.layer.id, b.terrainZ, b.objectZ]), [['ground', 0, 1], ['roads', 2, 3], ['water-layer', 4, 5], ['decoration', 6, 7]]);
  assert.equal(bands[1].objects[0].id, tree.id);
  assert.ok(bands[3].objects.every((object, index, list) => index === 0 || object.x + object.y >= list[index - 1].x + list[index - 1].y));
  assert.equal(bands[3].actor, true);
  const changed = structuredClone(map); [changed.layers[1], changed.layers[3]] = [changed.layers[3], changed.layers[1]];
  const reordered = getMapRenderLayers(changed);
  assert.equal(reordered[3].layer.id, 'roads'); assert.equal(reordered[3].objects[0].id, tree.id);
  assert.equal(reordered[1].actor, true, 'character remains associated with stable layer ID');
  assert.equal(map.layers[1].id, 'roads', 'render helper does not mutate map');
});

test('actor layer validates references, defaults for older documents and respects independent collision visibility', () => {
  const map = createVillageMap();
  delete map.actorLayerId;
  assert.equal(getActorLayerId(map), 'decoration');
  map.actorLayerId = 'roads';
  assert.equal(validateMap(map), map);
  assert.equal(getActorLayerId(map), 'roads');
  assert.equal(getMapRenderLayers(map).find(b => b.actor).layer.id, 'roads');
  map.layers.find(layer => layer.id === 'decoration').visible = false;
  assert.equal(isWalkable(map, 3, 3), false, 'layer visibility does not erase collision');
  map.actorLayerId = 'missing-layer';
  assert.throws(() => validateMap(map), /character layer/);
  assert.throws(() => getActorLayerId(map), /character layer/);
  delete map.actorLayerId;
  map.layers.find(layer => layer.id === 'decoration').id = 'props';
  for (const object of map.objects) object.layerId = 'props';
  assert.equal(getActorLayerId(map), 'props');
});
