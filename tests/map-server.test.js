import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { createStudioServer } from '../server/index.js';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6FCEAAAAASUVORK5CYII=';
async function withServer(run) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-map-api-'));
  let server; let studio;
  async function open() {
    studio = await createStudioServer({ dataDir, vite: false });
    server = await new Promise(resolve => { const instance = studio.app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (route, method = 'GET', body) => {
      const response = await fetch(base + route, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      return { status: response.status, data: await response.json() };
    };
    return { request, base };
  }
  async function close() { if (server) await new Promise(resolve => server.close(resolve)); if (studio) await studio.close(); server = null; studio = null; }
  try { await run({ ...await open(), dataDir, restart: async () => { await close(); return open(); } }); }
  finally { await close(); await fs.rm(dataDir, { recursive: true, force: true }); }
}
const addReview = map => map.reviews.push({ id: 'tree-review', target: { type: 'object', objectId: 'tree-01' }, targetText: 'Move tree', expected: 'Move left one cell', protectedProperties: ['width', 'height'], priority: 'high', status: 'pending', createdAt: new Date().toISOString() });
const makePatch = map => ({ schemaVersion: 1, kind: 'studio-map-patch', projectId: map.id, baseRevision: map.revision, summary: 'Move entrance tree', reviewIds: ['tree-review'], changes: [{ type: 'object', objectId: 'tree-01', set: { x: 4 } }] });

test('map and UI persistence remain independent and concurrent map saves reject a stale revision', async () => withServer(async ({ request, dataDir, restart }) => {
  const ui = (await request('/api/project')).data;
  const map = (await request('/api/map')).data;
  map.name = 'Saved village';
  const writes = await Promise.all([request('/api/map', 'PUT', { project: map, baseRevision: map.revision }), request('/api/map', 'PUT', { project: map, baseRevision: map.revision })]);
  assert.deepEqual(writes.map(r => r.status).sort(), [200, 409]);
  assert.deepEqual((await request('/api/project')).data, ui);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'map.json'), 'utf8')).name, 'Saved village');
  const rebooted = await restart();
  const reloaded = (await rebooted.request('/api/map')).data;
  assert.equal(reloaded.name, 'Saved village');
  assert.equal(reloaded.revision, map.revision + 1);
  assert.deepEqual((await rebooted.request('/api/project')).data, ui);
}));

test('map preview is read-only, apply persists actual history and rollback restores changed values', async () => withServer(async ({ request }) => {
  const map = (await request('/api/map')).data; addReview(map);
  const saved = await request('/api/map', 'PUT', { project: map, baseRevision: map.revision });
  assert.equal(saved.status, 200);
  const patch = makePatch(saved.data);
  const preview = await request('/api/map/patch/preview', 'POST', { patch });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.changes[0].after, 4);
  assert.equal((await request('/api/map')).data.revision, saved.data.revision);
  const applied = await request('/api/map/patch', 'POST', { patch });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.reviews[0].status, 'modified');
  assert.equal((await request('/api/map/patch', 'POST', { patch })).status, 400);
  const rolled = await request('/api/map/rollback', 'POST', { historyId: applied.data.history[0].id });
  assert.equal(rolled.status, 200, JSON.stringify(rolled.data));
  assert.equal(rolled.data.objects.find(o => o.id === 'tree-01').x, 5);
  assert.equal(rolled.data.reviews[0].status, 'pending');
}));

test('map import validates every local asset before replacing active map and honors optional revision guard', async () => withServer(async ({ request }) => {
  const initial = (await request('/api/map')).data;
  const bad = structuredClone(initial); bad.id = 'new-map'; bad.assets[0].src = '/local-assets/missing.svg';
  assert.equal((await request('/api/map/import', 'POST', { project: bad })).status, 404);
  assert.deepEqual((await request('/api/map')).data, initial);
  assert.equal((await request('/api/map/import', 'POST', { project: initial, baseRevision: 0 })).status, 409);
  const replacement = structuredClone(initial); replacement.id = 'imported-village';
  const imported = await request('/api/map/import', 'POST', { project: replacement, baseRevision: initial.revision });
  assert.equal(imported.status, 200);
  assert.equal(imported.data.id, replacement.id);
  assert.equal(imported.data.revision, initial.revision + 1);
}));

test('map feedback contains pending review crops and relevant assets, rejects stale or absent screenshots', async () => withServer(async ({ request, base }) => {
  const map = (await request('/api/map')).data; addReview(map);
  map.reviews.push({ ...map.reviews[0], id: 'accepted-review', status: 'approved', target: { type: 'object', objectId: 'house-01' } });
  const saved = (await request('/api/map', 'PUT', { project: map, baseRevision: map.revision })).data;
  assert.equal((await request('/api/map/feedback', 'POST', { baseRevision: map.revision, screenshots: {} })).status, 409);
  assert.equal((await request('/api/map/feedback', 'POST', { baseRevision: saved.revision, screenshots: {} })).status, 400);
  const exported = await request('/api/map/feedback', 'POST', { baseRevision: saved.revision, screenshots: { 'tree-review': png } });
  assert.equal(exported.status, 200, JSON.stringify(exported.data));
  const archive = unzipSync(new Uint8Array(await (await fetch(base + exported.data.downloadUrl)).arrayBuffer()));
  assert.ok(archive['screenshots/tree-review.png']);
  assert.ok(!archive['screenshots/accepted-review.png']);
  assert.ok(archive['assets/tree-tree.svg']);
  assert.ok(!archive['assets/house-house.svg']);
  const feedback = JSON.parse(strFromU8(archive['feedback.json']));
  assert.deepEqual(feedback.reviews.map(r => r.id), ['tree-review']);
  assert.equal(feedback.kind, 'studio-map-feedback');
  assert.equal(JSON.parse(strFromU8(archive['patch-template.json'])).baseRevision, saved.revision);
}));

test('map export uses the saved revision and delivers real Godot files and referenced assets', async () => withServer(async ({ request, base }) => {
  const map = (await request('/api/map')).data;
  assert.equal((await request('/api/map/godot', 'POST', { baseRevision: 0 })).status, 409);
  const exported = await request('/api/map/godot', 'POST', { baseRevision: map.revision });
  assert.equal(exported.status, 200, JSON.stringify(exported.data));
  const archive = unzipSync(new Uint8Array(await (await fetch(base + exported.data.downloadUrl)).arrayBuffer()));
  assert.ok(archive['project.godot']);
  assert.ok(Object.keys(archive).some(name => name.endsWith('.tscn')));
  assert.ok(Object.keys(archive).some(name => name.endsWith('tree.svg')));
  assert.ok(archive['ASSET-NOTICES.txt']);
}));
