# v0.5.0 验证记录

- Node 模型/API/skill/启动器：138 项通过，0 失败。证据：`artifacts/v0.5.0/unit-tests.txt`。
- 前端生产构建通过。
- 真实 Chromium：9 组工作流通过，包含任务创建、真实裁图 ZIP、结果导入/应用/回退、资源解码检查、角色键盘移动、事件持久化、装备多动作检查、Godot 回读预览、地图通行与区域保存。证据：`artifacts/v0.5.0/browser/results.json`；截图：`previews/v0.5.0/`。
- Godot 4.6.3：实际运行动画导出，验证受击/闪避、全事件参数、装备和统一扩展原点；截图逐像素检查。证据：`artifacts/v0.5.0/animation-godot/results.json`。
- Godot 地图：64 瓦片、2 阻挡格、10 步实际移动及截图通过。证据：`artifacts/v0.5.0/map-godot/results.json`。
- Godot 回读：从 `.tscn` 解析得到的 2 个 UI 节点重新导出，实际 Godot 运行及截图通过。证据：`artifacts/v0.5.0/godot-readback/godot-results.json`。

Windows 安装包在 Wine 中完成 19 项实际安装、升级、Logo、文件哈希、Windows Node 服务、持久化、并发启动和卸载检查，全部通过。证据：`releases/v0.5.0/windows-verification.json`。133 个安装源文件校验和与本次源码一致。未进行原生 Windows 实机验证。功能通过不代表美术验收。程序装备及受击/闪避动作是参考素材；音效和特效资源由游戏连接事件信号。地图验证使用二维格网，无三维地形导航。Godot 回读不支持完整场景与任意节点往返。
