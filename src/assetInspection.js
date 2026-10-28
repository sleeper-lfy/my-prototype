/** Read-only asset indexing and bounded pixel checks. Replacement changes a document link, never original files. */
import { validateProject } from './model.js';
import { validateMap } from './mapModel.js';
import { validateAnimationProject } from './animationModel.js';

const copy = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const safeImage = image => {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 4096 || image.height > 4096 || !image.pixels || image.pixels.length !== image.width * image.height * 4) fail('Image checks support images up to 4096 × 4096 pixels.');
  return image;
};

export function assetDocuments(snapshot) {
  const documents = new Map();
  for (const workspace of snapshot.library?.projects || []) {
    for (const [kind, list] of [['ui', workspace.uiPages], ['map', workspace.maps], ['template', workspace.templates]]) {
      for (const doc of list || []) documents.set(`${workspace.id}:${kind}:${doc.id}`, { kind, doc, workspaceId: workspace.id, workspaceName: workspace.name, active: false });
    }
  }
  for (const [kind, doc] of [['ui', snapshot.ui], ['map', snapshot.map], ['animation', snapshot.animation]]) {
    const workspaceId = kind === 'animation' ? 'animation' : snapshot.library?.activeProjectId || 'active';
    const key = `${workspaceId}:${kind}:${doc?.id}`;
    if (doc) documents.set(key, { ...documents.get(key), workspaceId, kind, doc, active: true });
  }
  return [...documents.values()];
}

/** An entry identifies one document resource, even when several entries use the same source file. */
export function buildAssetIndex(snapshot) {
  const entries = [];
  for (const document of assetDocuments(snapshot)) {
    const { kind, doc, active, workspaceId, workspaceName } = document;
    const add = (resourceType, asset, references, extra = {}) => entries.push({
      key: `${workspaceId}:${kind}:${doc.id}:${resourceType}:${asset.id}`, kind, documentId: doc.id, documentName: doc.name,
      workspaceId, workspaceName, active, resourceType, assetId: asset.id, name: asset.name || asset.id,
      src: asset.src || null, assetKind: asset.kind || resourceType, width: asset.width, height: asset.height,
      provenance: copy(asset.provenance || {}), references, ...extra,
    });
    for (const asset of doc.assets || []) {
      const references = [];
      for (const node of doc.nodes || []) {
        for (const [field, id] of Object.entries({ assetId: node.assetId, disabledAssetId: node.disabledAssetId, ...Object.fromEntries(Object.entries(node.buttonAssets || {}).map(([k, v]) => [`buttonAssets.${k}`, v])) })) {
          if (id === asset.id) references.push({ targetId: node.id, name: node.name, field, width: node.frame.width, height: node.frame.height });
        }
        if (asset.kind === 'font' && ['Label', 'Button'].includes(node.type) && (node.style?.fontFamily || 'Studio Sans') === asset.name) references.push({ targetId: node.id, name: node.name, field: 'style.fontFamily' });
      }
      if (asset.kind === 'font') for (const [name, family] of Object.entries(doc.tokens?.fonts || {})) if (family === asset.name) references.push({ targetId: `tokens.fonts.${name}`, name, field: 'tokens.fonts' });
      for (const object of doc.objects || []) if (object.assetId === asset.id) references.push({ targetId: object.id, name: object.name, field: 'assetId', width: object.width, height: object.height, footprint: copy(object.footprint) });
      for (const layer of doc.layers || []) {
        const cells = Object.entries(layer.cells || {}).filter(([, id]) => id === asset.id).map(([cell]) => cell);
        if (cells.length) references.push({ targetId: layer.id, name: layer.name, field: 'cells', count: cells.length, cells, width: doc.grid?.tileWidth, height: doc.grid?.tileHeight });
      }
      if (doc.reference?.assetId === asset.id) references.push({ targetId: 'reference', name: 'reference', field: 'reference.assetId', width: doc.reference.width, height: doc.reference.height });
      for (const owner of doc.assets || []) for (const [direction, id] of Object.entries(owner.directions || {})) if (id === asset.id) references.push({ targetId: owner.id, name: owner.name, field: `directions.${direction}` });
      for (const rule of doc.terrainRules || []) for (const [mask, id] of Object.entries(rule.variants || {})) if (id === asset.id) references.push({ targetId: rule.id, name: rule.name, field: `variants.${mask}` });
      for (const [ownerId, rule] of Object.entries(doc.placementRules || {})) if (ownerId === asset.id || rule.allowedTiles?.includes(asset.id)) references.push({ targetId: ownerId, name: ownerId, field: 'placementRules' });
      add('asset', asset, references, { atlas: copy(asset.atlas), footprint: copy(asset.footprint), grid: copy(doc.grid) });
    }
    if (kind !== 'animation') continue;
    for (const part of doc.parts || []) add('part', part, [{ targetId: part.boneId, name: part.boneId, field: 'boneId', count: doc.clips.reduce((sum, clip) => sum + clip.frames.length, 0) }], { embedded: true });
    for (const item of doc.equipment || []) add('equipment', item, [{ targetId: item.boneId, name: item.boneId, field: 'equipment.boneId' }], { embedded: true, enabled: item.enabled });
    // Include generated clip representatives so a new character can be checked before importing any art.
    for (const clip of doc.clips || []) for (const [index, frame] of clip.frames.entries()) {
      if (!frame.image && index !== 0) continue;
      add('frame', { id: frame.id, name: `${clip.name} · ${index + 1}`, ...frame.image }, [{ targetId: frame.id, name: clip.name, field: 'image' }], { clipId: clip.id, embedded: Boolean(frame.image), generated: !frame.image });
    }
  }
  return entries;
}

export function getAssetDocument(snapshot, entry) {
  return assetDocuments(snapshot).find(item => item.kind === entry.kind && item.doc.id === entry.documentId && item.workspaceId === entry.workspaceId)?.doc || fail('The resource document is no longer available.');
}

export function getAssetRecord(snapshot, entry) {
  const doc = getAssetDocument(snapshot, entry);
  if (entry.resourceType === 'asset') return doc.assets.find(asset => asset.id === entry.assetId);
  if (entry.resourceType === 'part') return doc.parts.find(part => part.id === entry.assetId);
  if (entry.resourceType === 'equipment') return doc.equipment.find(item => item.id === entry.assetId);
  return doc.clips.find(clip => clip.id === entry.clipId)?.frames.find(frame => frame.id === entry.assetId)?.image;
}

export function validateProvenance(value) {
  const result = {};
  for (const key of ['author', 'license', 'source', 'notes']) {
    const field = value?.[key] || '';
    if (typeof field !== 'string' || field.length > (key === 'notes' ? 4000 : 1000)) fail('Invalid asset source/license metadata.');
    result[key] = field.trim();
  }
  return result;
}

/** Pure preview for a single active document. Caller persists through the existing revision-checked API. */
export function planAssetUpdate(snapshot, key, update) {
  const entry = buildAssetIndex(snapshot).find(item => item.key === key) || fail('Choose an existing resource.');
  if (!entry.active || entry.kind === 'template') fail('Open this page or map before replacing its resource.');
  const original = getAssetDocument(snapshot, entry), project = copy(original);
  const provenance = update.provenance === undefined ? undefined : validateProvenance(update.provenance);
  let target;
  if (entry.resourceType === 'asset') {
    target = project.assets.find(asset => asset.id === entry.assetId);
    if (update.src !== undefined) {
      if (!/^\/(assets|local-assets)\/[A-Za-z0-9_/-]+\.(svg|png|jpe?g|webp)$/i.test(update.src) || update.src.split('/').includes('..')) fail('Replacement requires a local image path.');
      safeImage(update.image);
      if (target.atlas && (target.atlas.x + target.atlas.width > update.image.width || target.atlas.y + target.atlas.height > update.image.height)) fail('The replacement image is smaller than this atlas region.');
      if (target.margins && (target.margins.left + target.margins.right >= update.image.width || target.margins.top + target.margins.bottom >= update.image.height)) fail('The replacement image is smaller than the nine-slice margins.');
      target.src = update.src;
    }
  } else if (entry.resourceType === 'part' || entry.resourceType === 'equipment') {
    target = project[entry.resourceType === 'part' ? 'parts' : 'equipment'].find(part => part.id === entry.assetId);
    if (update.image) { safeImage(update.image); Object.assign(target, { width: update.image.width, height: update.image.height, pixels: Array.from(update.image.pixels) }); }
  } else {
    const frame = project.clips.find(clip => clip.id === entry.clipId).frames.find(frame => frame.id === entry.assetId);
    if (update.image) {
      safeImage(update.image);
      frame.image = { ...frame.image, width: update.image.width, height: update.image.height, pixels: Array.from(update.image.pixels), offset: copy(update.offset || frame.image?.offset || { x: 0, y: 0 }) };
    }
    target = frame.image;
    if (!target) fail('Generated frames have no imported-resource metadata; import a frame first.');
  }
  if (provenance !== undefined) target.provenance = provenance;
  if (entry.kind === 'ui') validateProject(project);
  else if (entry.kind === 'map') validateMap(project);
  else validateAnimationProject(project);
  return { kind: entry.kind, project, baseRevision: original.revision, entry, references: copy(entry.references), changed: JSON.stringify(original) !== JSON.stringify(project), changes: [{ resourceId: entry.assetId, fields: [...(update.image ? ['pixels/source'] : []), ...(provenance ? ['provenance'] : [])] }] };
}

export function inspectPixelImage(image, { palette = [], tile = false, isometric = false } = {}) {
  safeImage(image);
  const { width, height, pixels } = image, expected = new Set(palette.map(value => value.toLowerCase()));
  const colors = new Set(); let visible = 0, partialAlpha = 0, fringe = 0, outsidePalette = 0;
  const alpha = (x, y) => x < 0 || y < 0 || x >= width || y >= height ? 0 : pixels[(y * width + x) * 4 + 3];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4, a = pixels[at + 3];
    if (!a) continue;
    visible++;
    const hex = '#' + Array.from(pixels.slice(at, at + 3), n => n.toString(16).padStart(2, '0')).join('');
    if (colors.size <= 4096) colors.add(hex);
    if (expected.size && !expected.has(hex)) outsidePalette++;
    if (a !== 255) {
      partialAlpha++;
      if ([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([px, py]) => !alpha(px, py))) fringe++;
    }
  }
  const findings = [];
  const add = (code, details) => findings.push({ code, severity: 'review', ...details });
  if (!visible) add('empty-image', { count: 0 });
  if (partialAlpha) add('partial-alpha', { count: partialAlpha });
  if (fringe) add('edge-fringe', { count: fringe });
  if (outsidePalette) add('palette-drift', { count: outsidePalette });
  if (colors.size > 256) add('many-colors', { count: colors.size > 4096 ? '>4096' : colors.size });
  let seam = null;
  if (tile && width > 1 && height > 1) {
    const distance = (a, b) => {
      let sum = Math.abs(pixels[a + 3] - pixels[b + 3]);
      for (let c = 0; c < 3; c++) sum += Math.abs(pixels[a + c] * pixels[a + 3] / 255 - pixels[b + c] * pixels[b + 3] / 255);
      return sum / 4;
    };
    let horizontal = 0, vertical = 0, samples = 0;
    if (isometric) {
      // A neighboring diamond shifts by half a tile on both axes. Compare its top
      // silhouette edges against this tile's bottom edges; transparent corners do not hide seams.
      const edge = y => {
        let left = 0, right = width - 1;
        while (left < width && !alpha(left, y)) left++;
        while (right >= left && !alpha(right, y)) right--;
        return left <= right ? { left: (y * width + left) * 4, right: (y * width + right) * 4 } : null;
      };
      for (let y = 0; y < Math.floor(height / 2); y++) {
        const top = edge(y), bottom = edge(y + Math.floor(height / 2));
        if (top && bottom) { horizontal += distance(bottom.right, top.left); vertical += distance(bottom.left, top.right); samples++; }
      }
      seam = { mode: 'isometric', horizontal: samples ? horizontal / samples : 0, vertical: samples ? vertical / samples : 0, samples };
      if (!samples) add('tile-seam-unmeasurable', {});
    } else {
      for (let y = 0; y < height; y++) horizontal += distance(y * width * 4, (y * width + width - 1) * 4);
      for (let x = 0; x < width; x++) vertical += distance(x * 4, ((height - 1) * width + x) * 4);
      seam = { mode: 'rectangular', horizontal: horizontal / height, vertical: vertical / width, samples: width + height };
    }
    if (seam.horizontal > 24 || seam.vertical > 24) add('tile-seam', seam);
  }
  return { width, height, visiblePixels: visible, colors: colors.size > 4096 ? '>4096' : colors.size, partialAlpha, fringe, outsidePalette, seam, findings };
}

export function inspectAssetUsage(entry, image) {
  safeImage(image);
  const findings = [], sourceWidth = entry.atlas?.width || image.width, sourceHeight = entry.atlas?.height || image.height;
  for (const ref of entry.references) {
    if (!ref.width || !ref.height || entry.assetKind === 'nineSlice') continue;
    const scaleX = ref.width / sourceWidth, scaleY = ref.height / sourceHeight;
    if (!Number.isInteger(scaleX) || !Number.isInteger(scaleY)) findings.push({ code: 'fractional-scale', severity: 'review', targetId: ref.targetId, scaleX, scaleY });
  }
  if (entry.grid) {
    if (entry.footprint && (!Number.isInteger(entry.footprint.width) || !Number.isInteger(entry.footprint.height))) findings.push({ code: 'fractional-footprint', severity: 'review' });
    if (entry.assetKind === 'tile' && (sourceWidth % entry.grid.tileWidth || sourceHeight % entry.grid.tileHeight)) findings.push({ code: 'grid-size', severity: 'review', gridWidth: entry.grid.tileWidth, gridHeight: entry.grid.tileHeight });
  }
  return findings;
}

export function cropInspectionImage(image, atlas) {
  safeImage(image);
  if (!atlas) return image;
  if (![atlas.x, atlas.y, atlas.width, atlas.height].every(Number.isInteger) || atlas.x < 0 || atlas.y < 0 || atlas.width < 1 || atlas.height < 1 || atlas.x + atlas.width > image.width || atlas.y + atlas.height > image.height) fail('Atlas region lies outside the decoded image.');
  const pixels = new Uint8ClampedArray(atlas.width * atlas.height * 4);
  for (let y = 0; y < atlas.height; y++) pixels.set(image.pixels.slice(((atlas.y + y) * image.width + atlas.x) * 4, ((atlas.y + y) * image.width + atlas.x + atlas.width) * 4), y * atlas.width * 4);
  return { width: atlas.width, height: atlas.height, pixels };
}
