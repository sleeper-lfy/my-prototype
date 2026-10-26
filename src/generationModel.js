import { validateProject, NODE_TYPES, PATCH_FIELDS } from './model.js';

export const GENERATION_TEMPLATES = ['blank', 'current', 'character', 'inventory', 'shop', 'hud'];

export function validateGenerationRequest(input) {
  const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0
    || !text(input.name, 200) || !text(input.brief, 8000)
    || !GENERATION_TEMPLATES.includes(input.template)
    || ![input.width, input.height].every(value => Number.isSafeInteger(value) && value >= 320 && value <= 4096)
    || !['zh-CN', 'en'].includes(input.locale)
    || (input.includeContext !== undefined && typeof input.includeContext !== 'boolean')
    || !Array.isArray(input.rules) || input.rules.length > 40 || !input.rules.every(value => text(value, 2000))) {
    throw Object.assign(new Error('generation.invalid'), { status: 400 });
  }
  return { baseRevision: input.baseRevision, name: input.name.trim(), brief: input.brief.trim(), template: input.template,
    width: input.width, height: input.height, locale: input.locale, rules: input.rules.map(rule => rule.trim()), includeContext: input.includeContext === true };
}

export function createGenerationTemplate(current, input) {
  validateProject(current);
  const task = validateGenerationRequest(input);
  const zh = task.locale === 'zh-CN';
  const choose = (cn, en) => zh ? cn : en;
  const copy = value => structuredClone(value);
  const project = task.template === 'current' ? copy(current) : {
    schemaVersion: 1, id: 'generated-ui', name: task.name, revision: 1,
    canvas: { width: task.width, height: task.height, background: current.tokens.colors?.ink || '#111b18' },
    tokens: copy(current.tokens), assets: copy(current.assets), nodes: [], reviews: [], history: [],
  };
  project.id = 'generated-ui'; project.name = task.name; project.revision = 1;
  project.reviews = []; project.history = [];
  project.tokens.rules = [...new Set([...(project.tokens.rules || []), ...task.rules])];
  if (task.template === 'current') {
    const sx = task.width / current.canvas.width, sy = task.height / current.canvas.height;
    project.canvas.width = task.width; project.canvas.height = task.height;
    for (const node of project.nodes) {
      node.frame.x *= sx; node.frame.y *= sy; node.frame.width = Math.max(1, node.frame.width * sx); node.frame.height = Math.max(1, node.frame.height * sy);
      if (node.style?.fontSize) node.style.fontSize = Math.min(512, Math.max(1, node.style.fontSize * Math.min(sx, sy)));
    }
    return validateProject(project);
  }
  if (task.template === 'blank') return validateProject(project);
  const palette = { fill: current.tokens.colors?.forest || '#253d35', edge: current.tokens.colors?.gold || '#c0a96c', text: current.tokens.colors?.parchment || '#e2dfc9' };
  const font = current.tokens.fonts?.body || 'sans-serif';
  const asset = kind => current.assets.find(item => item.kind === kind)?.id;
  const namedAsset = (id, kind) => current.assets.find(item => item.id === id)?.id || asset(kind);
  const buttonAsset = namedAsset('button-normal', 'button');
  const sx = task.width / 960, sy = task.height / 600;
  const node = (id, type, name, x, y, width, height, style = {}, assetId) => {
    const result = { id, type, name, parentId: null, frame: { x: x * sx, y: y * sy, width: width * sx, height: height * sy },
      style: { opacity: 1, ...style }, layout: { mode: 'free', gap: 0, padding: 0 }, visible: true, locked: false };
    if (assetId) result.assetId = assetId;
    if (result.style.fontSize) result.style.fontSize = Math.max(1, Math.min(512, result.style.fontSize * Math.min(sx, sy)));
    project.nodes.push(result);
    return result;
  };
  const label = (id, text, x, y, width, size = 22, height = 38) => node(id, 'Label', text, x, y, width, height, { text, color: palette.text, fontFamily: font, fontSize: size, align: 'left' });
  const panel = (id, name, x, y, width, height) => node(id, 'Panel', name, x, y, width, height, { fill: palette.fill, stroke: palette.edge, strokeWidth: 1, radius: 6 }, asset('nineSlice'));
  const button = (id, text, x, y, width = 200) => {
    const result = node(id, 'Button', text, x, y, width, 48, { text, color: palette.text, fontFamily: font, fontSize: 18, align: 'center', fill: palette.fill, stroke: palette.edge, strokeWidth: 1, radius: 5 }, buttonAsset);
    if (buttonAsset) result.buttonAssets = { normal: buttonAsset, hover: namedAsset('button-hover', 'button'), pressed: namedAsset('button-pressed', 'button') };
    return result;
  };
  if (asset('background')) node('backdrop', 'TextureRect', choose('背景', 'Backdrop'), 0, 0, 960, 600, {}, asset('background'));
  if (task.template === 'character') {
    label('page-title', choose('角色档案', 'CHARACTER DOSSIER'), 40, 30, 600, 30);
    panel('portrait-frame', choose('角色卡', 'Character card'), 40, 95, 310, 450);
    if (asset('portrait')) node('portrait', 'TextureRect', choose('角色立绘', 'Character portrait'), 55, 110, 280, 420, {}, asset('portrait'));
    label('character-name', choose('荒原守望者', 'Warden of the Reach'), 390, 110, 500, 32);
    label('character-class', choose('游侠 · 12 级', 'Ranger · Level 12'), 390, 160, 500, 18);
    panel('stats-panel', choose('能力面板', 'Attributes'), 390, 220, 500, 150);
    label('attribute-health', choose('生命  1200', 'Health  1200'), 415, 245, 430);
    label('attribute-attack', choose('攻击  180', 'Attack  180'), 415, 295, 430);
    label('character-lore', choose('守护山谷与古老盟约。', 'Keeper of the valley and its ancient oath.'), 390, 395, 500, 17);
    button('primary-action', choose('编入队伍', 'ADD TO PARTY'), 390, 490, 280);
  } else if (task.template === 'inventory' || task.template === 'shop') {
    const shop = task.template === 'shop';
    label('page-title', shop ? choose('旅人商店', 'TRAVELLER’S SHOP') : choose('行囊', 'INVENTORY'), 40, 30, 650, 32);
    label('balance', choose('金币  240', 'GOLD  240'), 720, 35, 200, 18);
    panel('items-panel', choose('物品区域', 'Items'), 40, 100, 540, 435);
    const icons = current.assets.filter(item => item.kind === 'icon');
    for (let i = 0; i < 12; i++) {
      const x = 60 + (i % 4) * 128, y = 120 + Math.floor(i / 4) * 130;
      panel(`item-slot-${i + 1}`, choose(`物品槽 ${i + 1}`, `Item slot ${i + 1}`), x, y, 112, 112);
      if (icons.length) node(`item-icon-${i + 1}`, 'TextureRect', icons[i % icons.length].name, x + 28, y + 18, 56, 56, {}, icons[i % icons.length].id);
      label(`item-caption-${i + 1}`, shop ? `${20 + i * 5}` : `${i + 1}`, x + 12, y + 80, 88, 15, 25);
    }
    panel('detail-panel', choose('物品详情', 'Item details'), 610, 100, 310, 435);
    label('item-title', choose('守卫之刃', 'Warden’s blade'), 635, 130, 260, 26);
    label('item-description', choose('坚韧的钢刃，适合远行。', 'A tempered blade for the road.'), 635, 190, 250, 16, 75);
    label('item-attribute', choose('攻击 +24', 'Attack +24'), 635, 300, 250, 19);
    button('primary-action', shop ? choose('购买 · 40', 'BUY · 40') : choose('装备', 'EQUIP'), 635, 455, 260);
  } else if (task.template === 'hud') {
    panel('vitals-panel', choose('生命状态', 'Vitals'), 28, 26, 300, 100);
    label('player-name', choose('守望者', 'WARDEN'), 45, 38, 270, 19);
    node('health-track', 'Panel', choose('生命槽', 'Health track'), 45, 80, 260, 20, { fill: '#15211c', radius: 4 });
    node('health-fill', 'Panel', choose('当前生命', 'Current health'), 45, 80, 210, 20, { fill: '#a95f55', radius: 4 });
    panel('quest-panel', choose('任务追踪', 'Quest tracker'), 655, 26, 275, 100);
    label('quest-title', choose('前往村庄入口', 'Reach the village gate'), 672, 42, 245, 17, 60);
    panel('hotbar-panel', choose('快捷栏', 'Action bar'), 285, 500, 390, 75);
    for (let i = 0; i < 5; i++) button(`hotbar-${i + 1}`, `${i + 1}`, 302 + i * 74, 513, 62);
  }
  return validateProject(project);
}

export const generationFormat = {
  schemaVersion: 1, kind: 'studio-generation-contract',
  output: 'result.project.json', nodeTypes: NODE_TYPES, patchFields: PATCH_FIELDS,
  requiredProjectFields: ['schemaVersion', 'id', 'name', 'revision', 'canvas', 'tokens', 'assets', 'nodes', 'reviews', 'history'],
  rules: [
    'Return an editable native project JSON. HTML, React source, a screenshot or a component template is not a project.',
    'Use stable ASCII IDs, valid parentId references and parent-relative frame coordinates.',
    'HBoxContainer and VBoxContainer control the layout of children. Use Control for free placement.',
    'Retain the existing asset IDs and source paths. Archive assets are references, not replacement project source paths.',
    'Use only existing assets unless the user has explicitly supplied or authorized new assets. Do not invent local paths.',
    'Preserve user-defined art direction. Functional completion does not imply art approval.',
    'Run node validate.mjs result.project.json. The bundled real model is the authoritative validator.',
  ],
};
