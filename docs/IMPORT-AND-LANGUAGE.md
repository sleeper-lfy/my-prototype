# 导入 UI 与切换语言

适用于 Game UI Studio **0.1.2 及更新版本**。旧版底部的“打开项目”已升级为顶部独立的“导入 UI”，原来的“项目文件”明确改名为“导出项目”。

## 导入 Codex 生成的 UI

1. 顶部点击 **导入 UI / Import UI**，也可按 `Ctrl+O`。
2. 选择或拖入 `.json` 项目文件，或粘贴完整项目 JSON 后点击 **检查项目 / Check project**。
3. 检查项目名称、画布尺寸、组件数、资源数与意见数。
4. 默认勾选“导入前下载当前项目 JSON 备份”。备份包含设计配置；自定义素材仍位于本机资源目录。
5. 点击 **导入并打开 / Import and open**。导入会替换当前工作项目；取消不会改变项目。

导入后的文字、图片、按钮、面板和容器仍是独立组件，可以选中、拖动、编辑和评论。格式错误、将补丁或组件模板误当项目、资源文件不存在等情况会给出提示，失败导入保留原项目。

| 文件或用途 | 入口 |
| --- | --- |
| 完整项目 JSON | 顶部“导入 UI” |
| 组件模板 JSON | 图层面板“导入组件” |
| Codex 增量补丁 | 差异面板“导入 Codex 补丁” |
| 图片、字体 | 资源面板“导入素材” |
| 已有 HTML / React 页面 | 先让 Codex 根据项目 JSON 模板转换为工具支持的独立组件，再导入 |

导入窗口提供 **下载 JSON 模板 / Download JSON template**。也可将导出的当前项目交给 Codex，按真实资源 ID 生成新设计。自定义图片与字体需先放入本机资源库；项目 JSON 中的路径必须指向可用资源。

## 中文与英文

右上角选择 **简体中文 / English**，界面立即切换。工具栏、图层、资源、设计规范、属性、审阅、差异、按钮状态、导入窗口、提示及常见错误均提供两种语言。

选择保存在本机的 `data/preferences.json`，应用重启、浏览器存储清空或本地端口变化后仍可恢复。Windows 安装版的完整路径是 `%LOCALAPPDATA%\GameUIStudio\data\preferences.json`。

语言设置属于编辑器偏好，不会修改项目版本、组件 ID、设计中的文字或用户评论内容。

## 实际截图与验证

- [中文编辑器](../previews/v0.1.2/editor-zh.png) · [英文编辑器](../previews/v0.1.2/editor-en.png)
- [中文导入窗口](../previews/v0.1.2/import-zh.png) · [英文导入窗口](../previews/v0.1.2/import-en.png)
- [导入和语言浏览器验收：9/9](../artifacts/v0.1.2/import-language-results.json)
- [原有编辑与审阅流程：16/16](../artifacts/v0.1.2/browser/browser-test-results.json)
- [组件模板、节点和字体：11/11](../artifacts/v0.1.2/editor-extra-results.json)
- [模型、API、skill 与启动器：42/42](../artifacts/v0.1.2/unit-tests.txt)
- [Windows 安装程序 Wine 验收：15/15](../releases/v0.1.2/windows-verification.json)

Wine 验收实际运行 Windows 安装器及内置 Windows Node，并覆盖旧版升级、安装后导入和中英文切换、设置持久化、重装及卸载的数据保留。Wine 结果不代表原生 Windows 实机验收；Windows 原生自动化流程见仓库 Actions。
