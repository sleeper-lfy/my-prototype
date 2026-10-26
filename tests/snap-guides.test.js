import test from 'node:test';
import assert from 'node:assert/strict';
import { snapRectangle, movableSelection, descendantsOf, alignmentUpdates } from '../src/snapGuides.js';
import { computeLayout, validateProject } from '../src/model.js';

const target = { id: 'sibling', rect: { x: 280, y: 200, width: 120, height: 100 } };
const moving = { x: 282, y: 70, width: 80, height: 60 };
test('smart guides snap moving left, center and right anchors to exact sibling geometry', () => {
  const left = snapRectangle({ rect: moving, targets: [target], zoom: 1 });
  assert.equal(left.x, 280);
  assert.ok(left.guides.some(guide => guide.axis === 'x' && guide.value === 280 && guide.kind === 'edge'));
  const center = snapRectangle({ rect: { ...moving, x: 302 }, targets: [target], zoom: 1 });
  assert.equal(center.x, 300);
  assert.ok(center.guides.some(guide => guide.axis === 'x' && guide.value === 340 && guide.kind === 'center'));
  const right = snapRectangle({ rect: { ...moving, x: 318 }, targets: [target], zoom: 1 });
  assert.equal(right.x, 320);
  assert.ok(right.guides.some(guide => guide.value === 400));
  const bottom = snapRectangle({ rect: { ...moving, x: 30, y: 239 }, targets: [target], zoom: 1 });
  assert.equal(bottom.y, 240);
  assert.ok(bottom.guides.some(guide => guide.axis === 'y' && guide.value === 300));
});

test('guide tolerance is in screen pixels and nearest target wins independent of order', () => {
  assert.equal(snapRectangle({ rect: { ...moving, x: 288 }, targets: [target], zoom: .5 }).x, 280);
  assert.equal(snapRectangle({ rect: { ...moving, x: 284 }, targets: [target], zoom: 2 }).guides.some(guide => guide.axis === 'x'), false);
  const other = { id: 'farther', rect: { x: 276, y: 200, width: 120, height: 100 } };
  assert.equal(snapRectangle({ rect: moving, targets: [other, target] }).x, 280);
  assert.equal(snapRectangle({ rect: moving, targets: [target, other] }).x, 280);
});

test('canvas centers are snap targets; disabled snapping preserves position without fake guides', () => {
  const canvas = { width: 800, height: 600 };
  const snapped = snapRectangle({ rect: { x: 362, y: 271, width: 80, height: 60 }, canvas });
  assert.equal(snapped.x, 360); assert.equal(snapped.y, 270);
  assert.ok(snapped.guides.some(guide => guide.kind === 'center' && guide.targetId === 'canvas'));
  const free = snapRectangle({ rect: moving, targets: [target], enabled: false });
  assert.equal(free.x, 282); assert.equal(free.y, 70); assert.deepEqual(free.guides, []);
  const grid = snapRectangle({ rect: { ...moving, x: 51, y: 53 }, targets: [] });
  assert.equal(grid.x, 48); assert.equal(grid.y, 56); assert.deepEqual(grid.guides, []);
});

const node = (id, x, y, width, height, parentId = null, type = 'Panel', locked = false) => ({ id, name: id, type, parentId, frame: { x, y, width, height }, style: {}, layout: { mode: type === 'HBoxContainer' ? 'horizontal' : 'free' }, visible: true, locked });
function project() {
  return validateProject({ schemaVersion: 1, id: 'alignment', name: 'Alignment fixture', revision: 1,
    canvas: { width: 800, height: 600, background: '#182118' }, tokens: {}, assets: [], reviews: [], history: [],
    nodes: [node('a', 70, 80, 80, 60), node('b', 280, 200, 120, 100), node('c', 550, 380, 100, 80),
      node('parent', 300, 200, 200, 200, null, 'Control'), node('child', 10, 20, 50, 40, 'parent'),
      node('locked', 50, 50, 100, 100, null, 'Control', true), node('locked-child', 5, 5, 10, 10, 'locked'),
      node('row', 0, 500, 500, 80, null, 'HBoxContainer'), node('auto-child', 0, 0, 50, 50, 'row')] });
}
test('moving a selection moves ancestors once and respects locks and Container layout', () => {
  const doc = project();
  const roots = movableSelection(doc, ['parent', 'child', 'a', 'locked', 'locked-child', 'auto-child']);
  assert.deepEqual(roots.map(item => item.id), ['a', 'parent']);
  assert.deepEqual([...descendantsOf(doc, roots.map(item => item.id))].sort(), ['a', 'child', 'parent']);
  assert.deepEqual(movableSelection(doc, ['child']).map(item => item.id), ['child']);
});

test('alignment uses world geometry but stores parent-relative frames without modifying descendants twice', () => {
  const doc = project(), initial = structuredClone(doc);
  const updates = alignmentUpdates(doc, ['a', 'child'], 'right');
  for (const change of updates) Object.assign(doc.nodes.find(item => item.id === change.nodeId).frame, { x: change.x, y: change.y });
  const layout = computeLayout(doc);
  assert.equal(layout.get('a').x + layout.get('a').width, layout.get('child').x + layout.get('child').width);
  assert.deepEqual(doc.nodes.find(item => item.id === 'parent'), initial.nodes.find(item => item.id === 'parent'));
  const parentUpdates = alignmentUpdates(initial, ['a', 'parent', 'child', 'locked-child', 'auto-child'], 'bottom');
  assert.ok(parentUpdates.every(change => ['a', 'parent'].includes(change.nodeId)));
  assert.deepEqual(initial, project());
});

test('all alignment directions and equal-gap distribution preserve each component size', () => {
  for (const mode of ['left', 'center', 'right', 'top', 'middle', 'bottom', 'distributeX', 'distributeY']) {
    const doc = project();
    const before = structuredClone(doc);
    for (const change of alignmentUpdates(doc, ['a', 'b', 'c'], mode)) Object.assign(doc.nodes.find(item => item.id === change.nodeId).frame, { x: change.x, y: change.y });
    validateProject(doc);
    const frames = doc.nodes.slice(0, 3).map(item => item.frame);
    for (let index = 0; index < 3; index++) { assert.equal(frames[index].width, before.nodes[index].frame.width); assert.equal(frames[index].height, before.nodes[index].frame.height); }
    if (mode === 'distributeX') assert.equal(frames[1].x - frames[0].x - frames[0].width, frames[2].x - frames[1].x - frames[1].width);
    else if (mode === 'distributeY') assert.equal(frames[1].y - frames[0].y - frames[0].height, frames[2].y - frames[1].y - frames[1].height);
    else {
      const values = frames.map(frame => mode === 'left' ? frame.x : mode === 'center' ? frame.x + frame.width / 2 : mode === 'right' ? frame.x + frame.width : mode === 'top' ? frame.y : mode === 'middle' ? frame.y + frame.height / 2 : frame.y + frame.height);
      assert.equal(new Set(values).size, 1, mode);
    }
  }
  assert.deepEqual(alignmentUpdates(project(), ['a', 'b'], 'distributeX'), []);
});
