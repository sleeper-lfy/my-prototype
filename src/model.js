/** Shared, dependency-free document and review model. No renderer or filesystem state. */
export const NODE_TYPES = ['Control', 'TextureRect', 'Label', 'Button', 'Panel', 'HBoxContainer', 'VBoxContainer', 'MarginContainer'];
export const REVIEW_STATUSES = ['pending', 'modified', 'review', 'approved'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const clone = value => structuredClone(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const finite = (value, minimum, maximum) => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
const string = (value, maximum = 20000) => typeof value === 'string' && value.length <= maximum;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const color = value => typeof value === 'string' && /^(#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|transparent)$/i.test(value);
const enumOf = values => value => values.includes(value);

const FIELD_CHECKS = {
  name: value => string(value, 200) && value.trim().length > 0,
  'frame.x': value => finite(value, -32768, 32768),
  'frame.y': value => finite(value, -32768, 32768),
  'frame.width': value => finite(value, 1, 16384),
  'frame.height': value => finite(value, 1, 16384),
  'style.fill': color,
  'style.stroke': color,
  'style.strokeWidth': value => finite(value, 0, 100),
  'style.radius': value => finite(value, 0, 4096),
  'style.color': color,
  'style.fontSize': value => finite(value, 1, 512),
  'style.fontFamily': value => string(value, 200),
  'style.fontStyle': enumOf(['normal', 'bold', 'italic', 'bold italic']),
  'style.text': value => string(value),
  'style.align': enumOf(['left', 'center', 'right']),
  'style.opacity': value => finite(value, 0, 1),
  'style.letterSpacing': value => finite(value, -20, 100),
  'style.lineHeight': value => finite(value, 0.5, 4),
  'layout.mode': enumOf(['free', 'horizontal', 'vertical']),
  'layout.gap': value => finite(value, 0, 1024),
  'layout.padding': value => finite(value, 0, 1024),
  assetId: value => value === null || id(value),
  'buttonAssets.normal': value => value === null || id(value),
  'buttonAssets.hover': value => value === null || id(value),
  'buttonAssets.pressed': value => value === null || id(value),
  visible: value => typeof value === 'boolean',
};

export const PATCH_FIELDS = Object.freeze(Object.keys(FIELD_CHECKS));

function assertJson(value, depth = 0) {
  if (depth > 32) fail('Document is too deeply nested.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('Non-finite numbers are not allowed.'); return; }
  if (typeof value !== 'object') fail('Only JSON values are allowed.');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('Only plain JSON objects are allowed.');
  for (const key of Object.keys(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(`Unsafe property: ${key}`);
    assertJson(value[key], depth + 1);
  }
}

function getPath(object, path) {
  let value = object;
  for (const part of path.split('.')) {
    if (!record(value) || !own(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

function setPath(object, path, value, exists = true) {
  const parts = path.split('.');
  const final = parts.pop();
  let target = object;
  for (const part of parts) {
    if (!record(target[part])) target[part] = {};
    target = target[part];
  }
  if (exists) target[final] = value;
  else delete target[final];
}

function uniqueRecords(items, label, maximum) {
  if (!Array.isArray(items) || items.length > maximum) fail(`${label} must be an array of at most ${maximum} records.`);
  const index = new Map();
  for (const item of items) {
    if (!record(item) || !id(item.id)) fail(`${label} contains an invalid stable ID.`);
    if (index.has(item.id)) fail(`Duplicate ${label} ID: ${item.id}`);
    index.set(item.id, item);
  }
  return index;
}

function validateNodeFields(node) {
  for (const path of Object.keys(FIELD_CHECKS)) {
    const value = getPath(node, path);
    if (value !== undefined && !FIELD_CHECKS[path](value)) fail(`Invalid ${path} on node ${node.id}.`);
  }
  if (!record(node.frame) || !['x', 'y', 'width', 'height'].every(key => own(node.frame, key))) fail(`Node ${node.id} needs a complete frame.`);
  for (const section of ['style', 'layout', 'buttonAssets']) {
    if (node[section] !== undefined && !record(node[section])) fail(`Invalid ${section} on node ${node.id}.`);
  }
  if (node.locked !== undefined && typeof node.locked !== 'boolean') fail(`Invalid locked flag on node ${node.id}.`);
  const expectedMode = node.type === 'HBoxContainer' ? 'horizontal' : node.type === 'VBoxContainer' ? 'vertical' : 'free';
  if (node.layout?.mode !== undefined && node.layout.mode !== expectedMode) fail(`Node ${node.id} uses ${node.type}; its layout mode must be ${expectedMode}.`);
}

/** Throws before any mutation when a document is malformed. Returns the original document. */
export function validateProject(project) {
  assertJson(project);
  if (!record(project) || project.schemaVersion !== 1) fail('Unsupported project schemaVersion; expected 1.');
  if (!id(project.id) || !string(project.name, 200) || !project.name.trim()) fail('Project ID and name are required.');
  if (!Number.isSafeInteger(project.revision) || project.revision < 0) fail('Project revision must be a non-negative integer.');
  if (!record(project.canvas) || !finite(project.canvas.width, 1, 16384) || !finite(project.canvas.height, 1, 16384) || !color(project.canvas.background)) fail('Invalid canvas dimensions or background.');
  if (!record(project.tokens)) fail('Project design tokens must be an object.');
  if (project.tokens.colors && (!record(project.tokens.colors) || !Object.values(project.tokens.colors).every(color))) fail('Invalid design token colors.');
  if (project.tokens.fonts && (!record(project.tokens.fonts) || !Object.values(project.tokens.fonts).every(value => string(value, 200)))) fail('Invalid design token fonts.');
  if (project.tokens.rules && (!Array.isArray(project.tokens.rules) || !project.tokens.rules.every(value => string(value, 2000)))) fail('Invalid design rules.');

  const nodes = uniqueRecords(project.nodes, 'node', 2000);
  const assets = uniqueRecords(project.assets, 'asset', 1000);
  const reviews = uniqueRecords(project.reviews, 'review', 2000);
  uniqueRecords(project.history, 'history', 2000);
  for (const asset of assets.values()) {
    if (!string(asset.name, 200) || !string(asset.kind, 80)) fail(`Invalid asset metadata: ${asset.id}`);
    if (typeof asset.src !== 'string' || !/^\/(assets|local-assets)\/[A-Za-z0-9_/-]+\.(svg|png|jpe?g|webp|ttf|otf)$/i.test(asset.src) || asset.src.split('/').includes('..')) fail(`Asset ${asset.id} must reference a safe local asset path.`);
    if (asset.margins !== undefined && (!record(asset.margins) || !['left', 'top', 'right', 'bottom'].every(key => finite(asset.margins[key], 0, 4096)))) fail(`Invalid nine-slice margins: ${asset.id}`);
  }
  for (const node of nodes.values()) {
    if (!NODE_TYPES.includes(node.type)) fail(`Unsupported node type: ${node.type}`);
    if (!string(node.name, 200) || !node.name.trim()) fail(`Node ${node.id} needs a name.`);
    if (node.parentId !== null && (!id(node.parentId) || !nodes.has(node.parentId))) fail(`Missing parent of node ${node.id}.`);
    validateNodeFields(node);
    for (const assetId of [node.assetId, ...Object.values(node.buttonAssets || {})]) {
      if (assetId !== undefined && assetId !== null && !assets.has(assetId)) fail(`Node ${node.id} references missing asset ${assetId}.`);
    }
    const ancestors = new Set([node.id]);
    let parent = nodes.get(node.parentId);
    while (parent) {
      if (ancestors.has(parent.id)) fail(`Parent cycle involving ${node.id}.`);
      ancestors.add(parent.id);
      parent = nodes.get(parent.parentId);
    }
  }
  for (const review of reviews.values()) {
    if (!nodes.has(review.nodeId)) fail(`Review ${review.id} references a missing component.`);
    if (!string(review.target, 2000) || !review.target.trim() || !string(review.expected, 4000) || !review.expected.trim()) fail(`Review ${review.id} needs a target and expected result.`);
    if (!['low', 'medium', 'high', 'critical'].includes(review.priority) || !REVIEW_STATUSES.includes(review.status)) fail(`Invalid priority/status on review ${review.id}.`);
    if (!Array.isArray(review.protectedProperties) || !review.protectedProperties.every(path => typeof path === 'string' && (own(FIELD_CHECKS, path) || ['frame', 'style', 'layout', 'buttonAssets', 'id', 'type', 'parentId', 'locked'].includes(path)))) fail(`Invalid protected properties on review ${review.id}.`);
    if (!string(review.createdAt, 100) || !Number.isFinite(Date.parse(review.createdAt))) fail(`Review ${review.id} needs a valid creation date.`);
  }
  return project;
}

export function makeId(prefix = 'item') {
  const safePrefix = String(prefix).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50) || 'item';
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${safePrefix}-${suffix}`;
}

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const protectedBy = (path, protectedPath) => path === protectedPath || path.startsWith(`${protectedPath}.`) || protectedPath.startsWith(`${path}.`);

/** Atomic scalar-only patch, scoped to the supplied still-pending reviews. */
export function applyPatch(project, patch) {
  validateProject(project);
  assertJson(patch);
  if (!record(patch) || patch.schemaVersion !== 1 || patch.projectId !== project.id) fail('Patch does not belong to this project/schema.');
  if (patch.baseRevision !== project.revision) fail(`Stale patch: expected revision ${project.revision}, received ${patch.baseRevision}. Export a new feedback package.`);
  if (!string(patch.summary, 2000) || !patch.summary.trim()) fail('Patch summary is required.');
  if (!Array.isArray(patch.reviewIds) || !patch.reviewIds.length || new Set(patch.reviewIds).size !== patch.reviewIds.length) fail('Patch must list unique pending review IDs.');
  if (!Array.isArray(patch.changes) || !patch.changes.length || patch.changes.length > 2000) fail('Patch must include component changes.');
  const reviewIndex = new Map(project.reviews.map(review => [review.id, review]));
  const selectedReviews = patch.reviewIds.map(reviewId => {
    const review = reviewIndex.get(reviewId);
    if (!review || review.status !== 'pending') fail(`Review ${reviewId} is missing or is no longer pending.`);
    return review;
  });
  const targetIds = new Set(selectedReviews.map(review => review.nodeId));
  const nodes = new Map(project.nodes.map(node => [node.id, node]));
  const seen = new Set();
  const diffs = [];
  for (const change of patch.changes) {
    if (!record(change) || !targetIds.has(change.nodeId) || !nodes.has(change.nodeId)) fail(`Component ${change?.nodeId} is outside the selected review scope.`);
    const node = nodes.get(change.nodeId);
    const parent = nodes.get(node.parentId);
    let lockedNode = node;
    while (lockedNode) {
      if (lockedNode.locked) fail(`Component ${node.id} or its parent is locked.`);
      lockedNode = nodes.get(lockedNode.parentId);
    }
    if (!record(change.set) || !Object.keys(change.set).length) fail(`Empty changes for component ${node.id}.`);
    const restrictions = project.reviews.filter(review => review.nodeId === node.id && review.status !== 'approved').flatMap(review => review.protectedProperties);
    for (const [path, after] of Object.entries(change.set)) {
      if (!own(FIELD_CHECKS, path)) fail(`Property is not patchable: ${path}`);
      if (!FIELD_CHECKS[path](after)) fail(`Invalid value for ${path} on ${node.id}.`);
      if (['frame.x', 'frame.y'].includes(path) && parent?.type.endsWith('Container')) fail(`Position of ${node.id} is controlled by its Container; edit the container layout instead.`);
      const fieldKey = `${node.id}:${path}`;
      if (seen.has(fieldKey)) fail(`Duplicate patch property: ${fieldKey}`);
      seen.add(fieldKey);
      if (restrictions.some(restricted => protectedBy(path, restricted))) fail(`Protected property: ${node.id}.${path}`);
      const before = getPath(node, path);
      if (!equal(before, after)) diffs.push({ nodeId: node.id, path, before: before === undefined ? null : clone(before), beforeExists: before !== undefined, after: clone(after) });
    }
  }
  if (!diffs.length) fail('Patch makes no changes.');
  const changedIds = new Set(diffs.map(change => change.nodeId));
  if (selectedReviews.some(review => !changedIds.has(review.nodeId))) fail('Every addressed review must have an actual component change.');
  const result = clone(project);
  const newNodes = new Map(result.nodes.map(node => [node.id, node]));
  for (const diff of diffs) setPath(newNodes.get(diff.nodeId), diff.path, diff.after);
  for (const review of result.reviews) if (patch.reviewIds.includes(review.id)) review.status = 'modified';
  result.revision += 1;
  result.history.push({ id: makeId('patch'), kind: 'patch', summary: patch.summary, createdAt: new Date().toISOString(), baseRevision: project.revision, revision: result.revision, reviewIds: [...patch.reviewIds], reviewStatuses: Object.fromEntries(selectedReviews.map(review => [review.id, review.status])), changes: diffs, rolledBack: false });
  validateProject(result);
  return result;
}

/** Restore just the patch fields; refuse to overwrite later edits to those fields. */
export function rollbackPatch(project, historyId) {
  validateProject(project);
  const entry = project.history.find(item => item.id === historyId);
  if (!entry || entry.kind !== 'patch' || entry.rolledBack) fail('Patch is missing or has already been rolled back.');
  if (!Array.isArray(entry.changes) || !entry.changes.length) fail('Patch has no recoverable field history.');
  const nodes = new Map(project.nodes.map(node => [node.id, node]));
  for (const change of entry.changes) {
    if (!record(change) || !own(FIELD_CHECKS, change.path)) fail('History contains an invalid field.');
    const node = nodes.get(change.nodeId);
    if (!node || !equal(getPath(node, change.path), change.after)) fail(`Rollback conflict: ${change.nodeId}.${change.path} changed after this patch.`);
    let ancestor = node;
    while (ancestor) {
      if (ancestor.locked) fail(`Cannot roll back locked component ${node.id}.`);
      ancestor = nodes.get(ancestor.parentId);
    }
  }
  const result = clone(project);
  const newNodes = new Map(result.nodes.map(node => [node.id, node]));
  for (const change of entry.changes) setPath(newNodes.get(change.nodeId), change.path, clone(change.before), change.beforeExists !== false);
  for (const review of result.reviews) {
    if (entry.reviewIds?.includes(review.id)) review.status = entry.reviewStatuses?.[review.id] || 'pending';
  }
  result.history.find(item => item.id === historyId).rolledBack = true;
  result.revision += 1;
  result.history.push({ id: makeId('rollback'), kind: 'rollback', summary: `Rollback: ${entry.summary}`, createdAt: new Date().toISOString(), baseRevision: project.revision, revision: result.revision, rollbackOf: entry.id, reviewIds: [...(entry.reviewIds || [])], changes: entry.changes.map(change => ({ nodeId: change.nodeId, path: change.path, before: change.after, beforeExists: true, after: change.before, afterExists: change.beforeExists !== false })) });
  validateProject(result);
  return result;
}

/** A compact exchange package: only actionable target components, ancestors and used assets. */
export function buildFeedback(project, nodeScreenshots = {}) {
  validateProject(project);
  if (!record(nodeScreenshots)) fail('Screenshots must be indexed by component ID.');
  const reviews = project.reviews.filter(review => review.status === 'pending');
  const targetIds = new Set(reviews.map(review => review.nodeId));
  const nodesById = new Map(project.nodes.map(node => [node.id, node]));
  const contextIds = new Set();
  for (const nodeId of targetIds) {
    let parent = nodesById.get(nodesById.get(nodeId).parentId);
    while (parent) {
      if (!targetIds.has(parent.id)) contextIds.add(parent.id);
      parent = nodesById.get(parent.parentId);
    }
  }
  const selected = project.nodes.filter(node => targetIds.has(node.id));
  // An earlier, already modified review can still constrain the same component.
  // Export its constraints without re-exporting that review as actionable work.
  const effectiveProtectedProperties = Object.fromEntries([...targetIds].map(nodeId => [nodeId,
    [...new Set(project.reviews.filter(review => review.nodeId === nodeId && review.status !== 'approved').flatMap(review => review.protectedProperties))],
  ]));
  const context = project.nodes.filter(node => contextIds.has(node.id)).map(node => ({ id: node.id, name: node.name, type: node.type, parentId: node.parentId, frame: clone(node.frame), layout: clone(node.layout || { mode: 'free', gap: 0, padding: 0 }), locked: Boolean(node.locked) }));
  const assetIds = new Set(selected.flatMap(node => [node.assetId, ...Object.values(node.buttonAssets || {})]).filter(Boolean));
  const fontNames = new Set([...selected.map(node => node.style?.fontFamily), ...Object.values(project.tokens.fonts || {})].filter(Boolean));
  for (const asset of project.assets) if (asset.kind === 'font' && fontNames.has(asset.name)) assetIds.add(asset.id);
  const screenshots = {};
  for (const nodeId of targetIds) {
    const shot = nodeScreenshots[nodeId];
    if (shot !== undefined) {
      if (typeof shot !== 'string' || shot.length > 8_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(shot)) fail(`Invalid PNG screenshot for ${nodeId}.`);
      screenshots[nodeId] = shot;
    }
  }
  return {
    schemaVersion: 1,
    projectId: project.id,
    projectName: project.name,
    baseRevision: project.revision,
    generatedAt: new Date().toISOString(),
    canvas: clone(project.canvas),
    reviews: clone(reviews),
    nodes: clone(selected),
    effectiveProtectedProperties,
    context,
    tokens: clone(project.tokens),
    assets: clone(project.assets.filter(asset => assetIds.has(asset.id))),
    screenshots,
    instructions: 'Return a schemaVersion:1 patch with projectId, baseRevision, summary, reviewIds and changes [{nodeId,set:{"style.text":"..."}}]. Change only listed components and allowed scalar fields. Keep IDs and respect effectiveProtectedProperties for each component, including restrictions from other unresolved reviews. Do not regenerate the whole document. Approval is manual.',
    allowedProperties: [...PATCH_FIELDS],
  };
}

/** Resolve parent-relative free layout and the minimal Container layout shared by editor/exporter. */
export function computeLayout(project) {
  const nodes = project.nodes || [];
  const children = new Map();
  for (const node of nodes) {
    const parentId = node.parentId ?? null;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(node);
  }
  const result = new Map();
  const active = new Set();
  const minimums = new Map();
  const measuring = new Set();
  const minimum = node => {
    if (minimums.has(node.id)) return minimums.get(node.id);
    if (measuring.has(node.id)) fail('Cannot compute a cyclic layout.');
    measuring.add(node.id);
    const padding = node.layout?.padding ?? 0;
    const gap = node.layout?.gap ?? 0;
    const childSizes = (children.get(node.id) || []).filter(child => child.visible !== false).map(minimum);
    let width = node.frame.width;
    let height = node.frame.height;
    if (node.type === 'HBoxContainer') {
      width = Math.max(width, 2 * padding + childSizes.reduce((sum, size) => sum + size.width, 0) + gap * Math.max(0, childSizes.length - 1));
      height = Math.max(height, 2 * padding + Math.max(0, ...childSizes.map(size => size.height)));
    } else if (node.type === 'VBoxContainer') {
      width = Math.max(width, 2 * padding + Math.max(0, ...childSizes.map(size => size.width)));
      height = Math.max(height, 2 * padding + childSizes.reduce((sum, size) => sum + size.height, 0) + gap * Math.max(0, childSizes.length - 1));
    } else if (node.type === 'MarginContainer') {
      width = Math.max(width, 2 * padding + Math.max(0, ...childSizes.map(size => size.width)));
      height = Math.max(height, 2 * padding + Math.max(0, ...childSizes.map(size => size.height)));
    }
    measuring.delete(node.id);
    const size = { width, height };
    minimums.set(node.id, size);
    return size;
  };
  const place = (node, x, y, width = minimum(node).width, height = minimum(node).height) => {
    if (active.has(node.id)) fail('Cannot compute a cyclic layout.');
    active.add(node.id);
    const frame = { x, y, width, height };
    result.set(node.id, frame);
    const padding = node.layout?.padding ?? 0;
    const gap = node.layout?.gap ?? 0;
    let offset = padding;
    for (const child of children.get(node.id) || []) {
      const hidden = child.visible === false;
      const childMin = minimum(child);
      if (node.type === 'HBoxContainer') {
        place(child, x + offset, y + padding, childMin.width, Math.max(childMin.height, height - 2 * padding));
        if (!hidden) offset += childMin.width + gap;
      } else if (node.type === 'VBoxContainer') {
        place(child, x + padding, y + offset, Math.max(childMin.width, width - 2 * padding), childMin.height);
        if (!hidden) offset += childMin.height + gap;
      } else if (node.type === 'MarginContainer') {
        place(child, x + padding, y + padding, Math.max(childMin.width, width - 2 * padding), Math.max(childMin.height, height - 2 * padding));
      } else {
        place(child, x + child.frame.x, y + child.frame.y);
      }
    }
    active.delete(node.id);
  };
  for (const node of children.get(null) || []) place(node, node.frame.x, node.frame.y);
  if (result.size !== nodes.length) fail('Cannot compute layout with missing parents or cycles.');
  return result;
}

/** Scalar node diffs for history and editor review; additions/deletions are explicit whole-node entries. */
export function diffProjects(before, after) {
  const previous = new Map((before.nodes || []).map(node => [node.id, node]));
  const next = new Map((after.nodes || []).map(node => [node.id, node]));
  const diffs = [];
  const walk = (nodeId, left, right, path = '') => {
    if (equal(left, right)) return;
    if (record(left) && record(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) walk(nodeId, left[key], right[key], path ? `${path}.${key}` : key);
    } else {
      diffs.push({ nodeId, path: path || '$node', before: left === undefined ? null : clone(left), beforeExists: left !== undefined, after: right === undefined ? null : clone(right), afterExists: right !== undefined });
    }
  };
  for (const nodeId of new Set([...previous.keys(), ...next.keys()])) walk(nodeId, previous.get(nodeId), next.get(nodeId));
  return diffs;
}
