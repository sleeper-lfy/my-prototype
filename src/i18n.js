import { messages } from './messages.js';

export const LOCALES = ['zh-CN', 'en'];
export const DEFAULT_LOCALE = 'zh-CN';
export const normalizeLocale = value => LOCALES.includes(value) ? value : DEFAULT_LOCALE;

export function translate(locale, key, values = {}) {
  const message = messages[key]?.[normalizeLocale(locale)] ?? key;
  return message.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}

// Toasts can outlive a language switch. Recognize catalog text without touching
// project names, component text, review content or asset metadata.
export function translateMessage(locale, message) {
  if (message && typeof message === 'object') return translate(locale, message.key, message.values);
  if (messages[message]) return translate(locale, message);
  for (const [key, pair] of Object.entries(messages)) {
    if (Object.values(pair).includes(message)) return translate(locale, key);
  }
  return message;
}

export function errorMessage(locale, error) {
  if (error && typeof error === 'object' && error.key) {
    const values = { ...error.values };
    if (values.detail) values.detail = errorMessage(locale, values.detail);
    return translate(locale, error.key, values);
  }
  const raw = typeof error === 'string' ? error : error?.message || '';
  for (const [key, pair] of Object.entries(messages)) {
    if (Object.values(pair).includes(raw)) return translate(locale, key);
  }
  const known = translateMessage(locale, raw);
  if (known !== raw || messages[raw] || locale === 'en') return known;
  const exact = {
    'Unsupported project schemaVersion; expected 1.': '项目版本不支持，schemaVersion 必须为 1。',
    'Project ID and name are required.': '项目必须具有有效的 ID 和名称。',
    'Project revision must be a non-negative integer.': '项目版本号必须是非负整数。',
    'Invalid canvas dimensions or background.': '画布尺寸或背景颜色无效。',
    'Project design tokens must be an object.': '项目必须包含设计规范对象 tokens。',
    'Invalid design token colors.': '项目配色格式无效。',
    'Invalid design token fonts.': '项目字体规范格式无效。',
    'Invalid design rules.': '项目设计约束格式无效。',
    'The requested local file is missing.': '找不到项目引用的素材，请先在资源库中导入对应图片或字体。',
    'The project changed in another window. Reload before saving.': '项目已在其他窗口更新，请刷新后继续编辑。',
    'Project identity changed; use Import project.': '项目 ID 已变化，请通过“导入 UI”载入新项目。',
    'The screenshot revision is out of date. Reload and export the feedback again.': '反馈截图版本已过期，请刷新后重新导出反馈。',
    'There are no pending reviews to export.': '没有可导出的待处理意见。',
    'Patch does not belong to this project/schema.': '补丁不属于当前项目，或补丁格式版本不支持。',
    'Patch makes no changes.': '此补丁没有产生任何修改。',
    'Patch is missing or has already been rolled back.': '找不到此修改记录，或该修改已经回退。',
    'Invalid asset path.': '素材路径无效。',
    'Unsupported asset category.': '不支持此素材类型。',
    'Give the asset a short name.': '请为素材填写有效的简短名称。',
    'Asset must be between 1 byte and 15 MB.': '素材大小必须介于 1 字节和 15 MB 之间。',
    'Supported formats: PNG, JPEG, WebP, safe SVG, TTF, OTF.': '支持 PNG、JPEG、WebP、安全的 SVG、TTF 和 OTF 文件。',
    'SVG must be self-contained, without scripts or external references.': 'SVG 必须自包含，且不能包含脚本或外部引用。',
    'Failed to fetch': '无法连接本地服务，请重新打开应用。',
    'Failed to load resource': '资源加载失败。',
    'Document is too deeply nested.': '项目结构嵌套层级过深。',
  };
  if (exact[raw]) return exact[raw];
  const patterns = [
    [/^Unsupported node type: (.+)$/, m => `不支持组件类型：${m[1]}`],
    [/^Invalid (.+) on node (.+)\.$/, m => `组件 ${m[2]} 的 ${m[1]} 属性无效。`],
    [/^Node (.+) needs a complete frame\.$/, m => `组件 ${m[1]} 缺少完整的位置和尺寸。`],
    [/^Node (.+) needs a name\.$/, m => `组件 ${m[1]} 缺少名称。`],
    [/^Missing parent of node (.+)\.$/, m => `组件 ${m[1]} 的父组件不存在。`],
    [/^Node (.+) references missing asset (.+)\.$/, m => `组件 ${m[1]} 引用了不存在的素材 ${m[2]}。`],
    [/^Duplicate (.+) ID: (.+)$/, m => `${m[1]} 中存在重复 ID：${m[2]}`],
    [/^(.+) must be an array of at most (\d+) records\.$/, m => `${m[1]} 必须是数组，且最多包含 ${m[2]} 条记录。`],
    [/^(.+) contains an invalid stable ID\.$/, m => `${m[1]} 包含无效的组件或记录 ID。`],
    [/^Parent cycle involving (.+)\.$/, m => `组件 ${m[1]} 的父子层级存在循环。`],
    [/^Asset (.+) must reference a safe local asset path\.$/, m => `素材 ${m[1]} 必须引用有效的本地素材路径。`],
    [/^Invalid (?:asset metadata|nine-slice margins): (.+)$/, m => `素材 ${m[1]} 的信息或九宫格边距无效。`],
    [/^Stale patch: expected revision (\d+), received (\d+)\./, m => `补丁版本已过期：当前版本为 ${m[1]}，补丁版本为 ${m[2]}。请重新导出反馈。`],
    [/^Protected property: (.+)$/, m => `禁止修改受保护属性：${m[1]}`],
    [/^Property is not patchable: (.+)$/, m => `此属性不支持增量修改：${m[1]}`],
    [/^Component (.+) or its parent is locked\.$/, m => `组件 ${m[1]} 或其父组件已锁定。`],
    [/^Component (.+) is outside the selected review scope\.$/, m => `组件 ${m[1]} 不属于本轮修改范围。`],
    [/^Rollback conflict: (.+) changed after this patch\.$/, m => `无法回退：${m[1]} 在此补丁之后已有修改。`],
  ];
  for (const [pattern, format] of patterns) { const match = raw.match(pattern); if (match) return format(match); }
  return translate(locale, 'error.generic');
}
