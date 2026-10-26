import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVillageMap } from '../src/mapModel.js';
import { runMapCli } from '../.agents/skills/game-ui-studio/scripts/map.mjs';
import { createStudioServer } from '../server/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
test('map skill validates real-model patches, preserves sources, and refuses stale/protected changes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-map-skill-'));
  try {
    const project = createVillageMap();
    project.reviews.push({ id: 'review-tree', target: { type: 'object', objectId: 'tree-01' }, targetText: 'Move tree', expected: 'Leave a wider path', protectedProperties: ['assetId'], priority: 'high', status: 'pending', createdAt: '2026-10-26T00:00:00.000Z' });
    const patch = { schemaVersion: 1, kind: 'studio-map-patch', projectId: project.id, baseRevision: project.revision, summary: 'Clear the gate', reviewIds: ['review-tree'], changes: [{ type: 'object', objectId: 'tree-01', set: { x: 4 } }, { type: 'object', objectId: 'tree-01', set: { y: 11 } }] };
    const projectPath = path.join(dir, 'source.map.json'), patchPath = path.join(dir, 'round.patch.json'), output = path.join(dir, 'round.preview.json');
    await fs.writeFile(projectPath, JSON.stringify(project)); await fs.writeFile(patchPath, JSON.stringify(patch));
    const common = ['--root', root, '--project', projectPath];
    const inspect = await runMapCli(['inspect', ...common]);
    assert.equal(inspect.feedback.reviews[0].id, 'review-tree');
    assert.equal(inspect.visualReviewPerformed, false);
    assert.equal((await runMapCli(['validate', ...common])).status, 'valid-map');
    const valid = await runMapCli(['validate', ...common, '--patch', patchPath]);
    assert.equal(valid.changes.length, 2); assert.equal(valid.partial, false);
    const preview = await runMapCli(['preview', ...common, '--patch', patchPath, '--select', '0', '--out', output]);
    assert.equal(preview.partial, true);
    const written = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(written.objects.find(item => item.id === 'tree-01').x, 4);
    assert.equal(written.reviews[0].status, 'pending');
    assert.deepEqual(JSON.parse(await fs.readFile(projectPath, 'utf8')), project);
    await assert.rejects(runMapCli(['preview', ...common, '--patch', patchPath, '--out', output]), /exist/);
    await assert.rejects(runMapCli(['preview', ...common, '--patch', patchPath, '--out', path.join(dir, 'map.json')]), /preview/);
    await assert.rejects(runMapCli(['validate', ...common, '--patch', patchPath, '--select', '0,0']), /Repeated/);
    patch.baseRevision++; await fs.writeFile(patchPath, JSON.stringify(patch));
    await assert.rejects(runMapCli(['validate', ...common, '--patch', patchPath]), /[Ss]tale/);
    patch.baseRevision--; patch.changes = [{ type: 'object', objectId: 'tree-01', set: { assetId: 'house' } }];
    await fs.writeFile(patchPath, JSON.stringify(patch));
    await assert.rejects(runMapCli(['validate', ...common, '--patch', patchPath]), /Protected/);
    await assert.rejects(runMapCli(['apply', '--root', root, '--patch', patchPath, '--url', 'https://example.com']), /localhost/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('map skill applies and rolls back through the real localhost API without touching UI state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-map-skill-api-'));
  const server = await createStudioServer({ dataDir: dir, vite: false });
  try {
    await new Promise(resolve => server.httpServer.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    const uiBefore = await (await fetch(`${url}/api/project`)).json();
    const map = await (await fetch(`${url}/api/map`)).json();
    map.reviews.push({ id: 'review-tree', target: { type: 'object', objectId: 'tree-01' }, targetText: 'Move tree', expected: 'Clear gate', protectedProperties: ['assetId'], priority: 'high', status: 'pending', createdAt: '2026-10-26T00:00:00.000Z' });
    const saveResponse = await fetch(`${url}/api/map`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: map, baseRevision: map.revision }) });
    assert.equal(saveResponse.status, 200);
    const current = await saveResponse.json();
    const patchPath = path.join(dir, 'round.patch.json');
    await fs.writeFile(patchPath, JSON.stringify({ schemaVersion: 1, kind: 'studio-map-patch', projectId: current.id, baseRevision: current.revision, summary: 'Clear gate', reviewIds: ['review-tree'], changes: [{ type: 'object', objectId: 'tree-01', set: { x: 4 } }] }));
    const applied = await runMapCli(['apply', '--root', root, '--patch', patchPath, '--url', url]);
    assert.equal(applied.status, 'applied');
    assert.equal((await (await fetch(`${url}/api/map`)).json()).reviews[0].status, 'modified');
    await assert.rejects(runMapCli(['apply', '--root', root, '--patch', patchPath, '--url', url]), /[Ss]tale/);
    const rolledBack = await runMapCli(['rollback', '--root', root, '--history-id', applied.history.id, '--url', url]);
    assert.equal(rolledBack.status, 'rolled-back');
    const restored = await (await fetch(`${url}/api/map`)).json();
    assert.equal(restored.objects.find(item => item.id === 'tree-01').x, 5);
    assert.equal(restored.reviews[0].status, 'pending');
    assert.deepEqual(await (await fetch(`${url}/api/project`)).json(), uiBefore);
  } finally {
    await new Promise(resolve => server.httpServer.close(resolve));
    await server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
