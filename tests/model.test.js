import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, applyPatch, rollbackPatch, buildFeedback, computeLayout, diffProjects, makeId } from '../src/model.js';

const makeNode = (id, type = 'Panel', parentId = null, frame = {}) => ({ id, name: id, type, parentId, frame: { x: 10, y: 20, width: 100, height: 40, ...frame }, style: { fill: '#202830' }, locked: false, visible: true });
function fixture() {
  return {
    schemaVersion: 1, id: 'test-project', name: 'Test project', revision: 4,
    canvas: { width: 960, height: 600, background: '#101010' },
    tokens: { colors: { gold: '#ccaa66' }, fonts: { body: 'Georgia' }, rules: ['Respect readability.'] },
    assets: [{ id: 'art', name: 'Art', kind: 'portrait', src: '/assets/art.svg' }, { id: 'unused', name: 'Unused', kind: 'icon', src: '/assets/unused.svg' }],
    nodes: [makeNode('root', 'Control'), { ...makeNode('button', 'Button', 'root'), style: { text: 'RECRUIT', fill: '#ccaa66', color: '#111111' }, assetId: 'art' }, makeNode('other')],
    reviews: [{ id: 'r1', nodeId: 'button', target: 'Label', expected: 'Add price', protectedProperties: ['frame', 'style.fill'], priority: 'high', status: 'pending', createdAt: '2026-10-23T00:00:00.000Z' }, { id: 'r2', nodeId: 'other', target: 'Panel', expected: 'Already accepted', protectedProperties: [], priority: 'low', status: 'approved', createdAt: '2026-10-23T00:00:00.000Z' }],
    history: [],
  };
}
const patch = (overrides = {}) => ({ schemaVersion: 1, projectId: 'test-project', baseRevision: 4, summary: 'Add recruitment price', reviewIds: ['r1'], changes: [{ nodeId: 'button', set: { 'style.text': 'RECRUIT · 240' } }], ...overrides });

test('valid project has stable IDs; mutation-free validation returns its input', () => {
  const project = fixture();
  assert.equal(validateProject(project), project);
  assert.match(makeId('review'), /^review-[A-Za-z0-9-]+$/);
});

test('patch changes only reviewed fields, records exact diff and requires manual approval', () => {
  const project = fixture();
  const original = structuredClone(project);
  const next = applyPatch(project, patch());
  assert.deepEqual(project, original);
  assert.equal(next.revision, 5);
  assert.equal(next.nodes[1].style.text, 'RECRUIT · 240');
  assert.deepEqual(next.nodes[0], project.nodes[0]);
  assert.deepEqual(next.nodes[2], project.nodes[2]);
  assert.equal(next.reviews[0].status, 'modified');
  assert.equal(next.history[0].changes[0].before, 'RECRUIT');
  assert.equal(next.history[0].changes[0].after, 'RECRUIT · 240');
  assert.equal(next.history[0].reviewStatuses.r1, 'pending');
});

test('patch failure is atomic when a later change targets a protected field', () => {
  const project = fixture();
  const original = JSON.stringify(project);
  assert.throws(() => applyPatch(project, patch({ changes: [{ nodeId: 'button', set: { 'style.text': 'Changed', 'frame.x': 100 } }] })), /Protected/);
  assert.equal(JSON.stringify(project), original);
});

test('stale revisions, wrong project, unreviewed nodes and invalid values are rejected', () => {
  assert.throws(() => applyPatch(fixture(), patch({ baseRevision: 3 })), /Stale/);
  assert.throws(() => applyPatch(fixture(), patch({ projectId: 'other-project' })), /belong/);
  assert.throws(() => applyPatch(fixture(), patch({ changes: [{ nodeId: 'other', set: { 'style.text': 'X' } }] })), /scope/);
  assert.throws(() => applyPatch(fixture(), patch({ changes: [{ nodeId: 'button', set: { 'style.fontSize': -1 } }] })), /Invalid/);
  assert.throws(() => applyPatch(fixture(), patch({ changes: [{ nodeId: 'button', set: { id: 'new-id' } }] })), /not patchable/);
  assert.throws(() => applyPatch(fixture(), patch({ changes: [{ nodeId: 'button', set: { 'style.constructor': 'x' } }] })), /not patchable/);
});

test('duplicate writes, empty effective changes and non-pending reviews cannot be applied', () => {
  assert.throws(() => applyPatch(fixture(), patch({ changes: [{ nodeId: 'button', set: { 'style.text': 'A' } }, { nodeId: 'button', set: { 'style.text': 'B' } }] })), /Duplicate/);
  assert.throws(() => applyPatch(fixture(), patch({ changes: [{ nodeId: 'button', set: { 'style.text': 'RECRUIT' } }] })), /no changes/);
  const project = fixture(); project.reviews[0].status = 'modified';
  assert.throws(() => applyPatch(project, patch()), /no longer pending/);
});

test('locked targets and ancestor locks block patches', () => {
  const a = fixture(); a.nodes[1].locked = true;
  assert.throws(() => applyPatch(a, patch()), /locked/);
  const b = fixture(); b.nodes[0].locked = true;
  assert.throws(() => applyPatch(b, patch()), /locked/);
});

test('other unresolved review restrictions cannot be bypassed by omitting its ID', () => {
  const project = fixture();
  project.reviews.push({ ...project.reviews[0], id: 'r3', status: 'review', protectedProperties: ['style.text'] });
  assert.throws(() => applyPatch(project, patch()), /Protected/);
});

test('feedback exports effective restrictions from unresolved reviews without exporting their work twice', () => {
  const project = fixture();
  project.reviews.push({ ...project.reviews[0], id: 'r-modified', status: 'modified', protectedProperties: ['style.text', 'frame'] });
  project.reviews.push({ ...project.reviews[0], id: 'r-awaiting-approval', status: 'review', protectedProperties: ['style.fontSize'] });
  project.reviews.push({ ...project.reviews[0], id: 'r-approved', status: 'approved', protectedProperties: ['style.color'] });
  const feedback = buildFeedback(project);
  assert.deepEqual(feedback.reviews.map(review => review.id), ['r1']);
  assert.deepEqual(feedback.effectiveProtectedProperties, { button: ['frame', 'style.fill', 'style.text', 'style.fontSize'] });
  assert.throws(() => applyPatch(project, patch()), /Protected/);
  assert.match(feedback.instructions, /effectiveProtectedProperties/);
});

test('rollback restores exact fields and review status, preserving unrelated changes', () => {
  const project = applyPatch(fixture(), patch());
  project.nodes[2].frame.x = 200;
  project.reviews[0].status = 'approved';
  const restored = rollbackPatch(project, project.history[0].id);
  assert.equal(restored.nodes[1].style.text, 'RECRUIT');
  assert.equal(restored.nodes[2].frame.x, 200);
  assert.equal(restored.reviews[0].status, 'pending');
  assert.equal(restored.history[0].rolledBack, true);
  assert.equal(restored.history[1].kind, 'rollback');
  assert.equal(restored.revision, 6);
  assert.throws(() => rollbackPatch(restored, restored.history[0].id), /already/);
});

test('rollback conflicts are detected without erasing later edits', () => {
  const project = applyPatch(fixture(), patch());
  project.nodes[1].style.text = 'MANUAL EDIT';
  assert.throws(() => rollbackPatch(project, project.history[0].id), /Rollback conflict/);
  assert.equal(project.nodes[1].style.text, 'MANUAL EDIT');
});

test('rollback survives JSON disk roundtrip and removes newly added optional properties', () => {
  const project = applyPatch(fixture(), patch({ changes: [{ nodeId: 'button', set: { 'style.fontSize': 24 } }] }));
  const restored = rollbackPatch(JSON.parse(JSON.stringify(project)), project.history[0].id);
  assert.equal(Object.hasOwn(restored.nodes[1].style, 'fontSize'), false);
});

test('feedback includes only pending reviews, targets, ancestors, used assets and relevant screenshots', () => {
  const data = buildFeedback(fixture(), { button: 'data:image/png;base64,aGVsbG8=', other: 'data:image/png;base64,aGVsbG8=' });
  assert.deepEqual(data.reviews.map(item => item.id), ['r1']);
  assert.deepEqual(data.nodes.map(item => item.id), ['button']);
  assert.deepEqual(data.context.map(item => item.id), ['root']);
  assert.deepEqual(data.assets.map(item => item.id), ['art']);
  assert.deepEqual(Object.keys(data.screenshots), ['button']);
  assert.equal(data.baseRevision, 4);
  assert.deepEqual(data.reviews[0].protectedProperties, ['frame', 'style.fill']);
  const project = fixture(); project.reviews[0].status = 'modified';
  assert.equal(buildFeedback(project).nodes.length, 0);
});

test('validation rejects broken graphs, duplicate IDs, invalid sizes, traversal and prototype pollution', () => {
  const cycle = fixture(); cycle.nodes[0].parentId = 'button';
  assert.throws(() => validateProject(cycle), /cycle/);
  const orphan = fixture(); orphan.nodes[1].parentId = 'missing';
  assert.throws(() => validateProject(orphan), /Missing parent/);
  const duplicate = fixture(); duplicate.nodes.push(structuredClone(duplicate.nodes[0]));
  assert.throws(() => validateProject(duplicate), /Duplicate/);
  const dimensions = fixture(); dimensions.nodes[0].frame.width = -5;
  assert.throws(() => validateProject(dimensions), /Invalid frame.width/);
  const traversal = fixture(); traversal.assets[0].src = '/assets/../../secret.svg';
  assert.throws(() => validateProject(traversal), /safe local/);
  const proto = fixture(); proto.tokens = JSON.parse('{"__proto__":{"admin":true}}');
  assert.throws(() => validateProject(proto), /Unsafe/);
  assert.equal({}.admin, undefined);
});

test('layout preserves free positioning and gives containers the placement authority', () => {
  const project = fixture();
  project.nodes = [
    makeNode('free', 'Control', null, { x: 20, y: 30 }),
    makeNode('free-child', 'Panel', 'free', { x: 7, y: 9 }),
    { ...makeNode('row', 'HBoxContainer', null, { x: 200, y: 100, width: 300, height: 80 }), layout: { mode: 'horizontal', padding: 10, gap: 5 } },
    makeNode('first', 'Button', 'row', { x: 1000, y: 1000, width: 50, height: 20 }),
    makeNode('second', 'Button', 'row', { width: 70, height: 20 }),
    { ...makeNode('column', 'VBoxContainer', null, { x: 500, y: 100, width: 100, height: 200 }), layout: { mode: 'vertical', padding: 4, gap: 8 } },
    makeNode('top', 'Panel', 'column', { width: 20, height: 30 }),
    makeNode('bottom', 'Panel', 'column', { width: 20, height: 40 }),
  ];
  const layout = computeLayout(project);
  assert.deepEqual(layout.get('free-child'), { x: 27, y: 39, width: 100, height: 40 });
  assert.deepEqual(layout.get('first'), { x: 210, y: 110, width: 50, height: 60 });
  assert.equal(layout.get('second').x, 265);
  assert.deepEqual(layout.get('top'), { x: 504, y: 104, width: 92, height: 30 });
  assert.equal(layout.get('bottom').y, 142);
});

test('diff exposes scalar before and after values without reserializing the whole screen', () => {
  const before = fixture(); const after = structuredClone(before);
  after.nodes[1].style.text = 'New label';
  after.nodes[1].frame.x += 4;
  const diff = diffProjects(before, after);
  assert.equal(diff.length, 2);
  assert.deepEqual(diff.map(change => change.path), ['frame.x', 'style.text']);
  assert.equal(diff[1].before, 'RECRUIT');
  assert.equal(diff[1].after, 'New label');
});

test('font files referenced by selected styles and design tokens accompany the feedback', () => {
  const project = fixture();
  project.assets.push({ id: 'font-serif', name: 'Studio Serif', kind: 'font', src: '/assets/studio-serif.ttf' });
  project.assets.push({ id: 'font-unused', name: 'Unused Typeface', kind: 'font', src: '/assets/unused.ttf' });
  project.nodes[1].style.fontFamily = 'Studio Serif';
  assert.deepEqual(buildFeedback(project).assets.map(asset => asset.id), ['art', 'font-serif']);
});

test('nested containers propagate minimum dimensions and hidden children do not reserve space', () => {
  const project = fixture();
  project.nodes = [
    { ...makeNode('row', 'HBoxContainer', null, { x: 10, y: 10, width: 20, height: 20 }), layout: { mode: 'horizontal', padding: 4, gap: 5 } },
    { ...makeNode('hidden', 'Button', 'row', { width: 1000, height: 1000 }), visible: false },
    { ...makeNode('inner', 'MarginContainer', 'row', { width: 10, height: 10 }), layout: { mode: 'free', padding: 2 } },
    makeNode('inner-child', 'Button', 'inner', { width: 40, height: 30 }),
    makeNode('next', 'Button', 'row', { width: 20, height: 20 }),
  ];
  const layout = computeLayout(project);
  assert.deepEqual(layout.get('row'), { x: 10, y: 10, width: 77, height: 42 });
  assert.deepEqual(layout.get('inner'), { x: 14, y: 14, width: 44, height: 34 });
  assert.deepEqual(layout.get('inner-child'), { x: 16, y: 16, width: 40, height: 30 });
  assert.equal(layout.get('next').x, 63);
  assert.equal(layout.has('hidden'), true);
});

test('patches cannot claim to reposition a child whose coordinates are controlled by a Container', () => {
  const project = fixture();
  project.nodes[0].type = 'HBoxContainer';
  project.reviews[0].protectedProperties = [];
  assert.throws(() => applyPatch(project, patch({ changes: [{ nodeId: 'button', set: { 'frame.x': 300 } }] })), /controlled by its Container/);
});
