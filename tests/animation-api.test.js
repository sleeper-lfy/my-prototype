import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { zipSync, unzipSync, strFromU8 } from 'fflate';
import { mountAnimationRoutes } from '../server/animationRoutes.js';
import { decodePng } from '../scripts/compare-png.js';

async function setup(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-animation-api-'));
  const app = express(); app.use(express.json({ limit: '40mb' }));
  let queue = Promise.resolve();
  const mutate = fn => { const value = queue.then(fn); queue = value.catch(() => {}); return value; };
  const archives = new Map();
  await mountAnimationRoutes(app, { dataDir: dir, mutate, archive: async (prefix, files) => {
    const name = `${prefix}-${archives.size}.zip`; archives.set(name, zipSync(files)); return { downloadUrl: name };
  } });
  app.use((error, _req, res, _next) => res.status(error.status || 400).json({ error: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/animation`;
  const req = async (route = '', body, method = 'POST') => {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try { await run({ req, dir, archives }); }
  finally { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); }
}

test('animation saves are serialized, persist independently, and reject stale rollback without losing later edits', () => setup(async ({ req, dir }) => {
  const initial = (await req()).data;
  assert.deepEqual(initial.canvas, { width: 64, height: 96 });
  const a = structuredClone(initial); a.name = 'First edit';
  const b = structuredClone(initial); b.name = 'Concurrent edit';
  const responses = await Promise.all([req('', { project: a, baseRevision: initial.revision }, 'PUT'), req('', { project: b, baseRevision: initial.revision }, 'PUT')]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const saved = (await req()).data;
  assert.equal(saved.revision, initial.revision + 1);
  const history = (await req('/history')).data;
  assert.equal(history.length, 1); assert.equal(history[0].canRollback, true);
  const later = structuredClone(saved); later.name = 'Later edit';
  const next = await req('', { project: later, baseRevision: saved.revision }, 'PUT'); assert.equal(next.status, 200);
  const stale = await req('/rollback', { historyId: history[0].id, baseRevision: next.data.revision });
  assert.equal(stale.status, 409);
  assert.equal((await req()).data.name, 'Later edit');
  const newest = (await req('/history')).data.at(-1);
  const rolled = await req('/rollback', { historyId: newest.id, baseRevision: next.data.revision });
  assert.equal(rolled.status, 200); assert.equal(rolled.data.name, saved.name);
  const stored = JSON.parse(await fs.readFile(path.join(dir, 'animation-state.json')));
  assert.deepEqual(stored.project, rolled.data);
  assert.equal((await fs.readdir(dir)).length, 1);
}));

test('animation feedback contains only pending targets and actual rendered PNGs; scoped patches preserve review restrictions and can roll back', () => setup(async ({ req, archives }) => {
  const project = (await req()).data;
  const clip = project.clips.find(c => c.id === 'walk-down');
  const frame = clip.frames[0];
  project.reviews = [{ id: 'review-foot', clipId: clip.id, frameIds: [frame.id], partId: 'leftFoot', target: 'Slow the first stance', expected: 'Hold stance longer', protectedProperties: ['root'], priority: 'high', status: 'pending' }];
  const save = await req('', { project, baseRevision: project.revision }, 'PUT');
  assert.equal(save.status, 200, save.data.error);
  const p = save.data;
  const feedback = await req('/feedback', { baseRevision: p.revision });
  assert.equal(feedback.status, 200, feedback.data.error);
  const files = unzipSync(archives.get(feedback.data.downloadUrl));
  const model = JSON.parse(strFromU8(files['feedback.json']));
  assert.equal(model.reviews.length, 1);
  assert.equal(model.clips.length, 1);
  assert.equal(model.clips[0].frames.length, 1);
  assert.ok(files['animationModel.mjs']); assert.ok(files['validate.mjs']);
  const png = Buffer.from(files[`frames/${clip.id}/${frame.id}.png`]);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 64); assert.equal(png.readUInt32BE(20), 96);
  const patch = { schemaVersion: 1, kind: 'studio-animation-patch', projectId: p.id, baseRevision: p.revision, summary: 'Hold stance', reviewIds: ['review-foot'], operations: [{ clipId: clip.id, frameId: frame.id, path: 'durationMs', value: frame.durationMs + 50 }] };
  const bad = structuredClone(patch); bad.operations[0].path = 'root.x'; bad.operations[0].value = 31;
  assert.equal((await req('/patch', { patch: bad })).status, 400);
  const preview = await req('/patch/preview', { patch }); assert.equal(preview.status, 200, preview.data.error);
  assert.equal((await req()).data.revision, p.revision);
  const applied = await req('/patch', { patch }); assert.equal(applied.status, 200, applied.data.error);
  assert.equal(applied.data.reviews[0].status, 'modified');
  assert.equal((await req('/patch', { patch })).status, 409);
  const history = (await req('/history')).data.at(-1);
  assert.ok(history.diff.length);
  const rolled = await req('/rollback', { historyId: history.id, baseRevision: applied.data.revision });
  assert.equal(rolled.data.reviews[0].status, 'pending');
  assert.equal(rolled.data.clips.find(c => c.id === clip.id).frames[0].durationMs, frame.durationMs);
}));

test('animation Godot ZIP exports native SpriteFrames, original dimensions and stable IDs', () => setup(async ({ req, archives }) => {
  const p = (await req()).data;
  const result = await req('/godot', { baseRevision: p.revision });
  assert.equal(result.status, 200, result.data.error);
  const files = unzipSync(archives.get(result.data.downloadUrl));
  assert.ok(files['project.godot']);
  const texts = Object.entries(files).filter(([name]) => /\.(tscn|tres|gd|json)$/.test(name)).map(([, bytes]) => strFromU8(bytes)).join('\n');
  assert.match(texts, /AnimatedSprite2D/); assert.match(texts, /SpriteFrames/);
  assert.ok(texts.includes(p.clips[0].frames[0].id));
  const png = Buffer.from(Object.entries(files).find(([name]) => name.endsWith('.png'))[1]);
  assert.equal(png.readUInt32BE(16), 64); assert.equal(png.readUInt32BE(20), 96);
}));

test('imported frame pixels survive persistence, feedback rendering and Godot export without resampling', () => setup(async ({ req, archives }) => {
  const p = (await req()).data;
  p.clips = [p.clips[0]]; p.clips[0].frames = [p.clips[0].frames[0]];
  const clip = p.clips[0], frame = clip.frames[0];
  const pixels = Array.from({ length: 64 * 96 * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 17) % 256);
  frame.image = { width: 64, height: 96, pixels };
  p.reviews = [{ id: 'import-review', clipId: clip.id, frameIds: [frame.id], partId: 'head', target: 'Check imported outline', expected: 'Preserve exact source pixels', protectedProperties: ['image'], priority: 'high', status: 'pending' }];
  const saved = await req('', { project: p, baseRevision: p.revision }, 'PUT');
  assert.equal(saved.status, 200, saved.data.error);
  assert.deepEqual(saved.data.clips[0].frames[0].image.pixels, pixels);
  for (const route of ['/feedback', '/godot']) {
    const response = await req(route, { baseRevision: saved.data.revision });
    assert.equal(response.status, 200, response.data.error);
    const zip = unzipSync(archives.get(response.data.downloadUrl));
    const name = `frames/${clip.id}/${frame.id}.png`;
    assert.deepEqual([...decodePng(Buffer.from(zip[name])).rgba], pixels);
  }
}));
