import { computeLayout } from './model.js';

const round = value => Math.round(value * 1000) / 1000;
const anchors = (rect, axis) => {
  const start = axis === 'x' ? rect.x : rect.y;
  const size = axis === 'x' ? rect.width : rect.height;
  return [{ value: start, name: 'start' }, { value: start + size / 2, name: 'center' }, { value: start + size, name: 'end' }];
};

/** Match all three moving anchors, with an invariant tolerance in screen pixels. */
export function snapRectangle({ rect, targets = [], canvas, zoom = 1, enabled = true, tolerance = 6, grid = 8 }) {
  if (!enabled) return { x: round(rect.x), y: round(rect.y), guides: [] };
  const scale = Math.max(0.01, zoom);
  const references = [...targets];
  if (canvas) references.push({ id: 'canvas', rect: { x: 0, y: 0, width: canvas.width, height: canvas.height } });
  const result = { x: rect.x, y: rect.y, guides: [] };
  for (const axis of ['x', 'y']) {
    const candidates = [];
    for (const target of references) {
      for (const destination of anchors(target.rect, axis)) {
        for (const moving of anchors(rect, axis)) {
          const delta = destination.value - moving.value;
          if (Math.abs(delta) * scale <= tolerance + 1e-8) candidates.push({ target, destination, moving, delta });
        }
      }
    }
    candidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta)
      || Number(b.moving.name === b.destination.name) - Number(a.moving.name === a.destination.name)
      || a.target.id.localeCompare(b.target.id)
      || a.moving.name.localeCompare(b.moving.name));
    const best = candidates[0];
    result[axis] = round(best ? rect[axis] + best.delta : grid > 0 ? Math.round(rect[axis] / grid) * grid : rect[axis]);
    if (!best) continue;
    const seen = new Set();
    // A single correction can align multiple edges/centers. Show those exact matches.
    for (const candidate of candidates.filter(item => Math.abs(item.delta - best.delta) < 1e-7)) {
      const identity = round(candidate.destination.value);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const cross = axis === 'x' ? 'y' : 'x';
      const size = axis === 'x' ? 'height' : 'width';
      const kind = candidate.moving.name === 'center' && candidate.destination.name === 'center' ? 'center' : 'edge';
      result.guides.push({ axis, value: identity, from: Math.min(rect[cross], candidate.target.rect[cross]) - 12 / scale,
        to: Math.max(rect[cross] + rect[size], candidate.target.rect[cross] + candidate.target.rect[size]) + 12 / scale,
        kind, targetId: candidate.target.id });
      if (seen.size >= 3) break;
    }
  }
  return result;
}

/** Selected free-layout roots only: descendants move with ancestors once. */
export function movableSelection(project, selectedIds) {
  const selected = new Set(selectedIds), byId = new Map(project.nodes.map(node => [node.id, node]));
  const eligible = project.nodes.filter(node => {
    if (!selected.has(node.id) || byId.get(node.parentId)?.type.endsWith('Container')) return false;
    for (let current = node; current; current = byId.get(current.parentId)) if (current.locked || current.visible === false) return false;
    return true;
  });
  const eligibleIds = new Set(eligible.map(node => node.id));
  return eligible.filter(node => {
    for (let parent = byId.get(node.parentId); parent; parent = byId.get(parent.parentId)) if (eligibleIds.has(parent.id)) return false;
    return true;
  });
}

export function descendantsOf(project, rootIds) {
  const result = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of project.nodes) if (result.has(node.parentId) && !result.has(node.id)) { result.add(node.id); changed = true; }
  }
  return result;
}

export function selectionBounds(rectangles) {
  if (!rectangles.length) return null;
  const x = Math.min(...rectangles.map(rect => rect.x)), y = Math.min(...rectangles.map(rect => rect.y));
  return { x, y, width: Math.max(...rectangles.map(rect => rect.x + rect.width)) - x, height: Math.max(...rectangles.map(rect => rect.y + rect.height)) - y };
}

/** Return parent-relative positions; locked nodes and Container children never move. */
export function alignmentUpdates(project, selectedIds, mode) {
  const supported = ['left', 'center', 'right', 'top', 'middle', 'bottom', 'distributeX', 'distributeY'];
  if (!supported.includes(mode)) return [];
  const nodes = movableSelection(project, selectedIds), layout = computeLayout(project);
  if (nodes.length < (mode.startsWith('distribute') ? 3 : 2)) return [];
  const bounds = selectionBounds(nodes.map(node => layout.get(node.id)));
  const changes = new Map(nodes.map(node => [node.id, { nodeId: node.id, x: node.frame.x, y: node.frame.y }]));
  if (mode.startsWith('distribute')) {
    const axis = mode === 'distributeX' ? 'x' : 'y', size = axis === 'x' ? 'width' : 'height';
    const sorted = [...nodes].sort((a, b) => layout.get(a.id)[axis] - layout.get(b.id)[axis] || a.id.localeCompare(b.id));
    const gap = (bounds[size] - sorted.reduce((sum, node) => sum + layout.get(node.id)[size], 0)) / (sorted.length - 1);
    let position = bounds[axis];
    for (const node of sorted) {
      changes.get(node.id)[axis] = round(position - (layout.get(node.parentId)?.[axis] || 0));
      position += layout.get(node.id)[size] + gap;
    }
  } else {
    for (const node of nodes) {
      const rect = layout.get(node.id), parent = layout.get(node.parentId) || { x: 0, y: 0 }, value = changes.get(node.id);
      if (mode === 'left') value.x = bounds.x - parent.x;
      if (mode === 'center') value.x = bounds.x + (bounds.width - rect.width) / 2 - parent.x;
      if (mode === 'right') value.x = bounds.x + bounds.width - rect.width - parent.x;
      if (mode === 'top') value.y = bounds.y - parent.y;
      if (mode === 'middle') value.y = bounds.y + (bounds.height - rect.height) / 2 - parent.y;
      if (mode === 'bottom') value.y = bounds.y + bounds.height - rect.height - parent.y;
    }
  }
  return [...changes.values()].filter(change => { const node = nodes.find(item => item.id === change.nodeId); return change.x !== node.frame.x || change.y !== node.frame.y; });
}
