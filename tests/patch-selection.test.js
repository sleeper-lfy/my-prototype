import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { previewSelectedPatch } from '../src/patchSelection.js';
import { rollbackPatch } from '../src/model.js';

const original = JSON.parse(await fs.readFile(new URL('../examples/character.project.json', import.meta.url), 'utf8'));
function proposal(project) {
  return { schemaVersion: 1, projectId: project.id, baseRevision: project.revision, summary: 'Clarify cost and change label color', reviewIds: ['review-cta'], changes: [{ nodeId: 'recruit-button', set: { 'style.text': 'RECRUIT · 240', 'style.color': '#eeeeee' } }] };
}
test('UI patch preview is read-only; partial acceptance preserves pending review and supports conflict-safe rollback', () => {
  const project = structuredClone(original), before = structuredClone(project), patch = proposal(project);
  const preview = previewSelectedPatch(project, patch);
  assert.equal(preview.changes.length, 2);
  assert.deepEqual(project, before);
  const chosen = previewSelectedPatch(project, patch, [0]).project;
  const target = p => p.nodes.find(n => n.id === 'recruit-button');
  assert.equal(target(chosen).style.text, 'RECRUIT · 240');
  assert.equal(target(chosen).style.color, target(project).style.color);
  assert.equal(chosen.reviews.find(r => r.id === 'review-cta').status, 'pending');
  assert.equal(chosen.history.at(-1).partial, true);
  assert.equal(chosen.history.at(-1).changes.length, 1);
  const rolled = rollbackPatch(chosen, chosen.history.at(-1).id);
  assert.deepEqual(target(rolled), target(project));
  const conflict = structuredClone(chosen); target(conflict).style.text = 'Newer user edit';
  assert.throws(() => rollbackPatch(conflict, conflict.history.at(-1).id), /Rollback conflict/);
  assert.throws(() => previewSelectedPatch(chosen, patch, [1]), /Stale patch/);
  assert.equal(previewSelectedPatch(project, patch, [0, 1]).project.reviews.find(r => r.id === 'review-cta').status, 'modified');
});
test('selection cannot bypass validation of protected fields, scope, locking or invalid indices', () => {
  const project = structuredClone(original), patch = proposal(project);
  for (const indices of [[], [-1], [2], [0, 0], ['0']]) assert.throws(() => previewSelectedPatch(project, patch, indices), /Select at least/);
  const protectedPatch = structuredClone(patch); protectedPatch.changes[0].set['frame.x'] = 12;
  assert.throws(() => previewSelectedPatch(project, protectedPatch, [0]), /Protected property/);
  const outOfScope = structuredClone(patch); outOfScope.changes.push({ nodeId: 'unknown', set: { name: 'Changed' } });
  assert.throws(() => previewSelectedPatch(project, outOfScope, [0]), /outside the selected/);
  project.nodes.find(n => n.id === 'recruit-button').locked = true;
  assert.throws(() => previewSelectedPatch(project, patch, [0]), /locked/);
});
