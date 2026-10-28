/** Deterministic, dependency-free pixel animation model shared by editor and exporter. */
const copy = value => structuredClone(value);
const radians = value => value * Math.PI / 180;
const DIRECTIONS = ['down', 'up', 'left', 'right'];
const ACTIONS = ['idle', 'walk', 'attack'];
const STATUSES = ['pending', 'modified', 'acceptance', 'approved'];
const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const fail = message => { throw new Error(message); };
export const ANIMATION_PRESETS = ACTIONS;
export const ANIMATION_DIRECTIONS = DIRECTIONS;
export function createAnimationProject() {
  const bone = (id, parent, length, angle, x = 0, y = 0) => ({ id, parent, length, angle, offset: { x, y } });
  const project = {
    schemaVersion: 1, kind: 'studio-animation', id: 'pixel-ranger', name: 'Pixel Ranger / 像素游侠', revision: 0,
    canvas: { width: 64, height: 96 },
    palette: ['#152635', '#263e4b', '#3c665d', '#6f9670', '#d7bb78', '#f2d5a0', '#b48157', '#638b9a', '#a8c8ca', '#663e43'],
    bones: [bone('pelvis', null, 0, 0), bone('torso', 'pelvis', 20, -90), bone('head', 'torso', 10, -90),
      bone('leftUpperArm', 'torso', 12, 106, -8, 3), bone('leftForearm', 'leftUpperArm', 11, 85),
      bone('rightUpperArm', 'torso', 12, 74, 8, 3), bone('rightForearm', 'rightUpperArm', 11, 95),
      bone('leftThigh', 'pelvis', 14, 90, -5, 0), bone('leftShin', 'leftThigh', 15, 90), bone('leftFoot', 'leftShin', 3, 0),
      bone('rightThigh', 'pelvis', 14, 90, 5, 0), bone('rightShin', 'rightThigh', 15, 90), bone('rightFoot', 'rightShin', 3, 0)],
    parts: [], clips: [], reviews: [],
  };
  for (const action of ACTIONS) for (const direction of DIRECTIONS) {
    const id = `${action}-${direction}`, count = action === 'idle' ? 6 : 8;
    project.clips.push({ id, name: `${action} / ${direction}`, action, direction, loop: action !== 'attack', frames: Array.from({ length: count }, (_, i) => presetFrame(project, action, direction, i, count, `${id}-${i + 1}`)) });
  }
  return project;
}
function presetFrame(project, action, direction, i, count, id) {
  const phase = i / count * Math.PI * 2, side = direction === 'left' ? -1 : 1;
  const pose = {}, root = { x: Math.round(project.canvas.width / 2), y: Math.round(project.canvas.height * 0.552) };
  let contacts = ['leftFoot', 'rightFoot'], events = [];
  if (action === 'idle') { pose.torso = Math.sin(phase) * 2; pose.head = -pose.torso; pose.leftForearm = Math.sin(phase) * 4; }
  if (action === 'walk') {
    const swing = Math.sin(phase) * 24 * side;
    pose.leftThigh = swing; pose.rightThigh = -swing;
    pose.leftShin = Math.max(0, -Math.sin(phase)) * -28 * side;
    pose.rightShin = Math.max(0, Math.sin(phase)) * -28 * side;
    pose.leftUpperArm = -swing * .7; pose.rightUpperArm = swing * .7;
    root.y += Math.round(Math.abs(Math.sin(phase)) * 2);
    contacts = Math.sin(phase) >= 0 ? ['rightFoot'] : ['leftFoot'];
    if (i === 0 || i === Math.floor(count / 2)) events = [{ name: 'footstep' }];
  }
  if (action === 'attack') {
    const swing = [0, -25, -70, -110, -80, -35, -10, 0][Math.floor(i * 8 / count)];
    pose.rightUpperArm = swing * side; pose.rightForearm = swing * .4 * side;
    pose.torso = [0, -3, -6, 7, 5, 2, 0, 0][Math.floor(i * 8 / count)] * side;
    if (i === Math.floor(count * .375)) events = [{ name: 'hit', hitbox: { x: side > 0 ? 43 : 1, y: 34, width: 20, height: 26 } }];
  }
  return { id, durationMs: action === 'idle' ? 160 : action === 'attack' && i === 3 ? 60 : 100, pose, root, contacts, events };
}
export function regenerateAnimation(project, clipId) {
  const next = copy(project), clip = next.clips.find(c => c.id === clipId);
  if (!clip) fail('Unknown animation clip');
  clip.frames = clip.frames.map((f, i) => ({ ...f, ...presetFrame(next, clip.action, clip.direction, i, clip.frames.length, f.id), ...(f.image ? { image: f.image } : {}) }));
  validateAnimationProject(next); return next;
}
function pixelImage(image, maxWidth = 256, maxHeight = 256) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > maxWidth || image.height > maxHeight) fail('Invalid pixel image dimensions');
  if (!Array.isArray(image.pixels) || image.pixels.length !== image.width * image.height * 4 || image.pixels.some(v => !Number.isInteger(v) || v < 0 || v > 255)) fail('Invalid RGBA pixel payload');
}
export function validateAnimationProject(p) {
  if (!p || p.kind !== 'studio-animation' || p.schemaVersion !== 1) fail('Unsupported animation project');
  if (!Number.isInteger(p.revision) || p.revision < 0) fail('Invalid animation revision');
  const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value);
  if (!id(p.id) || typeof p.name !== 'string' || p.name.length > 200) fail('Invalid animation identity');
  if (!p.canvas || ![p.canvas.width, p.canvas.height].every(v => Number.isInteger(v) && v >= 16 && v <= 256)) fail('Canvas must be 16..256 pixels');
  if (!Array.isArray(p.palette) || p.palette.length < 1 || p.palette.length > 256 || p.palette.some(c => !/^#[0-9a-f]{6}$/i.test(c))) fail('Invalid animation palette');
  if (!Array.isArray(p.bones) || !p.bones.length || p.bones.length > 64) fail('Invalid bone count');
  const bones = new Set();
  for (const b of p.bones) {
    if (!id(b.id) || bones.has(b.id) || (b.parent != null && !bones.has(b.parent)) || !finite(b.length, 0, 256) || !finite(b.angle, -360, 360) || !b.offset || !finite(b.offset.x, -256, 256) || !finite(b.offset.y, -256, 256)) fail('Invalid bone hierarchy or dimensions');
    bones.add(b.id);
  }
  if (!Array.isArray(p.parts) || p.parts.length > 64) fail('Invalid character parts');
  const partIds = new Set();
  for (const part of p.parts) {
    if (!id(part.id) || partIds.has(part.id) || !bones.has(part.boneId) || (part.direction && !DIRECTIONS.includes(part.direction)) || !part.pivot || !finite(part.pivot.x, -256, 256) || !finite(part.pivot.y, -256, 256)) fail('Invalid character part');
    partIds.add(part.id); pixelImage(part);
  }
  if (!Array.isArray(p.clips) || !p.clips.length || p.clips.length > 64) fail('Invalid animation clips');
  const clipIds = new Set(), frameIds = new Set(); let total = 0;
  for (const c of p.clips) {
    if (!id(c.id) || clipIds.has(c.id) || typeof c.name !== 'string' || c.name.length > 200 || !ACTIONS.includes(c.action) || !DIRECTIONS.includes(c.direction) || typeof c.loop !== 'boolean') fail('Invalid animation clip');
    clipIds.add(c.id);
    if (!Array.isArray(c.frames) || !c.frames.length || c.frames.length > 120) fail('Each clip must have 1..120 frames');
    total += c.frames.length;
    for (const f of c.frames) {
      if (!id(f.id) || frameIds.has(f.id) || !finite(f.durationMs, 10, 10000) || !f.root || !finite(f.root.x, -256, 512) || !finite(f.root.y, -256, 512) || !f.pose || typeof f.pose !== 'object' || Array.isArray(f.pose)) fail('Invalid animation frame');
      frameIds.add(f.id);
      for (const [b, a] of Object.entries(f.pose)) if (!bones.has(b) || !finite(a, -180, 180)) fail('Invalid bone pose');
      if (!Array.isArray(f.contacts) || f.contacts.some(b => !bones.has(b))) fail('Invalid foot contacts');
      if (!Array.isArray(f.events) || f.events.length > 32 || f.events.some(e => !e || typeof e.name !== 'string' || !e.name.length || e.name.length > 100)) fail('Invalid animation events');
      for (const e of f.events) if (e.hitbox && !['x', 'y', 'width', 'height'].every(k => finite(e.hitbox[k], k === 'width' || k === 'height' ? 1 : -256, 512))) fail('Invalid animation hitbox');
      if (f.image) { pixelImage(f.image); if (f.image.width !== p.canvas.width || f.image.height !== p.canvas.height) fail('Frame image must match canvas'); }
    }
  }
  if (total > 1440 || total * p.canvas.width * p.canvas.height > 16_777_216 || total * p.canvas.width * p.canvas.height * Math.max(1, p.parts.length) > 67_108_864) fail('Animation rendering budget exceeded');
  if (!Array.isArray(p.reviews) || p.reviews.length > 2000) fail('Invalid animation reviews');
  const reviews = new Set();
  for (const r of p.reviews) {
    const c = p.clips.find(c => c.id === r.clipId);
    if (!id(r.id) || reviews.has(r.id) || !c || !Array.isArray(r.frameIds) || !r.frameIds.length || r.frameIds.some(id => !c.frames.some(f => f.id === id))) fail('Review has missing clip/frame target');
    if (!STATUSES.includes(r.status) || !['low', 'normal', 'high', 'critical'].includes(r.priority) || !Array.isArray(r.protectedProperties) || r.protectedProperties.some(v => typeof v !== 'string' || v.length > 100)) fail('Invalid animation review state');
    if (typeof r.target !== 'string' || typeof r.expected !== 'string' || r.target.length > 2000 || r.expected.length > 4000) fail('Invalid animation review text');
    if (r.partId && !bones.has(r.partId) && !partIds.has(r.partId) && r.partId !== 'all') fail('Unknown review body part');
    reviews.add(r.id);
  }
  return p;
}
function skeleton(project, clip, frame) {
  const found = new Map(), result = [], sideView = clip.direction === 'left' || clip.direction === 'right';
  for (const b of project.bones) {
    const parent = found.get(b.parent), ox = b.offset.x * (sideView ? .48 : 1);
    const sx = (parent?.x ?? frame.root.x) + ox, sy = (parent?.y ?? frame.root.y) + b.offset.y;
    const angle = radians(b.angle + (frame.pose[b.id] || 0));
    const joint = { id: b.id, parentX: sx, parentY: sy, x: sx + Math.cos(angle) * b.length, y: sy + Math.sin(angle) * b.length, angle };
    found.set(b.id, joint); result.push(joint);
  }
  // Two-link IK locks contact ankles to the ground while preserving both segment lengths.
  for (const side of ['left', 'right']) {
    if (!frame.contacts.includes(`${side}Foot`)) continue;
    const thigh = found.get(`${side}Thigh`), shin = found.get(`${side}Shin`), foot = found.get(`${side}Foot`);
    if (!thigh || !shin || !foot) continue;
    const l1 = project.bones.find(b => b.id === thigh.id).length, l2 = project.bones.find(b => b.id === shin.id).length;
    const target = { x: project.canvas.width / 2 + (side === 'left' ? -5 : 5) * (sideView ? .48 : 1), y: Math.round(project.canvas.height * .854) };
    const dx = target.x - thigh.parentX, dy = target.y - thigh.parentY, raw = Math.hypot(dx, dy), d = Math.max(.001, Math.min(raw, l1 + l2 - .001));
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const nx = raw ? dx / raw : 0, ny = raw ? dy / raw : 1, bend = clip.direction === 'left' ? -1 : 1;
    thigh.x = thigh.parentX + nx * a + ny * h * bend; thigh.y = thigh.parentY + ny * a - nx * h * bend;
    shin.parentX = thigh.x; shin.parentY = thigh.y; shin.x = thigh.parentX + nx * d; shin.y = thigh.parentY + ny * d;
    foot.parentX = shin.x; foot.parentY = shin.y; foot.x = shin.x + (clip.direction === 'left' ? -3 : 3); foot.y = shin.y;
    for (const joint of [thigh, shin, foot]) joint.angle = Math.atan2(joint.y - joint.parentY, joint.x - joint.parentX);
  }
  return result;
}
export function renderAnimationFrame(project, clipId, frameId) {
  const clip = project.clips.find(c => c.id === clipId), frame = clip?.frames.find(f => f.id === frameId);
  if (!frame) fail('Unknown animation frame');
  const { width, height } = project.canvas, pixels = new Uint8Array(width * height * 4), bones = skeleton(project, clip, frame), byId = new Map(bones.map(b => [b.id, b]));
  let clippedPixels = 0;
  const colors = project.palette.map(c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255]);
  const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (!c[3]) return; if (x < 0 || y < 0 || x >= width || y >= height) { clippedPixels++; return; } pixels.set(c, (y * width + x) * 4); };
  const rect = (x, y, w, h, c) => { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) put(x + xx, y + yy, colors[c % colors.length]); };
  const line = (a, b, thickness, color) => { const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y))); for (let i = 0; i <= steps; i++) rect(a.x + (b.x - a.x) * i / steps - thickness / 2, a.y + (b.y - a.y) * i / steps - thickness / 2, thickness, thickness, color); };
  const activeParts = project.parts.filter(part => !part.direction || part.direction === clip.direction);
  const replaced = new Set(activeParts.map(part => part.boneId));
  const segment = (name, thickness, color) => { if (replaced.has(name)) return; const b = byId.get(name); if (b) { line({ x: b.parentX, y: b.parentY }, b, thickness + 2, 0); line({ x: b.parentX, y: b.parentY }, b, thickness, color); } };
  if (frame.image) pixels.set(frame.image.pixels);
  else {
    for (const s of ['left', 'right']) { segment(`${s}Thigh`, 7, 1); segment(`${s}Shin`, 6, 2); segment(`${s}Foot`, 5, 0); }
    segment('leftUpperArm', 7, 2); segment('leftForearm', 6, 6);
    segment('torso', 17, 2); segment('torso', 11, 3);
    const pelvis = byId.get('pelvis'), neck = byId.get('torso'), head = byId.get('head');
    if (pelvis && !replaced.has('pelvis')) { rect(pelvis.x - 10, pelvis.y - 3, 21, 5, 0); rect(pelvis.x - 9, pelvis.y - 2, 19, 3, 6); rect(pelvis.x - 2, pelvis.y - 2, 4, 3, 4); }
    if (neck && !replaced.has('torso')) { rect(neck.x - 8, neck.y - 1, 17, 5, 0); rect(neck.x - 7, neck.y, 15, 3, 4); }
    if (head && !replaced.has('head')) {
      const side = clip.direction === 'left' || clip.direction === 'right';
      rect(head.x - (side ? 6 : 8), head.y - 8, side ? 13 : 17, 17, 0);
      rect(head.x - (side ? 5 : 7), head.y - 7, side ? 11 : 15, 15, clip.direction === 'up' ? 2 : 5);
      rect(head.x - 8, head.y - 9, 17, 5, 2); rect(head.x - 7, head.y - 8, 15, 2, 3);
      if (clip.direction !== 'up') { const eye = clip.direction === 'left' ? -4 : clip.direction === 'right' ? 4 : -4; rect(head.x + eye, head.y - 1, 2, 2, 0); if (!side) rect(head.x + 4, head.y - 1, 2, 2, 0); rect(head.x - 2, head.y + 5, 5, 1, 6); }
      else { rect(head.x - 4, head.y - 3, 9, 10, 1); rect(head.x - 2, head.y + 7, 5, 8, 2); }
    }
    segment('rightUpperArm', 7, 2); segment('rightForearm', 6, 6);
    const hand = byId.get('rightForearm');
    if (hand && !replaced.has('rightForearm')) { const angle = radians(-90 + (frame.pose.rightForearm || 0) * .5), end = { x: hand.x + Math.cos(angle) * 16, y: hand.y + Math.sin(angle) * 16 }; line(hand, end, 4, 0); line(hand, end, 2, 8); rect(hand.x - 3, hand.y - 2, 6, 3, 4); }
    // Imported parts override their corresponding body area after deterministic nearest-pixel rotation.
    for (const part of activeParts) {
      const b = byId.get(part.boneId); if (!b) continue;
      const angle = b.angle - radians(project.bones.find(bone => bone.id === part.boneId).angle), cos = Math.cos(angle), sin = Math.sin(angle);
      for (let sy=0;sy<part.height;sy++) for(let sx=0;sx<part.width;sx++) { if(!part.pixels[(sy*part.width+sx)*4+3]) continue; const dx=Math.round(b.parentX+(sx-part.pivot.x)*cos-(sy-part.pivot.y)*sin), dy=Math.round(b.parentY+(sx-part.pivot.x)*sin+(sy-part.pivot.y)*cos); if(dx<0||dy<0||dx>=width||dy>=height) clippedPixels++; }
      // Inverse-map destination pixels to avoid forward-rotation holes.
      const radius = Math.ceil(Math.hypot(part.width + Math.abs(part.pivot.x), part.height + Math.abs(part.pivot.y)));
      for (let dy = Math.max(-radius, -Math.round(b.parentY)); dy <= Math.min(radius, height - 1 - Math.round(b.parentY)); dy++) for (let dx = Math.max(-radius, -Math.round(b.parentX)); dx <= Math.min(radius, width - 1 - Math.round(b.parentX)); dx++) {
        const sx = Math.round(dx * cos + dy * sin + part.pivot.x), sy = Math.round(-dx * sin + dy * cos + part.pivot.y);
        if (sx >= 0 && sy >= 0 && sx < part.width && sy < part.height) put(b.parentX + dx, b.parentY + dy, part.pixels.slice((sy * part.width + sx) * 4, (sy * part.width + sx) * 4 + 4));
      }
    }
  }
  return { width, height, pixels, bones, contacts: frame.contacts.map(id => { const b = byId.get(id); return { boneId: id, x: b.x, y: b.y }; }), clippedPixels };
}
export function checkAnimationProject(project) {
  const findings = [];
  try { validateAnimationProject(project); } catch (e) { return [{ severity: 'error', code: 'schema', message: e.message }]; }
  const palette = new Set(project.palette.map(c => c.toLowerCase()));
  for (const clip of project.clips) {
    let previous;
    for (const frame of clip.frames) {
      const rendered = renderAnimationFrame(project, clip.id, frame.id), add = (code, message, severity = 'warning', partId) => findings.push({ severity, code, message, clipId: clip.id, frameId: frame.id, ...(partId ? { partId } : {}) });
      if (rendered.clippedPixels) add('clipping', `${rendered.clippedPixels} drawn pixels fall outside the canvas`, 'error');
      let partial = 0, outside = 0, visible = 0;
      for (let i = 0; i < rendered.pixels.length; i += 4) { const a = rendered.pixels[i + 3]; if (!a) continue; visible++; if (a !== 255) partial++; const hex = '#' + [...rendered.pixels.slice(i, i + 3)].map(v => v.toString(16).padStart(2, '0')).join(''); if (!palette.has(hex)) outside++; }
      if (!visible) add('empty-frame', 'Frame contains no visible pixels', 'error');
      if (partial) add('alpha', `${partial} pixels have partial transparency`);
      if (outside) add('palette', `${outside} visible pixels are outside the project palette`);
      for (const c of rendered.contacts) {
        const old = previous?.contacts.find(v => v.boneId === c.boneId);
        if (old && Math.hypot(c.x - old.x, c.y - old.y) > 1) add('foot-slide', 'Contact foot moved more than one pixel; review the contact interval', 'warning', c.boneId);
        if (Math.abs(c.y - Math.round(project.canvas.height * .854)) > 1) add('contact-unreachable', 'The contact target is beyond the leg reach', 'warning', c.boneId);
      }
      for (const [bone, angle] of Object.entries(frame.pose)) if (Math.abs(angle) > 135) add('joint-limit', 'Extreme joint rotation needs visual review', 'warning', bone);
      if (previous) { let changes = 0; for (let i = 0; i < rendered.pixels.length; i += 4) if (rendered.pixels[i + 3] !== previous.pixels[i + 3]) changes++; if (changes > project.canvas.width * project.canvas.height * .25) add('silhouette-jump', 'Large silhouette change between adjacent frames'); }
      previous = rendered;
    }
    if (clip.loop && clip.frames.length > 1) {
      const a = clip.frames[0], b = clip.frames.at(-1); let delta = Math.hypot(a.root.x - b.root.x, a.root.y - b.root.y);
      for (const id of project.bones.map(b => b.id)) delta = Math.max(delta, Math.abs((a.pose[id] || 0) - (b.pose[id] || 0)) / 4);
      if (delta > 8) findings.push({ severity: 'warning', code: 'loop-seam', message: 'First and last poses differ substantially; review loop playback', clipId: clip.id, frameId: a.id });
    }
  }
  return findings;
}
export function animationDiff(before, after) {
  const diff = [];
  for (const key of ['name', 'canvas', 'palette', 'bones', 'parts', 'reviews']) if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) diff.push({clipId:null,frameId:null,path:key,before:copy(before[key]),after:copy(after[key])});
  for (const clip of after.clips) { const old=before.clips.find(c=>c.id===clip.id); for (const key of ['name','action','direction','loop']) if (JSON.stringify(old?.[key])!==JSON.stringify(clip[key])) diff.push({clipId:clip.id,frameId:null,path:key,before:copy(old?.[key]),after:copy(clip[key])}); }
  for (const clip of after.clips) for (const frame of clip.frames) {
    const old = before.clips.find(c => c.id === clip.id)?.frames.find(f => f.id === frame.id);
    if (!old) { diff.push({ clipId: clip.id, frameId: frame.id, path: 'frame', before: null, after: copy(frame) }); continue; }
    for (const key of ['durationMs', 'pose', 'root', 'contacts', 'events', 'image']) if (JSON.stringify(old[key]) !== JSON.stringify(frame[key])) diff.push({ clipId: clip.id, frameId: frame.id, path: key, before: copy(old[key]), after: copy(frame[key]) });
  }
  for (const clip of before.clips) for (const frame of clip.frames) if (!after.clips.find(c => c.id === clip.id)?.frames.some(f => f.id === frame.id)) diff.push({ clipId: clip.id, frameId: frame.id, path: 'frame', before: copy(frame), after: null });
  return diff;
}
export function applyAnimationPatch(project, patch) {
  if (!patch || patch.projectId !== project.id) fail('Animation patch projectId does not match');
  if ((patch.kind !== undefined && patch.kind !== 'studio-animation-patch') || (patch.schemaVersion !== undefined && patch.schemaVersion !== 1)) fail('Unsupported animation patch');
  if (patch.baseRevision !== project.revision) fail('Stale animation revision');
  if (!Array.isArray(patch.operations) || !patch.operations.length || patch.operations.length > 500) fail('Expected 1..500 patch operations');
  if (patch.reviewIds !== undefined && (!Array.isArray(patch.reviewIds) || patch.reviewIds.some(id => !project.reviews.some(r => r.id === id)))) fail('Unknown review ID');
  const selectedReviews = project.reviews.filter(r => (patch.reviewIds || []).includes(r.id));
  if (selectedReviews.some(r=>r.status==='approved')) fail('Approved review cannot be reopened by a patch');
  const next = copy(project);
  for (const op of patch.operations) {
    if (selectedReviews.length && !selectedReviews.some(r=>r.clipId===op.clipId && r.frameIds.includes(op.frameId))) fail('Operation is outside selected review scope');
    const frame = next.clips.find(c => c.id === op.clipId)?.frames.find(f => f.id === op.frameId);
    if (!frame || typeof op.path !== 'string' || !/^(durationMs|contacts|events|image|root\.(x|y)|pose\.[A-Za-z][A-Za-z0-9]*)$/.test(op.path)) fail('Unknown or forbidden animation patch property');
    for (const r of project.reviews.filter(r => r.status !== 'approved' && r.clipId === op.clipId && r.frameIds.includes(op.frameId))) {
      if (r.protectedProperties.some(p => p === '*' || p === op.path || op.path.startsWith(p + '.'))) fail(`Protected animation property: ${op.path}`);
      if (r.partId && r.partId !== 'all' && op.path.startsWith('pose.') && op.path !== `pose.${r.partId}` && r.protectedProperties.includes('otherParts')) fail('Review protects other body parts');
    }
    const [key, child] = op.path.split('.'); if (child) frame[key][child] = copy(op.value); else frame[key] = copy(op.value);
  }
  if (patch.reviewIds !== undefined && (!Array.isArray(patch.reviewIds) || patch.reviewIds.some(id => !next.reviews.some(r => r.id === id)))) fail('Unknown review ID');
  for (const r of next.reviews) if ((patch.reviewIds || []).includes(r.id)) { if (r.status === 'approved') fail('Approved review cannot be reopened by a patch'); if (!patch.operations.some(op => op.clipId === r.clipId && r.frameIds.includes(op.frameId))) fail('Review marked modified without a targeted operation'); r.status = 'modified'; }
  next.revision++; validateAnimationProject(next); return { project: next, diff: animationDiff(project, next) };
}
export function createAnimationFeedback(project) {
  validateAnimationProject(project);
  const reviews = project.reviews.filter(r => r.status === 'pending');
  const clips = project.clips.flatMap(c => { const ids = new Set(reviews.filter(r => r.clipId === c.id).flatMap(r => r.frameIds)); return ids.size ? [{ ...copy(c), frames: c.frames.filter(f => ids.has(f.id)).map(copy) }] : []; });
  return { schemaVersion: 1, kind: 'animation-feedback', projectId: project.id, baseRevision: project.revision, canvas: copy(project.canvas), palette: copy(project.palette), bones: copy(project.bones), parts: copy(project.parts), reviews: copy(reviews), constraints: copy(project.reviews.filter(r=>r.status !== 'approved' && clips.some(c=>c.id===r.clipId && c.frames.some(f=>r.frameIds.includes(f.id))))), clips, instructions: 'Return {projectId,baseRevision,operations:[{clipId,frameId,path,value}],reviewIds:[]}. Only change requested frames and respect protectedProperties. Pose values are additive degrees relative to bone.angle. Frame duration is milliseconds. Do not replace the complete project.' };
}
