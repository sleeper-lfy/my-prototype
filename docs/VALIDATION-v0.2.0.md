# v0.2.0 验证记录

本轮在 Linux 云环境使用真实 Chromium、Godot 4.6.3 和 Wine 中的 Windows x64 安装程序验证。Windows 实机与最终美术验收单独记录，不用文件生成或测试通过替代。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 模型、API、skill、桌面启动与吸附数学 | 83 项通过 | [unit-tests.txt](../artifacts/v0.2.0/unit-tests.txt) |
| 地图与 Codex 文件工作流 | 20 项通过 | [地图浏览器报告](../artifacts/v0.2.0/browser/map-workspace-results.json) |
| UI 实际吸附线、多选拖动与对齐 | 6 项通过 | [对齐报告](../artifacts/v0.2.0/alignment/alignment-results.json) |
| 既有编辑器生产构建回归 | 15 项通过；使用已构建 bundle | [UI 回归](../artifacts/v0.2.0/ui-browser/browser-test-results.json) |
| 可见导入和语言持久化 | 9 项通过 | [导入与语言报告](../artifacts/v0.2.0/import-language-results.json) |
| 全部原生组件、模板与字体 | 11 项通过 | [扩展组件检查](../artifacts/v0.2.0/editor-extra-results.json) |
| Godot 场景、碰撞、实际移动与图形渲染 | 通过 | [引擎报告](../artifacts/v0.2.0/godot-map/results.json) |
| 编辑器与 Godot 同源截图比较 | 已测量，非像素级相同 | [比较报告](../artifacts/v0.2.0/godot-map/comparison/results.json) |
| Windows 安装、升级与数据保留 | 以实际报告为准 | [安装验证](../releases/v0.2.0/windows-verification.json) |

地图验收实际用鼠标完成素材拖放，验证 1×1 地砖、2×3 地形铺设六格、2×2 房屋占地轮廓、3×2 实例占地与不变的图片尺寸、越界和锁定拒绝、换层保留评论与 ID。UI 测试检查拖动中的真实辅助线、不同缩放、独立开关、松开后的清理以及多选布局持久化。未捕获浏览器错误为零。

Godot 默认村庄验证 328 个原生 TileMapLayer 单元、8 个物件、38 个真实物理阻挡格、全部 256 格通行性与 14 步实际角色移动。补充的多格摆放与层级场景验证 2×2 房屋新增四个阻挡格、图层前后遮挡，以及图集裁切、隐藏层碰撞和小数显示尺寸。详见 [引擎复现说明](../artifacts/v0.2.0/godot-map/README.md)。

实际 React Konva MapScene 与 Godot 使用同一地图、原图和相同变换进行比较；默认场景平均 RGB 绝对误差约 0.278%，超过 10% 通道差异的像素约 0.151%。差异主要出现在 SVG 栅格化和采样边缘。这个数值不代表所有自定义素材都已验证，也不代表美术已通过。

[实际操作截图](../previews/v0.2.0/README.md) · [吸附与格单位使用说明](ALIGNMENT-AND-GRID.md)

当前范围是二维等距地图。没有三维高度、旋转镜头、自动地形拼接规则、导航网格烘焙、多页面交互连线或内置 AI 聊天。地砖多格铺设重复单格地砖；它不会自动切分整张大型等距场景图。地图导出要求 Godot 4.3+。

Windows 安装包未签名。Wine 兼容验证不等于 Windows 实机验收；本轮没有声称 SmartScreen 或 Windows 默认浏览器关联已验证。GitHub Actions 已配置 Windows 原生测试，是否通过以运行结果为准。
