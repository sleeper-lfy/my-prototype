# 第一阶段验收结果

验证日期：2026-10-23。测试平台：Linux x86_64，Node 24.19.0，Chromium 154.0.8037.57，Godot 4.6.3。Windows 是目标平台，本轮没有 Windows 实机测试记录。

## 六项用户目标

| 目标 | 实际验证 | 结果 |
| --- | --- | --- |
| 本地打开、编辑、保存 | 本地 Node 服务加载 JSON；UI 编辑写入临时磁盘项目，刷新后仍在 | 通过 |
| 自由拖动组件 | Playwright 真实鼠标拖动原生按钮；检查保存坐标；尺寸修改及撤销重做 | 通过 |
| 对按钮和卡片发表评论 | 示例分别带按钮/卡片意见；UI 新建评论，移动卡片后刷新，nodeId 保持 | 通过 |
| 导出待处理意见给 Codex | UI 下载真实 ZIP，校验意见、限制、局部 PNG、节点和补丁模板 | 通过 |
| 导入增量修改并重新加载差异 | 从 JSON 文件导入补丁，刷新后 modified 状态、前后文案和历史 ID 保留；安全回退恢复原文案 | 通过 |
| 导出 Godot 4 可运行界面 | 实际导入、运行并检查全部 36 个节点，再通过 Xorg/OpenGL 实际渲染截图 | 通过 |

这是一套真实组件画布：文字、Button、Panel、TextureRect、Control、HBoxContainer、VBoxContainer、MarginContainer 是独立节点，支持新增与属性编辑。角色插图本身是图像资源，不把整屏截图作为编辑对象。

## 自动化证据

- `npm test`：**27/27 通过，0 失败，0 跳过**。覆盖文档、评论、补丁原子性、禁止字段、版本冲突、回退冲突、反馈范围、布局、Godot 场景生成、ZIP、持久化与本地 API。记录：[unit-tests.txt](../artifacts/unit-tests.txt)。
- `npm run build`：通过。当前单个客户端 bundle 大于 Vite 默认建议阈值，有体积提示；本轮没有宣称完成包体优化。记录：[build.txt](../artifacts/build.txt)。
- 生产模式浏览器：**16/16 通过**，零未捕获异常。每次在独立临时数据目录启动，不修改 `data/`。记录：[browser-test-results.json](../artifacts/browser-test-results.json)。
- 额外浏览器组件验证：**11/11 通过**，覆盖包含五个节点的卡片模板往返、新 ID、八种标准节点新增和 TTF 字体加载。记录：[editor-extra-results.json](../artifacts/editor-extra-results.json)。
- 开发模式：页面加载、两次刷新和反馈下载通过，零未捕获异常。Vite WebSocket 已接到同一个本地 HTTP server。记录：[development-smoke.json](../artifacts/development-smoke.json)。
- Godot：headless 和图形运行均验证 **36/36** 个节点的类、稳定 ID、文本、位置、尺寸及透明度。截图为实际引擎渲染的 960×600 PNG。记录：[godot-results.json](../artifacts/godot-results.json)。
- Penpot：官方 2.15.4 部署、数据库 readiness、profile RPC 和官方 MCP 协议探测通过；真实设计文件的插件修改未运行。记录：[latest-probe.json](../research/penpot/latest-probe.json)。

## 可直接审阅的文件

- [完整编辑器截图](../artifacts/editor.png)：真实编辑器界面。
- [原版画布](../artifacts/canvas.png)：revision 1，960×600，无选择框/评论标记。
- [Godot 截图](../artifacts/godot.png)：同一初始设计的真实渲染。
- [差异增强图](../artifacts/godot-difference.png)：RGB 差异放大四倍，仅帮助定位差别。
- [补丁审阅截图](../artifacts/patch-diff.png)：重新加载后仍可查看 `RECRUIT HERO` → `RECRUIT · 240`。
- [反馈包](../artifacts/feedback-sample.zip)、[对应项目](../artifacts/feedback-project.json)、[实际补丁](../artifacts/applied.patch.json)、[应用后项目](../artifacts/after-patch.project.json)：是一组匹配的测试产物。反馈/补丁 baseRevision 为 9，应用后为 10；不要将其直接当作初始 revision 1 的补丁。
- [可运行的 Godot 项目 ZIP](../artifacts/godot-export.zip)：解压后用 Godot 4 打开 `project.godot`。

初始示例、评论和可应用于初始版本的补丁在 `examples/`；UI 的“查看并应用示例修改”会使用当前版本，并仍经过所有范围与保护校验。

## 截图比较与独立美术验收

比较相同设计的两个 960×600 输出，归一化 RGB 平均绝对误差约 **1.0668%**；至少一个通道差异超过 25/255 的像素占 **2.6198%**。比较结果及源项目/截图 SHA-256 写入 Godot 结果文件。

比较不是像素完全一致，也不是感知质量评分。人工目视确认未丢失组件、文本或自动布局；主要剩余差异在字体栅格化、描边内外边缘、SVG 色阶和九宫格采样。没有用宽松阈值把差异测试伪装成“美术合格”。

独立于样例作者的本轮目视检查确认：角色、姓名、招募动作形成明确层级，背景没有压住主要内容，编辑器本体与游戏画面区分清楚。最终游戏风格、人物美术、低对比次要文案和 9–11px 元数据仍需用户按项目标准验收，见 [ART-REVIEW.md](ART-REVIEW.md)。

## 第一阶段边界

- 组件模板是子树 JSON + 资源引用，导入会生成新 ID；没有实例联动、版本化组件库或完整 Figma 约束系统。跨机器需一并传递资源文件。
- 评论是稳定 ID 关联；删除组件会删除关联评论，撤销可以恢复。复制组件不复制已有审阅任务。
- 布局支持固定画布、自由定位和三种常用容器。未验证响应式断点、复杂嵌套大文档或大量节点性能。
- Godot 输出原生视觉场景，不自动实现招募逻辑、导航、键盘手柄焦点规则或动画。非映射属性写入 `export-warnings.json`，界面会提示警告数量；当前示例警告为零。
- 不提供内置 AI 聊天；反馈和补丁都以本地文件交换。没有测量付费 API token 花费，也不承诺某个百分比的模型额度节省。
- 本轮无真实 Penpot 设计文件的 MCP 修改记录，也未把 Penpot 插件适配器冒充已实现功能。
- Windows 安装/启动方式已给出；需要在目标机按 README 完成一次实际验收后，才能声称 Windows 实机支持已验证。

## 重现

```text
npm ci
npm test
npm run build
python scripts/browser-smoke.py --chromium <Chromium executable>
python scripts/editor-extra-checks.py
npm run test:godot -- --reference artifacts/canvas.png
```

浏览器测试依赖 Python Playwright；常规使用只需要 Node。Godot 设置 `GODOT_BIN` 或加入 PATH。Linux 无桌面时需要可用的 X11/虚拟显示再运行截图测试；Windows 桌面不需要 DISPLAY 设置。查看脚本 `--help` 和 README 了解参数。测试结果只代表当前代码/当前样例，不代表新环境已恢复或软件已发布。
