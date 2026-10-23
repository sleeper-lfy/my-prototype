import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { createStudioServer } from '../server/index.js';

async function withServer(run) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-api-'));
  const studio = await createStudioServer({ dataDir, vite: false });
  const server = await new Promise(resolve => { const instance = studio.app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`${base}${route}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  try { await run({ request, base, dataDir }); }
  finally { await new Promise(resolve => server.close(resolve)); await studio.close(); await fs.rm(dataDir, { recursive: true, force: true }); }
}

test('local save is persistent, atomically rejects stale concurrent writes, and patch can roll back', async () => withServer(async ({ request, dataDir }) => {
  const original = (await request('/api/project')).data;
  assert.equal(original.revision, 1);
  const update = structuredClone(original);
  update.name = 'Locally edited';
  update.revision++;
  const results = await Promise.all([request('/api/project', 'PUT', update), request('/api/project', 'PUT', update)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const persisted = JSON.parse(await fs.readFile(path.join(dataDir, 'project.json'), 'utf8'));
  assert.equal(persisted.name, 'Locally edited');
  const patch = (await request('/api/example-patch')).data;
  assert.equal(patch.baseRevision, 2);
  const applied = await request('/api/patch', 'POST', patch);
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.nodes.find(n => n.id === 'recruit-button').style.text, 'RECRUIT · 240');
  const history = applied.data.history.find(h => h.kind === 'patch');
  assert.ok(history);
  const replay = await request('/api/patch', 'POST', patch);
  assert.ok(replay.status >= 400);
  const rolled = await request('/api/rollback', 'POST', { historyId: history.id });
  assert.equal(rolled.status, 200, JSON.stringify(rolled.data));
  assert.equal(rolled.data.nodes.find(n => n.id === 'recruit-button').style.text, original.nodes.find(n => n.id === 'recruit-button').style.text);
  assert.equal(rolled.data.reviews.find(r => r.id === 'review-cta').status, 'pending');
}));

test('feedback includes only pending comments and real PNG files; Godot archive contains runnable source', async () => withServer(async ({ request, base }) => {
  const project = (await request('/api/project')).data;
  project.reviews.find(r => r.id === 'review-card').status = 'approved';
  project.revision++;
  assert.equal((await request('/api/project', 'PUT', project)).status, 200);
  assert.equal((await request('/api/feedback', 'POST', { baseRevision: project.revision, screenshots: {} })).status, 400);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6FCEAAAAASUVORK5CYII=';
  const exported = await request('/api/feedback', 'POST', { baseRevision: project.revision, screenshots: { 'recruit-button': png } });
  assert.equal(exported.status, 200, JSON.stringify(exported.data));
  assert.equal(exported.data.count, 1);
  const archive = unzipSync(new Uint8Array(await (await fetch(base + exported.data.downloadUrl)).arrayBuffer()));
  const feedback = JSON.parse(strFromU8(archive['feedback.json']));
  assert.deepEqual(feedback.reviews.map(r => r.id), ['review-cta']);
  assert.ok(archive['screenshots/recruit-button.png']);
  assert.ok(archive['patch-template.json']);
  assert.ok(!Object.keys(archive).some(key => key.includes('character-card.png')));
  const godot = await request('/api/godot', 'POST', {});
  assert.equal(godot.status, 200, JSON.stringify(godot.data));
  const godotZip = unzipSync(new Uint8Array(await (await fetch(base + godot.data.downloadUrl)).arrayBuffer()));
  for (const name of ['project.godot', 'main.tscn', 'node-map.json', 'FONT-LICENSE.txt', 'ARTWORK-LICENSE.txt']) assert.ok(godotZip[name], name);
  assert.match(strFromU8(godotZip['main.tscn']), /studio_id/);
}));

test('local API rejects cross-site writes, unsafe assets, and bad project imports', async () => withServer(async ({ request, base }) => {
  const response = await fetch(base + '/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: '{}' });
  assert.equal(response.status, 403);
  const wrongType = await fetch(base + '/api/reset', { method: 'POST', body: '{}' });
  assert.equal(wrongType.status, 415);
  const badAsset = await request('/api/assets', 'POST', { name: 'unsafe', kind: 'icon', dataUrl: 'data:image/svg+xml;base64,' + Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64') });
  assert.equal(badAsset.status, 400);
  const invalid = await request('/api/import', 'POST', { schemaVersion: 400 });
  assert.equal(invalid.status, 400);
  const project = await request('/api/project');
  assert.equal(project.data.id, 'ashfall');
}));

test('stale feedback and missing imported assets cannot replace a valid working document', async () => withServer(async ({ request }) => {
  const original = (await request('/api/project')).data;
  const changed = structuredClone(original);
  changed.revision++;
  changed.name = 'Current saved project';
  assert.equal((await request('/api/project', 'PUT', changed)).status, 200);
  const stale = await request('/api/feedback', 'POST', { baseRevision: original.revision, screenshots: {} });
  assert.equal(stale.status, 409);
  const imported = structuredClone(changed);
  imported.assets[0].src = '/local-assets/missing-image.svg';
  assert.equal((await request('/api/import', 'POST', imported)).status, 404);
  const retained = (await request('/api/project')).data;
  assert.equal(retained.name, changed.name);
  assert.deepEqual(retained.assets, changed.assets);
}));
