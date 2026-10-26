import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { zipSync, unzipSync, strFromU8 } from 'fflate';
import { createGenerationTemplate, validateGenerationRequest, GENERATION_TEMPLATES } from '../src/generationModel.js';
import { generationMessages } from '../src/generationMessages.js';
import { validateProject } from '../src/model.js';
import { mountGenerationRoutes } from '../server/generationRoutes.js';

const sample = JSON.parse(await fs.readFile(new URL('../examples/character.project.json', import.meta.url)));
const input = { baseRevision: sample.revision, name: 'New game UI', brief: 'A readable game UI with original assets', template: 'character', width: 1280, height: 720, locale: 'en', rules: ['Keep the gold and forest palette.'], includeContext: false };

test('generation templates produce validated editable native projects without mutating current design', () => {
  const original = structuredClone(sample);
  for (const template of GENERATION_TEMPLATES) for (const locale of ['zh-CN', 'en']) {
    const project = createGenerationTemplate(sample, { ...input, template, locale });
    validateProject(project);
    assert.equal(project.canvas.width, 1280);
    assert.equal(project.canvas.height, 720);
    assert.deepEqual(project.reviews, []);
    assert.deepEqual(project.history, []);
    assert.ok(project.tokens.rules.includes(input.rules[0]));
    assert.deepEqual(project.assets, sample.assets);
    if (template === 'blank') assert.equal(project.nodes.length, 0);
    else {
      assert.ok(project.nodes.length >= 10, template);
      assert.ok(project.nodes.some(node => node.type === 'Button'), template);
      assert.ok(project.nodes.some(node => node.type === 'Label'), template);
    }
    if (template === 'current') {
      assert.deepEqual(project.nodes.map(node => node.id), sample.nodes.map(node => node.id));
      assert.deepEqual(project.nodes.map(node => node.locked), sample.nodes.map(node => node.locked));
    }
  }
  assert.deepEqual(sample, original);
});

test('generation request validation and bilingual catalog cover user inputs', () => {
  for (const [key, value] of Object.entries(generationMessages)) {
    assert.ok(value.en && value['zh-CN'], key);
  }
  assert.equal(validateGenerationRequest(input).brief, input.brief);
  for (const patch of [{ brief: '' }, { name: 'x'.repeat(201) }, { template: 'html' }, { width: 0 }, { width: '1280' }, { height: 4097 }, { baseRevision: -1 }, { locale: 'fr' }, { rules: [''] }, { rules: ['x'.repeat(2001)] }, { includeContext: 'false' }]) {
    assert.throws(() => validateGenerationRequest({ ...input, ...patch }), /generation.invalid/);
  }
});

test('generation API exports byte-preserved assets and a runnable authoritative validator, rejects stale revision', async () => {
  const app = express(); app.use(express.json());
  const archives = new Map();
  const original = structuredClone(sample);
  mountGenerationRoutes(app, {
    getProject: () => sample,
    readAsset: src => fs.readFile(new URL(`../public${src}`, import.meta.url)),
    archive: async (prefix, files) => { const name = `${prefix}-1-abcdef.zip`; archives.set(name, zipSync(files)); return { downloadUrl: `/files/${name}` }; },
  });
  app.get('/files/:name', (req, res) => res.send(Buffer.from(archives.get(req.params.name))));
  app.use((error, req, res, next) => res.status(error.status || 400).json({ error: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-generation-'));
  const request = payload => fetch(`${base}/api/generation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  try {
    assert.equal((await request({ ...input, baseRevision: sample.revision + 1 })).status, 409);
    assert.equal(archives.size, 0);
    assert.equal((await request({ ...input, template: 'html' })).status, 400);
    const response = await request(input);
    assert.equal(response.status, 200);
    const result = await response.json();
    const files = unzipSync(new Uint8Array(await (await fetch(base + result.downloadUrl)).arrayBuffer()));
    for (const name of ['TASK.md', 'task.json', 'template.project.json', 'FORMAT.json', 'asset-manifest.json', 'model.mjs', 'validate.mjs']) assert.ok(files[name], name);
    assert.equal(files['reference.project.json'], undefined);
    const template = JSON.parse(strFromU8(files['template.project.json']));
    validateProject(template);
    assert.equal(result.componentCount, template.nodes.length);
    const manifest = JSON.parse(strFromU8(files['asset-manifest.json']));
    for (const asset of manifest) assert.deepEqual(Buffer.from(files[asset.archivePath]), await fs.readFile(new URL(`../public${asset.src}`, import.meta.url)));
    for (const name of ['model.mjs', 'validate.mjs', 'template.project.json']) await fs.writeFile(path.join(temp, name), files[name]);
    const run = await promisify(execFile)(process.execPath, ['validate.mjs', 'template.project.json'], { cwd: temp });
    assert.equal(JSON.parse(run.stdout).valid, true);
    assert.deepEqual(JSON.parse(run.stdout).notChecked, ['asset existence in target Studio', 'Godot runtime', 'visual quality']);
    await fs.writeFile(path.join(temp, 'invalid.json'), JSON.stringify({ ...template, nodes: [{ ...template.nodes[0], type: 'HTML' }] }));
    await assert.rejects(promisify(execFile)(process.execPath, ['validate.mjs', 'invalid.json'], { cwd: temp }), /Unsupported node type/);
    const withContext = await request({ ...input, includeContext: true, locale: 'zh-CN' });
    const contextResult = await withContext.json();
    const contextFiles = unzipSync(new Uint8Array(await (await fetch(base + contextResult.downloadUrl)).arrayBuffer()));
    assert.deepEqual(JSON.parse(strFromU8(contextFiles['reference.project.json'])), original);
    assert.match(strFromU8(contextFiles['TASK.md']), /可编辑/);
    assert.deepEqual(sample, original);
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(temp, { recursive: true, force: true }); }
});
