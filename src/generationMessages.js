export const generationMessages = {
  title: { 'zh-CN': 'Codex 生成任务包', en: 'Codex generation task' },
  intro: { 'zh-CN': '写下页面需求，导出包含模板、素材与校验工具的本地任务包。把 ZIP 交给 Codex，完成后通过“导入 UI”打开生成的项目。', en: 'Describe the screen and export a local task package with a template, assets and validator. Give the ZIP to Codex, then open the returned project through Import UI.' },
  name: { 'zh-CN': '新项目名称', en: 'New project name' },
  brief: { 'zh-CN': '页面需求', en: 'Screen requirements' },
  briefPlaceholder: { 'zh-CN': '例如：制作暗黑幻想游戏的背包页面，包含装备栏、物品网格、详情卡和使用按钮。', en: 'For example: a dark fantasy inventory with equipment slots, an item grid, detail card and Use button.' },
  template: { 'zh-CN': '起始模板', en: 'Starting template' },
  blank: { 'zh-CN': '空白画布', en: 'Blank canvas' },
  current: { 'zh-CN': '当前设计副本', en: 'Current design copy' },
  character: { 'zh-CN': '角色详情', en: 'Character details' },
  inventory: { 'zh-CN': '背包', en: 'Inventory' },
  shop: { 'zh-CN': '商店', en: 'Shop' },
  hud: { 'zh-CN': '游戏 HUD', en: 'Game HUD' },
  width: { 'zh-CN': '画布宽度', en: 'Canvas width' },
  height: { 'zh-CN': '画布高度', en: 'Canvas height' },
  rules: { 'zh-CN': '美术与修改限制（每行一条）', en: 'Art direction and constraints (one per line)' },
  rulesPlaceholder: { 'zh-CN': '例如：采用旧金色与深绿色；按钮须有清晰状态；保持已有素材 ID。', en: 'For example: antique gold and deep green; distinct button states; retain existing asset IDs.' },
  includeContext: { 'zh-CN': '包含当前设计作为参考', en: 'Include the current design as reference' },
  contextHint: { 'zh-CN': '模板会沿用当前项目的配色、字体和素材。取消参考选项可减少 Codex 需要读取的内容。', en: 'Templates reuse the current palette, fonts and asset library. Disable the reference option to reduce the content Codex needs to read.' },
  local: { 'zh-CN': '本地文件交换，无需配置付费 API。导出不会修改当前设计。', en: 'Local file exchange; no paid API configuration. Exporting leaves the current design unchanged.' },
  export: { 'zh-CN': '导出任务包', en: 'Export task package' },
  exporting: { 'zh-CN': '正在打包…', en: 'Packaging…' },
  close: { 'zh-CN': '关闭', en: 'Close' },
  ready: { 'zh-CN': '任务包已就绪', en: 'Task package ready' },
  download: { 'zh-CN': '下载任务 ZIP', en: 'Download task ZIP' },
  next: { 'zh-CN': '将 ZIP 发给 Codex，并说：“读取 TASK.md，按需求生成可编辑 UI。运行校验后返回 result.project.json，列出未满足的要求。”', en: 'Give Codex the ZIP and say: “Read TASK.md and generate the editable UI. Run validation, return result.project.json and list any unmet requirements.”' },
  error: { 'zh-CN': '任务包导出失败，请检查本地服务后重试。', en: 'Task export failed. Check the local server and try again.' },
  stale: { 'zh-CN': '项目版本已更新，请关闭窗口并重新导出任务包。', en: 'The project revision changed. Close the dialog and export again.' },
  invalid: { 'zh-CN': '请填写名称、页面需求，以及 320–4096 之间的画布尺寸。每条限制最多 2000 字。', en: 'Enter a name, requirements and canvas dimensions between 320 and 4096. Each constraint may contain up to 2000 characters.' },
};

export function generationText(locale, key) {
  return generationMessages[key]?.[locale === 'en' ? 'en' : 'zh-CN'] || key;
}
