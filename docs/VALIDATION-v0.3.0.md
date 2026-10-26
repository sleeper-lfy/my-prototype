# v0.3.0 验证与能力边界

这一版在真实 React/Konva 编辑器中实现项目工具箱。以下报告来自隔离临时数据，不使用用户工作项目做测试。

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 全部自动测试 | 98 项通过 | [测试日志](../artifacts/v0.3.0/unit-tests.txt) |
| 新项目工具箱的真实浏览器流程 | 12 项通过 | [浏览器报告](../artifacts/v0.3.0/browser/results.json) |
| 原有 UI 编辑、反馈、补丁、回退 | 15 项通过 | [UI 回归](../artifacts/v0.3.0/legacy-ui/browser-test-results.json) |
| 原有地图、占地、图层及拖放 | 20 项通过 | [地图回归](../artifacts/v0.3.0/map-regression/map-workspace-results.json) |
| 吸附、多选拖动和对齐 | 6 项通过 | [辅助线回归](../artifacts/v0.3.0/alignment/alignment-results.json) |
| UI 导入和语言持久化 | 9 项通过 | [语言回归](../artifacts/v0.3.0/import-language.json) |
| Godot 增量更新和图形渲染 | 实际引擎通过 | [Godot 报告](../artifacts/v0.3.0/godot-update/results.json) |
| Windows x64 安装与升级 | 以实际报告为准 | [安装报告](../releases/v0.3.0/windows-verification.json) |

新浏览器流程实际点击完成多项目、多页面、完整项目 ZIP 下载/导入，读取 ZIP 中的原始字体和图片，恢复到独立资源路径。UI 测试执行真实点击交互、翻译和分辨率预览，拖动九宫格边界并保存。地图测试实际拖放完整地图块、旋转布局、切分图集、鼠标连续绘制连接地形，以及点选两格测量。中英文工具箱及 1366×768 视口也有截图。

模型/API 测试另外覆盖主模板实例更新与本地覆盖保留、图集边距和间距、地形掩码、放置限制、越界/锁定拒绝、过期项目版本、完整资源包哈希及独立项目恢复。

Godot 使用独立的用户场景实例化生成 UI，运行真实用户 GDScript；首次导入后截取画面，修改 UI 文字再增量更新，重新导入并运行截图。测试确认用户场景、脚本和已有 `project.godot` 字节不变，脚本继续执行，生成 UI 节点的实际文字正确；原生 TileMapLayer 地图也实际运行并截图。

单独的更新器测试会手工修改一个生成场景，验证预览报告冲突、默认拒绝覆盖、仅接受精确路径后更新，并保留手工版本的备份。目录以外的用户脚本不进入更新范围。

复现：`npm test`、`npm run build`、`python scripts/studio-features-smoke.py`、`npm run test:godot-update`。浏览器测试依赖开发环境中的 Python Playwright 与 Chromium；普通使用和安装版不需要 Python。Godot 截图需要图形环境，Linux 可以使用 Xvfb；纯 headless 不作为渲染证据。

功能范围明确如下：

- 地形连接使用用户配置的四邻接掩码规则，不识别图片内容或自动创作美术。
- 地图块布局可旋转与镜像；方向美术通过对应资源映射选择，未配置不会生成新方向图片。
- 组件实例更新同步外观、资源、尺寸和占地，保留本地字段覆盖与锁定项；位置、结构和地图块地形布局不是自动结构合并。
- UI 交互为表单配置与实际点击预览，没有连线画布。游戏业务脚本仍由 Godot 项目维护。
- 多分辨率采用真实原始布局坐标检查裁切与空白，没有自动生成响应式约束。
- 文字溢出和疑似缺字报告需要结合实际字体、回退与排版目视确认。
- Godot 更新只管理 `studio_generated/`，没有自动合并手工改过的场景；冲突需明确接受，旧生成文件有备份。
- Windows 程序在 Wine 中验证，不等于 Windows 实机或原生 Windows Godot 验收。美术质量继续独立验收。

[全部使用方法](PROJECT-TOOLBOX.md) · [实际截图](../previews/v0.3.0/README.md)
