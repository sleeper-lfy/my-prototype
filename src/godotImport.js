import { NODE_TYPES, PATCH_FIELDS, validateProject } from './model.js';

export const MAX_GODOT_SCENE_BYTES = 4 * 1024 * 1024;
const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const round = value => Math.round(value * 10000) / 10000;
const get = (object, field) => field.split('.').reduce((value, key) => value?.[key], object);
const set = (object, field, value) => { const keys = field.split('.'), last = keys.pop(); let target = object; for (const key of keys) target = target[key] ||= {}; target[last] = clone(value); };
const hash = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
const stableId = path => `godot-${hash(path)}`;
const safeResource = value => typeof value === 'string' && /^res:\/\//.test(value) && !value.slice(6).split(/[\\/]/).some(part => part === '..') && !/[\0\r\n]/.test(value);
const quote = value => JSON.stringify(value);
const issue = (code, path, property, detail) => ({ code, path, property, detail });

/** No eval, resource loading, script execution, file access, or expression evaluation. */
export function parseGodotValue(text) {
  const value = text.trim();
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value)) { const n = Number(value); if (Number.isFinite(n)) return n; }
  if (value.startsWith('"')) { try { const parsed = JSON.parse(value); if (typeof parsed === 'string') return parsed; } catch {} }
  const call = value.match(/^(Vector2|Color|ExtResource|SubResource)\((.*)\)$/s);
  if (call) {
    if (['ExtResource', 'SubResource'].includes(call[1])) { const resource = parseGodotValue(call[2]); if (typeof resource === 'string') return { kind: call[1], id: resource }; }
    else { const parts = call[2].split(',').map(Number); if (parts.length === (call[1] === 'Color' ? 4 : 2) && parts.every(Number.isFinite)) return { kind: call[1], values: parts }; }
  }
  return { kind: 'unparsed', raw: value };
}

function logicalLines(text) {
  const output = []; let start = 0, quoted = false, escaped = false, depth = 0, comment = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (!comment) { if (c === '"') quoted = true; else if (c === ';') comment = true; else if ('([{'.includes(c || '\0')) depth++; else if (')]}'.includes(c || '\0')) depth--; }
    if ((c === '\n' && !quoted && depth === 0) || i === text.length) { output.push({ start, end: i + (c === '\n' ? 1 : 0), text: text.slice(start, i) }); start = i + 1; comment = false; }
    if (c === '\n') comment = false;
    if (depth < 0 || depth > 64) throw new Error('Invalid or excessively nested Godot text.');
  }
  if (quoted || depth !== 0) throw new Error('Unclosed Godot string or expression.');
  return output;
}
function stripComment(text) { let quoted = false, escaped = false; for (let i = 0; i < text.length; i++) { const c = text[i]; if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; } else if (c === '"') quoted = true; else if (c === ';') return text.slice(0, i); } return text; }
function header(text) {
  const match = text.match(/^\[([A-Za-z_][A-Za-z0-9_]*)([\s\S]*)\]$/); if (!match) throw new Error('Invalid Godot section header.');
  const attrs = Object.create(null); let rest = match[2].trim();
  while (rest) {
    const pair = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|\w+\("(?:[^"\\]|\\.)*"\)|[^\s]+)\s*/s);
    if (!pair || Object.hasOwn(attrs, pair[1])) throw new Error('Invalid or duplicate Godot section attribute.');
    attrs[pair[1]] = parseGodotValue(pair[2]); rest = rest.slice(pair[0].length);
  }
  return { type: match[1], attrs };
}
export function parseGodotScene(text) {
  if (typeof text !== 'string' || !text.trim() || new TextEncoder().encode(text).length > MAX_GODOT_SCENE_BYTES) throw new Error('Select a nonempty Godot scene smaller than 4 MiB.');
  if (/\0/.test(text)) throw new Error('Binary scenes are unsupported; select a text .tscn scene.');
  const sections = []; let section;
  for (const line of logicalLines(text.replace(/^\uFEFF/, ' '))) {
    const clean = stripComment(line.text).trim(); if (!clean) continue;
    if (clean.startsWith('[')) { if (section) section.end = line.start; section = { ...header(clean), start: line.start, headerEnd: line.end, end: text.length, properties: Object.create(null) }; sections.push(section); }
    else {
      if (!section) throw new Error('Godot property outside a section.');
      const match = clean.match(/^([^=\s]+)\s*=\s*([\s\S]*)$/); if (!match) throw new Error('Invalid Godot property assignment.');
      if (Object.hasOwn(section.properties, match[1])) throw new Error(`Duplicate Godot property: ${match[1]}`);
      section.properties[match[1]] = { value: parseGodotValue(match[2]), raw: match[2], start: line.start, end: line.end };
    }
    if (sections.length > 6000) throw new Error('Godot scene has too many sections.');
  }
  if (sections[0]?.type !== 'gd_scene' || sections[0].attrs.format !== 3) throw new Error('Only Godot 4 text scenes (format=3) are supported.');
  const nodes = sections.filter(s => s.type === 'node');
  if (!nodes.length || nodes.length > 2000) throw new Error('Scene must contain 1–2000 nodes.');
  const paths = new Set(); let root = 0;
  for (const node of nodes) {
    if (typeof node.attrs.name !== 'string' || !node.attrs.name || /[\/.]/.test(node.attrs.name)) throw new Error('Invalid Godot node name.');
    if (node.attrs.parent === undefined) { if (++root !== 1) throw new Error('Godot scene needs exactly one root.'); node.path = '.'; }
    else {
      if (typeof node.attrs.parent !== 'string' || (node.attrs.parent !== '.' && !paths.has(node.attrs.parent))) throw new Error(`Missing or out-of-order Godot parent: ${node.attrs.parent}`);
      node.path = node.attrs.parent === '.' ? node.attrs.name : `${node.attrs.parent}/${node.attrs.name}`;
    }
    if (paths.has(node.path)) throw new Error(`Duplicate Godot node path: ${node.path}`); paths.add(node.path);
  }
  return { text, sections, nodes, resources: sections.filter(s => s.type === 'ext_resource') };
}
const value = (section, property, fallback) => section?.properties[property]?.value ?? fallback;
const number = (section, property, fallback = 0) => { const v = value(section, property, fallback); return typeof v === 'number' ? v : fallback; };
const rgba = color => color?.kind === 'Color' && color.values.every(n => n >= 0 && n <= 1) ? '#' + color.values.map(n => Math.round(n * 255).toString(16).padStart(2, '0')).join('') : null;
const toColor = hex => { if (hex === 'transparent') return 'Color(0, 0, 0, 0)'; let h = hex.slice(1); if (h.length <= 4) h = [...h].map(c => c + c).join(''); if (h.length === 6) h += 'ff'; return `Color(${h.match(/../g).map(c => round(parseInt(c, 16) / 255)).join(', ')})`; };
const readDimensions = text => ({ width: Number(text?.match(/^window\/size\/viewport_width\s*=\s*(\d+)/m)?.[1]) || undefined, height: Number(text?.match(/^window\/size\/viewport_height\s*=\s*(\d+)/m)?.[1]) || undefined });

export function inspectGodotImport(text, options = {}) {
  const parsed = parseGodotScene(text), mapping = options.nodeMap;
  if (mapping && (!Array.isArray(mapping.nodes) || mapping.nodes.length > 2000)) throw new Error('Invalid node-map.json.');
  const config = readDimensions(options.projectConfig), root = parsed.nodes[0], generated = typeof value(root, 'metadata/studio_project_id') === 'string';
  const width = options.width ?? mapping?.canvas?.width ?? config.width ?? Math.max(1, number(root, 'offset_right', 960) - number(root, 'offset_left'));
  const height = options.height ?? mapping?.canvas?.height ?? config.height ?? Math.max(1, number(root, 'offset_bottom', 600) - number(root, 'offset_top'));
  const warnings = [], resources = [], usedAssets = new Map(), sourceByPath = new Map(parsed.nodes.map(node => [node.path, node]));
  const mapByPath = new Map((mapping?.nodes || []).map(node => [node.path, node]));
  const wrappers = new Set((mapping?.nodes || []).filter(node => node.framePath && node.framePath !== node.path).map(node => node.framePath));
  const sub = new Map(parsed.sections.filter(s => s.type === 'sub_resource').map(s => [s.attrs.id, s]));
  const ext = new Map();
  for (const section of parsed.resources) {
    const resource = { id: section.attrs.id, type: section.attrs.type, path: section.attrs.path, supported: ['Texture2D', 'FontFile'].includes(section.attrs.type) && safeResource(section.attrs.path) };
    if (ext.has(resource.id)) throw new Error('Duplicate external resource ID.');
    ext.set(resource.id, resource); resources.push(resource);
    if (!resource.supported) warnings.push(issue('resource-preserved', '.', String(resource.id), 'Resource is retained in the source but is not loaded or executed.'));
  }
  function bind(reference, nodePath, property) {
    const resource = reference?.kind === 'ExtResource' ? ext.get(reference.id) : null;
    if (!resource?.supported) { warnings.push(issue('unsupported-resource', nodePath, property, 'Only mapped local textures and fonts are imported.')); return null; }
    const asset = options.resourceBindings?.[resource.id];
    if (!asset) { warnings.push(issue('missing-resource', nodePath, property, resource.path)); return null; }
    usedAssets.set(asset.id, clone(asset)); return asset;
  }
  let background = mapping?.canvas?.background || '#111b18';
  const nodes = [], sourceNodes = [], importedPaths = new Map(), geometries = new Map([['.', { width, height }]]), excluded = new Set(), ids = new Set();
  for (const source of parsed.nodes) {
    if (generated && source.path === '.') { importedPaths.set('.', null); continue; }
    if (generated && source.path === 'CanvasBackground' && source.attrs.type === 'ColorRect') { background = rgba(value(source, 'color')) || background; continue; }
    if (wrappers.has(source.path)) continue;
    const parentPath = source.attrs.parent;
    if (!NODE_TYPES.includes(source.attrs.type) || source.attrs.instance || source.attrs.owner !== undefined || (parentPath && excluded.has(parentPath))) {
      excluded.add(source.path); warnings.push(issue('unsupported-node', source.path, source.attrs.type || 'instance', 'This node and its descendants stay in the original scene; they are excluded from the editable design.')); continue;
    }
    const mapped = mapByPath.get(source.path), frameSource = sourceByPath.get(mapped?.framePath) || source;
    const effectiveParentPath = wrappers.has(parentPath) ? frameSource.attrs.parent : parentPath;
    if (effectiveParentPath && !importedPaths.has(effectiveParentPath)) { excluded.add(source.path); warnings.push(issue('unsupported-parent', source.path, 'parent', 'Parent was not imported.')); continue; }
    let id = value(source, 'metadata/studio_id', mapped?.id || stableId(source.path));
    if (!idValid(id)) throw new Error(`Invalid stable component ID at ${source.path}.`);
    if (ids.has(id)) throw new Error(`Duplicate stable component ID: ${id}`); ids.add(id);
    const parentId = effectiveParentPath ? importedPaths.get(effectiveParentPath) ?? null : null;
    const parent = nodes.find(node => node.id === parentId), parentFrame = parent?.frame || { width, height };
    const anchors = ['left', 'top', 'right', 'bottom'].map(side => number(frameSource, `anchor_${side}`));
    if (anchors.some(n => n !== 0)) warnings.push(issue('fixed-resolution', source.path, 'anchors', 'Anchors are resolved at the selected viewport; source anchors are retained on writeback.'));
    const left = number(frameSource, 'offset_left') + anchors[0] * parentFrame.width, top = number(frameSource, 'offset_top') + anchors[1] * parentFrame.height;
    let right = number(frameSource, 'offset_right', source.path === '.' ? width : 1) + anchors[2] * parentFrame.width, bottom = number(frameSource, 'offset_bottom', source.path === '.' ? height : 1) + anchors[3] * parentFrame.height;
    const minimum = value(frameSource, 'custom_minimum_size');
    if (minimum?.kind === 'Vector2') { right = Math.max(right, left + minimum.values[0]); bottom = Math.max(bottom, top + minimum.values[1]); }
    const containerParent = parent?.type.endsWith('Container');
    if (containerParent && minimum?.kind !== 'Vector2') warnings.push(issue('container-minimum', source.path, 'custom_minimum_size', 'Set explicit child minimum sizes to reproduce Container layout.'));
    const node = { id, name: value(source, 'metadata/studio_name', source.attrs.name), type: source.attrs.type, parentId, frame: { x: round(left), y: round(top), width: round(Math.max(1, right - left)), height: round(Math.max(1, bottom - top)) }, style: {}, visible: value(source, 'visible', true), layout: { mode: source.attrs.type === 'HBoxContainer' ? 'horizontal' : source.attrs.type === 'VBoxContainer' ? 'vertical' : 'free', padding: 0, gap: 0 } };
    const fields = new Set(['name', 'frame.x', 'frame.y', 'frame.width', 'frame.height', 'visible']);
    const consumed = new Set(['metadata/studio_id', 'metadata/studio_name', 'layout_mode', 'anchors_preset', 'offset_left', 'offset_top', 'offset_right', 'offset_bottom', 'anchor_left', 'anchor_top', 'anchor_right', 'anchor_bottom', 'grow_horizontal', 'grow_vertical', 'custom_minimum_size', 'visible']);
    const consume = property => { consumed.add(property); return value(source, property); };
    if (['HBoxContainer', 'VBoxContainer'].includes(node.type)) { node.layout.gap = number(source, 'theme_override_constants/separation', 4); consumed.add('theme_override_constants/separation'); fields.add('layout.gap'); }
    if (node.type === 'MarginContainer' || frameSource !== source) {
      const margins = ['left', 'top', 'right', 'bottom'].map(side => number(frameSource, `theme_override_constants/margin_${side}`));
      if (new Set(margins).size > 1) warnings.push(issue('asymmetric-padding', source.path, 'margins', 'Only uniform padding is editable; original margins stay in the source.'));
      else { node.layout.padding = margins[0]; fields.add('layout.padding'); }
      if (frameSource === source) for (const side of ['left', 'top', 'right', 'bottom']) consumed.add(`theme_override_constants/margin_${side}`);
    }
    const modulate = consume('self_modulate'); if (modulate?.kind === 'Color') { node.style.opacity = modulate.values[3]; fields.add('style.opacity'); if (modulate.values.slice(0, 3).some(n => n !== 1)) warnings.push(issue('unmapped-tint', source.path, 'self_modulate', 'RGB tint is preserved in source; only opacity is editable.')); }
    if (['Label', 'Button'].includes(node.type)) {
      node.style.text = consume('text') ?? ''; node.style.fontSize = consume('theme_override_font_sizes/font_size') ?? 16; node.style.color = rgba(consume('theme_override_colors/font_color')) || '#ffffffff';
      const alignName = node.type === 'Label' ? 'horizontal_alignment' : 'alignment'; node.style.align = ['left', 'center', 'right'][consume(alignName) ?? (node.type === 'Button' ? 1 : 0)] || 'left';
      for (const key of ['text', 'fontSize', 'color', 'align']) fields.add(`style.${key}`);
      const font = consume('theme_override_fonts/font'); if (font) { const asset = bind(font, source.path, 'theme_override_fonts/font'); if (asset) { node.style.fontFamily = asset.name; fields.add('style.fontFamily'); } }
    }
    if (node.type === 'TextureRect') { const texture = consume('texture'); if (texture) { const asset = bind(texture, source.path, 'texture'); if (asset) { node.assetId = asset.id; fields.add('assetId'); } } }
    function applyStyle(property, target) {
      const reference = consume(property), style = reference?.kind === 'SubResource' ? sub.get(reference.id) : null;
      if (!reference) return;
      if (style?.attrs.type === 'StyleBoxFlat') {
        if (target !== 'normal') { warnings.push(issue('state-style', source.path, property, 'State-specific flat styles stay in source; the editor previews the normal style.')); return; }
        node.style.fill = rgba(value(style, 'bg_color')) || '#999999ff'; node.style.stroke = rgba(value(style, 'border_color')) || '#000000ff';
        const borders = ['left', 'top', 'right', 'bottom'].map(side => number(style, `border_width_${side}`)), radii = ['top_left', 'top_right', 'bottom_left', 'bottom_right'].map(side => number(style, `corner_radius_${side}`));
        node.style.strokeWidth = borders[0]; node.style.radius = radii[0];
        for (const key of ['fill', 'stroke', 'strokeWidth', 'radius']) fields.add(`style.${key}`);
        if (new Set(borders).size > 1 || new Set(radii).size > 1) warnings.push(issue('asymmetric-style', source.path, property, 'Per-side borders/radii are shown using the first value. Source style resources remain intact.'));
      } else if (style?.attrs.type === 'StyleBoxTexture') {
        const asset = bind(value(style, 'texture'), source.path, property); if (asset) {
          const copied = clone(asset); copied.kind = 'nineSlice'; copied.margins = Object.fromEntries(['left', 'top', 'right', 'bottom'].map(side => [side, number(style, `texture_margin_${side}`)])); usedAssets.set(copied.id, copied);
          if (target === 'normal') { node.assetId = copied.id; fields.add('assetId'); }
          if (node.type === 'Button') { if (target === 'disabled') { node.disabledAssetId = copied.id; fields.add('disabledAssetId'); } else { (node.buttonAssets ||= {})[target] = copied.id; fields.add(`buttonAssets.${target}`); } }
        }
      } else warnings.push(issue('unsupported-style', source.path, property, 'Unsupported style resource remains in the original scene.'));
    }
    if (node.type === 'Panel') applyStyle('theme_override_styles/panel', 'normal');
    if (node.type === 'Button') for (const state of ['normal', 'hover', 'pressed', 'disabled']) applyStyle(`theme_override_styles/${state}`, state);
    const defaults = { mouse_filter: node.type === 'TextureRect' || node.type === 'Label' ? 2 : 0, clip_text: true, focus_mode: 0, vertical_alignment: 1, expand_mode: 1, stretch_mode: 0, size_flags_horizontal: 1, size_flags_vertical: 1 };
    for (const [property, assignment] of Object.entries(source.properties)) {
      if (consumed.has(property)) continue;
      if (Object.hasOwn(defaults, property) && same(assignment.value, defaults[property])) continue;
      warnings.push(issue(property === 'script' ? 'script-preserved' : 'property-preserved', source.path, property, 'This property stays in the source and is not editable in Studio.'));
    }
    nodes.push(node); importedPaths.set(source.path, id); geometries.set(source.path, node.frame);
    sourceNodes.push({ id, path: source.path, framePath: frameSource.path, fields: [...fields], anchors, parentSize: { width: parentFrame.width, height: parentFrame.height }, containerParent: Boolean(containerParent), originalType: source.attrs.type });
  }
  if (!nodes.length) throw new Error('This scene contains no supported editable UI nodes.');
  const projectId = value(root, 'metadata/studio_project_id');
  const project = { schemaVersion: 1, id: idValid(projectId) ? projectId : `godot-scene-${hash(text)}`, name: options.fileName?.replace(/\.tscn$/i, '') || root.attrs.name || 'Godot UI', revision: 1, canvas: { width, height, background }, tokens: { colors: {}, fonts: {}, rules: [] }, assets: [...usedAssets.values()], nodes, reviews: [], history: [] };
  project.godotSource = { schemaVersion: 1, fileName: options.fileName || 'imported.tscn', text, nodes: sourceNodes, baselineNodes: clone(nodes), canvas: clone(project.canvas), resourceBindings: clone(options.resourceBindings || {}), warnings: clone(warnings), supportedTypes: [...NODE_TYPES] };
  validateProject(project);
  return { project, resources, warnings, unresolved: warnings.filter(w => w.code === 'missing-resource'), nodeCount: nodes.length, preservedNodeCount: excluded.size, canImport: !warnings.some(w => w.code === 'missing-resource') };
}

/** Merge only matched stable IDs. Structural changes and protected fields are explicit conflicts. */
export function previewGodotMerge(current, incoming) {
  validateProject(current); validateProject(incoming);
  const result = clone(current), changes = [], conflicts = [], currentNodes = new Map(result.nodes.map(node => [node.id, node]));
  const mapping = new Map((incoming.godotSource?.nodes || []).map(node => [node.id, node]));
  for (const node of incoming.nodes) {
    const before = currentNodes.get(node.id);
    if (!before) { conflicts.push({ nodeId: node.id, property: 'id', reason: 'new-node' }); continue; }
    if (before.type !== node.type || before.parentId !== node.parentId) { conflicts.push({ nodeId: node.id, property: 'type/parentId', reason: 'structure' }); continue; }
    let locked = before; let isLocked = false; while (locked) { if (locked.locked) isLocked = true; locked = currentNodes.get(locked.parentId); }
    const protectedFields = current.reviews.filter(review => review.nodeId === node.id && review.status !== 'approved').flatMap(review => review.protectedProperties);
    for (const field of mapping.get(node.id)?.fields || PATCH_FIELDS) {
      const after = get(node, field); if (after === undefined || same(get(before, field), after)) continue;
      const blocked = isLocked || protectedFields.some(path => path === field || field.startsWith(path + '.') || path.startsWith(field + '.'));
      if (blocked) { conflicts.push({ nodeId: node.id, property: field, reason: isLocked ? 'locked' : 'protected' }); continue; }
      if (['frame.x', 'frame.y'].includes(field) && currentNodes.get(before.parentId)?.type.endsWith('Container')) continue;
      changes.push({ nodeId: node.id, property: field, before: clone(get(before, field) ?? null), after: clone(after) }); set(before, field, after);
    }
  }
  const incomingAssets = new Map(incoming.assets.map(asset => [asset.id, asset]));
  for (const asset of incomingAssets.values()) {
    const prior = result.assets.find(item => item.id === asset.id);
    if (prior && !same(prior, asset)) conflicts.push({ nodeId: asset.id, property: 'asset', reason: 'asset-metadata-conflict' });
    else if (!prior) result.assets.push(clone(asset));
  }
  result.godotSource = clone(incoming.godotSource); result.godotSource.baselineNodes = clone(incoming.nodes);
  result.revision = current.revision + 1;
  validateProject(result);
  return { project: result, changes, conflicts, canMerge: conflicts.length === 0 && changes.length > 0 };
}

/** Patch a downloaded copy of source text, retaining unknown nodes, properties and scripts byte-for-byte. */
export function buildGodotSourceUpdate(project, latestText, acceptedConflictKeys = []) {
  validateProject(project);
  const source = project.godotSource;
  if (!source || source.schemaVersion !== 1) throw new Error('This design has no Godot source provenance.');
  const original = parseGodotScene(source.text), latest = parseGodotScene(latestText ?? source.text);
  const originalPaths = new Map(original.nodes.map(n => [n.path, n])), latestPaths = new Map(latest.nodes.map(n => [n.path, n]));
  const baseline = new Map(source.baselineNodes.map(node => [node.id, node])), current = new Map(project.nodes.map(node => [node.id, node]));
  const changes = [], conflicts = [], blocked = [], updates = new Map(), accepted = new Set(acceptedConflictKeys);
  if (!same(source.canvas, project.canvas)) blocked.push({ nodeId: '.', property: 'canvas', reason: 'Canvas/config changes require editing project.godot separately.' });
  for (const node of project.nodes) if (!baseline.has(node.id)) blocked.push({ nodeId: node.id, property: 'node', reason: 'Adding nodes to source is not supported.' });
  function write(mapping, path, property, raw) {
    const key = `${path}:${property}`, before = originalPaths.get(path), external = latestPaths.get(path);
    if (!before || !external || before.attrs.type !== external.attrs.type || before.attrs.parent !== external.attrs.parent) { blocked.push({ nodeId: mapping.id, property, reason: 'Source node was removed or its structure changed.' }); return; }
    const oldValue = value(before, property), externalValue = value(external, property), desired = parseGodotValue(raw);
    if (!same(oldValue, externalValue) && !same(externalValue, desired)) {
      conflicts.push({ key, nodeId: mapping.id, path, property, before: oldValue ?? null, external: externalValue ?? null, desired, accepted: accepted.has(key) });
      if (!accepted.has(key)) return;
    }
    if (!same(externalValue, desired)) { updates.set(key, { path, property, raw }); changes.push({ nodeId: mapping.id, path, property, before: externalValue ?? null, after: desired }); }
  }
  for (const mapping of source.nodes) {
    const before = baseline.get(mapping.id), node = current.get(mapping.id);
    if (!node || node.type !== before.type || node.parentId !== before.parentId) { blocked.push({ nodeId: mapping.id, property: 'node', reason: 'Deletion, reparenting and type changes require manual source edits.' }); continue; }
    const sourceNode = originalPaths.get(mapping.path);
    const changed = PATCH_FIELDS.filter(field => !same(get(before, field), get(node, field)));
    const supported = new Set(['name', 'visible', 'frame.x', 'frame.y', 'frame.width', 'frame.height', 'style.text', 'style.fontSize', 'style.color', 'style.align', 'style.opacity', 'layout.gap', 'layout.padding']);
    for (const field of changed) if (!supported.has(field)) blocked.push({ nodeId: node.id, property: field, reason: 'This property/resource is read-only for source writeback; export a separate Studio scene instead.' });
    if (changed.includes('name')) write(mapping, mapping.path, 'metadata/studio_name', quote(node.name));
    if (changed.includes('visible')) write(mapping, mapping.path, 'visible', String(node.visible !== false));
    const parent = current.get(node.parentId), parentSize = parent?.frame || project.canvas;
    const [al, at, ar, ab] = mapping.anchors;
    if (mapping.containerParent && changed.some(field => field.startsWith('frame.'))) {
      if (changed.includes('frame.width') || changed.includes('frame.height')) write(mapping, mapping.framePath, 'custom_minimum_size', `Vector2(${node.frame.width}, ${node.frame.height})`);
      if (changed.includes('frame.x') || changed.includes('frame.y')) blocked.push({ nodeId: node.id, property: 'frame.x/y', reason: 'Container controls child positions.' });
    } else {
      if (changed.includes('frame.x')) write(mapping, mapping.framePath, 'offset_left', String(round(node.frame.x - al * parentSize.width)));
      if (changed.includes('frame.y')) write(mapping, mapping.framePath, 'offset_top', String(round(node.frame.y - at * parentSize.height)));
      if (changed.includes('frame.x') || changed.includes('frame.width')) write(mapping, mapping.framePath, 'offset_right', String(round(node.frame.x + node.frame.width - ar * parentSize.width)));
      if (changed.includes('frame.y') || changed.includes('frame.height')) write(mapping, mapping.framePath, 'offset_bottom', String(round(node.frame.y + node.frame.height - ab * parentSize.height)));
    }
    const scalar = { 'style.text': ['text', quote(node.style?.text ?? '')], 'style.fontSize': ['theme_override_font_sizes/font_size', String(node.style?.fontSize ?? 16)], 'style.color': ['theme_override_colors/font_color', toColor(node.style?.color ?? '#ffffff')], 'style.align': [node.type === 'Label' ? 'horizontal_alignment' : 'alignment', String({ left: 0, center: 1, right: 2 }[node.style?.align ?? 'left'])], 'layout.gap': ['theme_override_constants/separation', String(node.layout?.gap ?? 0)] };
    for (const field of changed) if (scalar[field]) write(mapping, mapping.path, scalar[field][0], scalar[field][1]);
    if (changed.includes('style.opacity')) { const rgb = value(sourceNode, 'self_modulate')?.values?.slice(0, 3) || [1, 1, 1]; write(mapping, mapping.path, 'self_modulate', `Color(${[...rgb, node.style?.opacity ?? 1].join(', ')})`); }
    if (changed.includes('layout.padding')) {
      if (node.type !== 'MarginContainer' && mapping.framePath === mapping.path) blocked.push({ nodeId: node.id, property: 'layout.padding', reason: 'Adding a padding wrapper requires structural source edits.' });
      else for (const side of ['left', 'top', 'right', 'bottom']) write(mapping, mapping.framePath, `theme_override_constants/margin_${side}`, String(node.layout?.padding ?? 0));
    }
  }
  const edits = [], insertions = new Map();
  for (const { path, property, raw } of updates.values()) {
    const node = latestPaths.get(path), assignment = node.properties[property];
    if (assignment) edits.push({ start: assignment.start, end: assignment.end, text: `${property} = ${raw}\n` });
    else insertions.set(node.end, `${insertions.get(node.end) || ''}${property} = ${raw}\n`);
  }
  for (const [position, text] of insertions) edits.push({ start: position, end: position, text: `${position && latest.text[position - 1] !== '\n' ? '\n' : ''}${text}\n` });
  let text = latest.text; for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  const canExport = blocked.length === 0 && conflicts.every(c => c.accepted);
  return { text: canExport ? text : null, changes, conflicts, blocked, canExport, preservedExternalNodes: latest.nodes.length - source.nodes.length };
}
