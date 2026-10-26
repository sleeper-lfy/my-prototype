/** Independent isometric-map document, review and navigation model. */
import { makeId } from './model.js';
const clone = value => structuredClone(value);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const num = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isInteger(value) && num(value, min, max);
const text = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const statuses = ['pending', 'modified', 'review', 'approved'];
export const MAP_OBJECT_FIELDS = Object.freeze(['name', 'assetId', 'x', 'y', 'width', 'height', 'anchorX', 'anchorY', 'blocking', 'footprint.width', 'footprint.height']);
const restrictions = [...MAP_OBJECT_FIELDS, 'footprint', 'id', 'layerId', 'cells', 'blocked'];
function assertJson(value, depth = 0) {
  if (depth > 32) fail('Map document is too deeply nested.');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('Invalid map number.'); return; }
  if (typeof value !== 'object' || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail('Map must contain only JSON values.');
  for (const key of Object.keys(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Unsafe map property.');
    assertJson(value[key], depth + 1);
  }
}
function records(items, name, max) {
  if (!Array.isArray(items) || items.length > max) fail(`Invalid map ${name} list.`);
  const indexed = new Map();
  for (const item of items) {
    if (!record(item) || !id(item.id) || indexed.has(item.id)) fail(`Invalid or duplicate map ${name} ID.`);
    indexed.set(item.id, item);
  }
  return indexed;
}
function cell(key, grid) {
  if (typeof key !== 'string' || !/^(0|[1-9]\d*),(0|[1-9]\d*)$/.test(key)) return false;
  const [x, y] = key.split(',').map(Number);
  return integer(x, 0, grid.width - 1) && integer(y, 0, grid.height - 1);
}
const point = (value, grid) => record(value) && integer(value.x, 0, grid.width - 1) && integer(value.y, 0, grid.height - 1);
const regionContains = (region, x, y) => x >= region.x && y >= region.y && x < region.x + region.width && y < region.y + region.height;
const protectedBy = (field, path) => field === path || field.startsWith(`${path}.`) || path.startsWith(`${field}.`);
function getPath(object, path) { return path.split('.').reduce((value, key) => value?.[key], object); }
function setPath(object, path, value) { const parts = path.split('.'); const key = parts.pop(); let parent = object; for (const part of parts) parent = parent[part]; parent[key] = clone(value); }

export function validateMap(map) {
  assertJson(map);
  if (!record(map) || map.schemaVersion !== 1 || map.kind !== 'studio-map') fail('Expected a studio-map schemaVersion 1 document.');
  if (!id(map.id) || !text(map.name) || !integer(map.revision, 0, Number.MAX_SAFE_INTEGER - 1)) fail('Invalid map identity or revision.');
  const grid = map.grid;
  if (!record(grid) || !integer(grid.width, 1, 128) || !integer(grid.height, 1, 128) || !integer(grid.tileWidth, 8, 256) || !integer(grid.tileHeight, 8, 256)) fail('Invalid map grid; use 1–128 cells and 8–256 pixel tiles.');
  const assets = records(map.assets, 'asset', 1000);
  for (const asset of assets.values()) {
    if (!text(asset.name) || !['tile', 'object'].includes(asset.kind) || !num(asset.width, 1, 4096) || !num(asset.height, 1, 4096)) fail(`Invalid map asset ${asset.id}.`);
    if (typeof asset.src !== 'string' || !/^\/(assets|local-assets)\/[A-Za-z0-9_/-]+\.(svg|png|jpe?g|webp)$/i.test(asset.src) || asset.src.split('/').includes('..')) fail(`Invalid map asset path: ${asset.id}.`);
    if (asset.directions !== undefined && (!record(asset.directions) || !Object.entries(asset.directions).every(([k,v]) => ['0','90','180','270','0m','90m','180m','270m'].includes(k) && assets.get(v)?.kind === 'object'))) fail('Invalid map directional artwork.');
    if (asset.footprint !== undefined && (!record(asset.footprint) || !integer(asset.footprint.width, 1, 128) || !integer(asset.footprint.height, 1, 128))) fail(`Invalid map asset footprint: ${asset.id}; use whole cells from 1 to 128.`);
    if (asset.atlas !== undefined && (!record(asset.atlas) || !integer(asset.atlas.x, 0, 32768) || !integer(asset.atlas.y, 0, 32768) || !integer(asset.atlas.width, 1, 32768) || !integer(asset.atlas.height, 1, 32768))) fail(`Invalid map atlas region: ${asset.id}.`);
  }
  if (map.reference != null) {
    const r=map.reference;
    if(!record(r)||!assets.has(r.assetId)||!num(r.x,-32768,32768)||!num(r.y,-32768,32768)||!num(r.width,1,16384)||!num(r.height,1,16384)||!num(r.opacity,0,1)||typeof r.visible!=='boolean'||r.locked!==true)fail('Invalid locked map reference.');
  }
  if(map.terrainRules!==undefined) {
    const rules=records(map.terrainRules,'terrain rule',100);
    for(const rule of rules.values())if(!text(rule.name)||!record(rule.variants)||!Object.entries(rule.variants).every(([mask,id])=>/^(?:[0-9]|1[0-5])$/.test(mask)&&assets.get(id)?.kind==='tile'))fail('Invalid terrain connection rule.');
  }
  if(map.placementRules!==undefined) {
    if(!record(map.placementRules))fail('Invalid placement rules.');
    for(const [assetId,policy]of Object.entries(map.placementRules))if(!assets.has(assetId)||!record(policy)||!Array.isArray(policy.allowedTiles)||!policy.allowedTiles.every(id=>assets.get(id)?.kind==='tile')||typeof policy.avoidOverlap!=='boolean')fail('Invalid asset placement rule.');
  }
  const layers = records(map.layers, 'layer', 16);
  if (!layers.size) fail('A map needs at least one layer.');
  if (map.actorLayerId !== undefined && !layers.has(map.actorLayerId)) fail('The character layer must reference an existing map layer.');
  for (const layer of layers.values()) {
    if (!text(layer.name) || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' || !record(layer.cells)) fail(`Invalid map layer ${layer.id}.`);
    if (Object.keys(layer.cells).length > grid.width * grid.height) fail('Too many map cells.');
    for (const [key, assetId] of Object.entries(layer.cells)) if (!cell(key, grid) || assets.get(assetId)?.kind !== 'tile') fail(`Invalid tile cell ${key} on ${layer.id}.`);
  }
  const objects = records(map.objects, 'object', 2000);
  for (const object of objects.values()) {
    if (!text(object.name) || !layers.has(object.layerId) || assets.get(object.assetId)?.kind !== 'object' || !point(object, grid)) fail(`Invalid map object ${object.id}.`);
    if (!num(object.width, 1, 4096) || !num(object.height, 1, 4096) || !num(object.anchorX, 0, 1) || !num(object.anchorY, 0, 1) || typeof object.blocking !== 'boolean') fail(`Invalid display properties on ${object.id}.`);
    if (!record(object.footprint) || !integer(object.footprint.width, 1, grid.width - object.x) || !integer(object.footprint.height, 1, grid.height - object.y)) fail(`Invalid footprint on ${object.id}.`);
  }
  if (!Array.isArray(map.blocked) || map.blocked.length > grid.width * grid.height || new Set(map.blocked).size !== map.blocked.length || !map.blocked.every(key => cell(key, grid))) fail('Invalid blocked map cells.');
  const markers = records(map.markers, 'marker', 1000);
  for (const marker of markers.values()) if (!text(marker.name) || !['spawn', 'exit', 'trigger'].includes(marker.type) || !point(marker, grid)) fail(`Invalid map marker ${marker.id}.`);
  const reviews = records(map.reviews, 'review', 2000);
  for (const review of reviews.values()) {
    const target = review.target;
    if (!record(target)) fail(`Invalid review target ${review.id}.`);
    if (target.type === 'object') { if (!objects.has(target.objectId)) fail(`Missing reviewed object ${target.objectId}.`); }
    else if (target.type === 'region') { if (!layers.has(target.layerId) || !point(target, grid) || !integer(target.width, 1, grid.width - target.x) || !integer(target.height, 1, grid.height - target.y)) fail(`Invalid review region ${review.id}.`); }
    else fail('Unsupported map review target.');
    if (!text(review.targetText, 2000) || !text(review.expected, 4000) || !['low', 'medium', 'high', 'critical'].includes(review.priority) || !statuses.includes(review.status)) fail(`Invalid map review ${review.id}.`);
    if (!Array.isArray(review.protectedProperties) || !review.protectedProperties.every(field => restrictions.includes(field))) fail('Invalid map review protection.');
    if (!text(review.createdAt, 100) || !Number.isFinite(Date.parse(review.createdAt))) fail('Invalid map review timestamp.');
  }
  records(map.history, 'history', 2000);
  return map;
}

/** Character shares one layer's object Y-sort band; old maps default compatibly. */
export function getActorLayerId(map) {
  const layerId = map.actorLayerId ?? (map.layers.some(layer => layer.id === 'decoration') ? 'decoration' : map.layers.at(-1)?.id);
  if (!map.layers.some(layer => layer.id === layerId)) fail('The character layer must reference an existing map layer.');
  return layerId;
}
/** Shared editor/export draw order: each layer's tiles, then its foot-sorted objects.
 * Return hidden layers as well so callers can retain their collision and metadata;
 * layer.visible controls all artwork in that band, including its character.
 */
export function getMapRenderLayers(map) {
  const actorLayerId = getActorLayerId(map);
  return map.layers.map((layer, index) => ({ layer, index, terrainZ: index * 2, objectZ: index * 2 + 1, objects: map.objects.filter(object => object.layerId === layer.id).sort((left, right) => (left.x + left.y) - (right.x + right.y)), actor: layer.id === actorLayerId }));
}

/** Asset occupancy defaults to one cell; display pixels remain independent. */
export function getAssetFootprint(asset) {
  const footprint = asset?.footprint ?? { width: 1, height: 1 };
  if (!record(footprint) || !integer(footprint.width, 1, 128) || !integer(footprint.height, 1, 128)) fail('Map footprint must use whole cells from 1 to 128.');
  return { width: footprint.width, height: footprint.height };
}
function placementLayer(map, layerId) {
  const layer = map.layers.find(item => item.id === layerId);
  if (!layer) fail('Choose an existing map layer.');
  if (layer.locked) fail('The map layer is locked.');
  return layer;
}
function placementFootprint(map, x, y, footprint) {
  const shape = getAssetFootprint({ footprint });
  if (!point({ x, y }, map.grid) || x + shape.width > map.grid.width || y + shape.height > map.grid.height) fail('The complete map footprint must fit inside the map bounds.');
  return shape;
}
/** Validate a palette drop completely before touching any tile or creating an object.
 * Tile footprints repeat a one-cell tile across the stamp; object footprints mark
 * occupancy while their artwork keeps the source display dimensions. Existing
 * content may overlap deliberately, including painting over prior tile cells.
 */
export function planMapPlacement(map, { assetId, layerId, x, y, footprint } = {}) {
  validateMap(map);
  const layer = placementLayer(map, layerId);
  const asset = map.assets.find(item => item.id === assetId);
  if (!asset) fail('Choose an existing map asset.');
  const shape = placementFootprint(map, x, y, footprint ?? getAssetFootprint(asset));
  if (asset.kind === 'tile') {
    const cells = [];
    for (let dy = 0; dy < shape.height; dy++) for (let dx = 0; dx < shape.width; dx++) cells.push({ x: x + dx, y: y + dy, assetId });
    return { type: 'tile', layerId: layer.id, x, y, footprint: shape, cells };
  }
  if (map.objects.length >= 2000) fail('The map already contains the maximum 2000 objects.');
  return { type: 'object', object: { id: makeId('map-object'), name: asset.name, assetId, layerId: layer.id, x, y, width: asset.width, height: asset.height, anchorX: 0.5, anchorY: 1, blocking: true, footprint: shape } };
}
/** Reassign or move one object without changing its stable ID, reviews or art. */
export function moveMapObject(map, { objectId, layerId, x, y, footprint } = {}) {
  validateMap(map);
  const object = map.objects.find(item => item.id === objectId);
  if (!object) fail('Choose an existing map object.');
  placementLayer(map, object.layerId);
  const destination = layerId ?? object.layerId;
  placementLayer(map, destination);
  const nextX = x ?? object.x; const nextY = y ?? object.y;
  const shape = placementFootprint(map, nextX, nextY, footprint ?? object.footprint);
  const project = clone(map);
  Object.assign(project.objects.find(item => item.id === objectId), { layerId: destination, x: nextX, y: nextY, footprint: shape });
  return validateMap(project);
}

export function isoToScreen(x, y, grid) { return { x: (x - y) * grid.tileWidth / 2, y: (x + y) * grid.tileHeight / 2 }; }
export function screenToIso(x, y, grid) { return { x: x / grid.tileWidth + y / grid.tileHeight, y: y / grid.tileHeight - x / grid.tileWidth }; }
export function isWalkable(map, x, y) {
  if (!point({ x, y }, map.grid) || map.blocked.includes(`${x},${y}`)) return false;
  return !map.objects.some(object => object.blocking && x >= object.x && y >= object.y && x < object.x + object.footprint.width && y < object.y + object.footprint.height);
}
export function findPath(map, start, end) {
  // Build one collision bitmap; repeated linear scans make large maps quadratic.
  const { width, height } = map.grid;
  const blocked = new Uint8Array(width * height);
  for (const key of map.blocked) { const [x, y] = key.split(',').map(Number); blocked[y * width + x] = 1; }
  for (const object of map.objects) if (object.blocking) {
    for (let y = object.y; y < object.y + object.footprint.height; y++) blocked.fill(1, y * width + object.x, y * width + object.x + object.footprint.width);
  }
  const walkable = p => point(p, map.grid) && !blocked[p.y * width + p.x];
  if (!walkable(start) || !walkable(end)) return [];
  const visited = new Map([[`${start.x},${start.y}`, null]]);
  const queue = [{ x: start.x, y: start.y }];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current.x === end.x && current.y === end.y) {
      const path = []; let key = `${end.x},${end.y}`;
      while (key !== null) { const [x, y] = key.split(',').map(Number); path.push({ x, y }); key = visited.get(key); }
      return path.reverse();
    }
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const next = { x: current.x + dx, y: current.y + dy }; const key = `${next.x},${next.y}`;
      if (visited.has(key) || !walkable(next)) continue;
      visited.set(key, `${current.x},${current.y}`); queue.push(next);
    }
  }
  return [];
}

function changeMatchesReview(change, review) {
  const target = review.target;
  if (change.type === 'object') return target.type === 'object' && target.objectId === change.objectId;
  return target.type === 'region' && (change.type !== 'cell' || target.layerId === change.layerId) && regionContains(target, change.x, change.y);
}
function changeIdentity(change) { return change.type === 'object' ? `object:${change.objectId}:${change.path}` : change.type === 'cell' ? `cell:${change.layerId}:${change.x},${change.y}` : `blocked:${change.x},${change.y}`; }
function readChange(map, change) {
  if (change.type === 'object') return getPath(map.objects.find(object => object.id === change.objectId), change.path);
  if (change.type === 'cell') return map.layers.find(layer => layer.id === change.layerId)?.cells[`${change.x},${change.y}`] ?? null;
  return map.blocked.includes(`${change.x},${change.y}`);
}
function writeChange(map, change, value) {
  if (change.type === 'object') return setPath(map.objects.find(object => object.id === change.objectId), change.path, value);
  const key = `${change.x},${change.y}`;
  if (change.type === 'cell') { const cells = map.layers.find(layer => layer.id === change.layerId).cells; if (value === null) delete cells[key]; else cells[key] = value; return; }
  map.blocked = map.blocked.filter(item => item !== key); if (value) map.blocked.push(key);
}
function assertChangeUnlocked(map, change) {
  if (change.type === 'object') {
    const object = map.objects.find(item => item.id === change.objectId);
    if (!object) fail('Missing map object.');
    if (map.layers.find(layer => layer.id === object.layerId)?.locked) fail('The map object layer is locked.');
  } else if (change.type === 'cell') {
    const layer = map.layers.find(item => item.id === change.layerId);
    if (!layer) fail('Missing map layer.');
    if (layer.locked) fail('The map layer is locked.');
  } else if (change.type === 'blocked' && change.layerIds) {
    if (!Array.isArray(change.layerIds) || !change.layerIds.length || !change.layerIds.every(layerId => map.layers.some(layer => layer.id === layerId))) fail('Missing reviewed map layer.');
    if (change.layerIds.some(layerId => map.layers.find(layer => layer.id === layerId).locked)) fail('The reviewed map layer is locked.');
  }
}
export function previewMapPatch(map, patch, { selectedIndices } = {}) {
  validateMap(map); assertJson(patch);
  if (!record(patch) || patch.schemaVersion !== 1 || patch.kind !== 'studio-map-patch' || patch.projectId !== map.id) fail('Map patch does not belong to this project.');
  if (patch.baseRevision !== map.revision) fail(`Stale map patch; expected revision ${map.revision}.`);
  if (!text(patch.summary, 2000) || !Array.isArray(patch.changes) || !patch.changes.length || patch.changes.length > 16384) fail('Map patch needs a summary and changes.');
  if (!Array.isArray(patch.reviewIds) || !patch.reviewIds.length || new Set(patch.reviewIds).size !== patch.reviewIds.length) fail('Map patch must list unique pending review IDs.');
  const selectedReviews = patch.reviewIds.map(reviewId => map.reviews.find(review => review.id === reviewId));
  if (selectedReviews.some(review => !review || review.status !== 'pending')) fail('Map patch review is missing or no longer pending.');
  if (selectedIndices !== undefined && (!Array.isArray(selectedIndices) || !selectedIndices.length || new Set(selectedIndices).size !== selectedIndices.length || !selectedIndices.every(index => integer(index, 0, patch.changes.length - 1)))) fail('Select valid unique map patch change indices.');
  const selected = selectedIndices === undefined ? new Set(patch.changes.map((_, index) => index)) : new Set(selectedIndices);
  const allDiffs = []; const seen = new Set();
  patch.changes.forEach((change, index) => {
    if (!record(change) || !['object', 'cell', 'blocked'].includes(change.type)) fail('Invalid map patch change.');
    if (!selectedReviews.some(review => changeMatchesReview(change, review))) fail('Map change is outside the selected review scope.');
    assertChangeUnlocked(map, change);
    let expanded;
    if (change.type === 'object') {
      if (!record(change.set) || !Object.keys(change.set).length) fail('Empty map object change.');
      expanded = Object.entries(change.set).map(([path, after]) => {
        if (!MAP_OBJECT_FIELDS.includes(path)) fail(`Map property is not patchable: ${path}.`);
        return { type: 'object', objectId: change.objectId, path, after, index };
      });
    } else {
      if (!point(change, map.grid)) fail('Map patch cell is out of bounds.');
      if (change.type === 'cell' && change.assetId !== null && map.assets.find(asset => asset.id === change.assetId)?.kind !== 'tile') fail('Map patch references an invalid tile.');
      if (change.type === 'blocked' && typeof change.value !== 'boolean') fail('Map walkability must be boolean.');
      expanded = [{ type: change.type, ...(change.type === 'cell' ? { layerId: change.layerId } : {}), x: change.x, y: change.y, ...(change.type === 'blocked' ? { layerIds: [...new Set(selectedReviews.filter(review => changeMatchesReview(change, review)).map(review => review.target.layerId))] } : {}), after: change.type === 'cell' ? change.assetId : change.value, index }];
    }
    for (const diff of expanded) {
      const key = changeIdentity(diff);
      if (seen.has(key)) fail('Duplicate map patch field or cell.'); seen.add(key);
      const field = diff.type === 'object' ? diff.path : diff.type === 'cell' ? 'cells' : 'blocked';
      const unresolved = map.reviews.filter(review => review.status !== 'approved' && changeMatchesReview(change, review));
      if (unresolved.some(review => review.protectedProperties.some(path => protectedBy(field, path)))) fail(`Protected map property: ${field}.`);
      if (diff.type === 'blocked' && selectedReviews.filter(review => changeMatchesReview(change, review)).some(review => map.layers.find(layer => layer.id === review.target.layerId)?.locked)) fail('The reviewed map layer is locked.');
      const before = readChange(map, diff);
      if (!equal(before, diff.after)) allDiffs.push({ ...diff, before: clone(before) });
    }
  });
  // Validate every suggested edit, even when only part will be accepted.
  const complete = clone(map);
  for (const diff of allDiffs) writeChange(complete, diff, diff.after);
  validateMap(complete);
  if (selectedReviews.some(review => !allDiffs.some(diff => changeMatchesReview(diff, review)))) fail('Every map review must have an actual change.');
  const changes = allDiffs.filter(diff => selected.has(diff.index));
  if (!changes.length) fail('Selected map patch makes no changes.');
  const project = clone(map);
  for (const diff of changes) writeChange(project, diff, diff.after);
  const partial = selected.size !== patch.changes.length;
  if (!partial) for (const review of project.reviews) if (patch.reviewIds.includes(review.id)) review.status = 'modified';
  project.revision++;
  project.history.push({ id: makeId('map-patch'), kind: 'patch', summary: patch.summary, createdAt: new Date().toISOString(), baseRevision: map.revision, revision: project.revision, reviewIds: [...patch.reviewIds], reviewStatuses: Object.fromEntries(selectedReviews.map(review => [review.id, review.status])), partial, changes, rolledBack: false });
  validateMap(project);
  return { project, changes };
}
export function applyMapPatch(map, patch, options) { return previewMapPatch(map, patch, options).project; }
export function rollbackMapPatch(map, historyId) {
  validateMap(map);
  const entry = map.history.find(item => item.id === historyId);
  if (!entry || entry.kind !== 'patch' || entry.rolledBack || !Array.isArray(entry.changes) || !entry.changes.length) fail('Map patch history is missing or already rolled back.');
  const project = clone(map); const seen = new Set();
  for (const change of entry.changes) {
    if (!record(change) || !['object', 'cell', 'blocked'].includes(change.type) || (change.type === 'object' && !MAP_OBJECT_FIELDS.includes(change.path)) || (change.type !== 'object' && !point(change, map.grid))) fail('Invalid map patch history.');
    if (change.type === 'blocked' && (!Array.isArray(change.layerIds) || !change.layerIds.length || typeof change.before !== 'boolean' || typeof change.after !== 'boolean')) fail('Invalid collision rollback history.');
    const key = changeIdentity(change); if (seen.has(key)) fail('Duplicate map history field.'); seen.add(key);
    assertChangeUnlocked(map, change);
    if (!equal(readChange(map, change), change.after)) fail(`Map rollback conflict: ${key}.`);
    writeChange(project, change, change.before);
  }
  project.revision++;
  project.history.find(item => item.id === historyId).rolledBack = true;
  for (const review of project.reviews) if (entry.reviewIds?.includes(review.id)) review.status = entry.reviewStatuses?.[review.id] || 'pending';
  project.history.push({ id: makeId('map-rollback'), kind: 'rollback', summary: `Rollback: ${entry.summary}`, createdAt: new Date().toISOString(), rollbackOf: historyId, baseRevision: map.revision, revision: project.revision, changes: entry.changes.map(change => ({ ...clone(change), before: clone(change.after), after: clone(change.before) })) });
  validateMap(project); return project;
}

export function buildMapFeedback(map) {
  validateMap(map);
  const reviews = map.reviews.filter(review => review.status === 'pending');
  const objectIds = new Set(reviews.filter(review => review.target.type === 'object').map(review => review.target.objectId));
  const regions = reviews.filter(review => review.target.type === 'region').map(review => review.target);
  const objects = map.objects.filter(object => objectIds.has(object.id) || regions.some(region => regionContains(region, object.x, object.y)));
  const layerIds = new Set([...regions.map(region => region.layerId), ...objects.map(object => object.layerId)]);
  const layers = map.layers.filter(layer => layerIds.has(layer.id)).map(layer => ({ ...clone(layer), cells: Object.fromEntries(Object.entries(layer.cells).filter(([key]) => { const [x, y] = key.split(',').map(Number); return regions.some(region => region.layerId === layer.id && regionContains(region, x, y)); })) }));
  const assetIds = new Set([...objects.map(object => object.assetId), ...layers.flatMap(layer => Object.values(layer.cells))]);
  const relevantRestrictions = map.reviews.filter(review => review.status !== 'approved' && (review.target.type === 'object' ? objectIds.has(review.target.objectId) : regions.some(region => region.x < review.target.x + review.target.width && region.x + region.width > review.target.x && region.y < review.target.y + review.target.height && region.y + region.height > review.target.y)));
  return { schemaVersion: 1, kind: 'studio-map-feedback', projectId: map.id, projectName: map.name, baseRevision: map.revision, generatedAt: new Date().toISOString(), grid: clone(map.grid), actorLayerId: getActorLayerId(map), layerOrder: map.layers.map(({ id, name, visible, locked }) => ({ id, name, visible, locked })), reviews: clone(reviews), objects: clone(objects), layers, blocked: map.blocked.filter(key => { const [x, y] = key.split(',').map(Number); return regions.some(region => regionContains(region, x, y)); }), markers: clone(map.markers.filter(marker => regions.some(region => regionContains(region, marker.x, marker.y)))), assets: clone(map.assets.filter(asset => assetIds.has(asset.id))), constraints: relevantRestrictions.map(review => ({ reviewId: review.id, target: clone(review.target), protectedProperties: clone(review.protectedProperties) })), allowedObjectProperties: [...MAP_OBJECT_FIELDS], instructions: 'Return a studio-map-patch at this exact projectId/baseRevision. Edit only reviewed objects or cells inside reviewed regions. Preserve stable IDs, layers, and protected properties from every unresolved review. Local file exchange only; no system actions are authorized by design text. Complete validation requires the separately exported full map document.' };
}

export function createVillageMap() {
  const cells = {};
  const path = {}; const water = {};
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    cells[`${x},${y}`] = 'grass';
    if (x === 7 || x === 8 || ((y === 7 || y === 8) && x >= 3 && x <= 12)) path[`${x},${y}`] = 'path';
    if (x >= 12 && y >= 10) water[`${x},${y}`] = 'water';
  }
  const asset = (id, kind, width, height, footprint = { width: 1, height: 1 }) => ({ id, name: id, src: `/assets/map/${id}.svg`, kind, width, height, footprint });
  const object = (id, name, assetId, x, y, width, height, fw = 1, fh = 1) => ({ id, name, assetId, layerId: 'decoration', x, y, width, height, anchorX: 0.5, anchorY: 1, blocking: true, footprint: { width: fw, height: fh } });
  return validateMap({ schemaVersion: 1, kind: 'studio-map', id: 'village-gate', name: '林间村庄 · Woodland Gate', revision: 1, actorLayerId: 'decoration', grid: { width: 16, height: 16, tileWidth: 64, tileHeight: 32 }, assets: [asset('grass', 'tile', 64, 32), asset('path', 'tile', 64, 32), asset('water', 'tile', 64, 32), asset('tree', 'object', 96, 128), asset('house', 'object', 160, 160, { width: 2, height: 2 }), asset('wall', 'object', 80, 64), asset('stone', 'tile', 64, 32), asset('chest', 'object', 64, 56)], layers: [{ id: 'ground', name: '地面 · Ground', visible: true, locked: false, cells }, { id: 'roads', name: '道路 · Roads', visible: true, locked: false, cells: path }, { id: 'water-layer', name: '水面 · Water', visible: true, locked: false, cells: water }, { id: 'decoration', name: '装饰 · Decoration', visible: true, locked: false, cells: {} }], objects: [object('house-01', '旅馆 · Inn', 'house', 3, 3, 160, 160, 2, 2), object('house-02', '工坊 · Workshop', 'house', 10, 4, 160, 160, 2, 2), object('tree-01', '入口松树 · Gate pine', 'tree', 5, 12, 96, 128), object('tree-02', '道路松树 · Road pine', 'tree', 9, 10, 96, 128), object('tree-03', '林地松树 · Grove pine', 'tree', 2, 9, 96, 128), object('tree-04', '后院松树 · Courtyard pine', 'tree', 12, 2, 96, 128), object('wall-01', '左侧围墙 · West wall', 'wall', 5, 14, 80, 64), object('wall-02', '右侧围墙 · East wall', 'wall', 10, 14, 80, 64)], blocked: Object.keys(water), markers: [{ id: 'spawn-gate', type: 'spawn', name: '村口 · Gate', x: 7, y: 14 }, { id: 'exit-north', type: 'exit', name: '北方出口 · North exit', x: 7, y: 0 }, { id: 'trigger-inn', type: 'trigger', name: '旅馆入口 · Inn entrance', x: 4, y: 5 }], reviews: [], history: [] });
}
