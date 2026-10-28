# v0.4.1 验证记录

本版修正64×96含义：它是人物主体参考尺寸，所有动作共享按实际内容扩展的画布和原点。超出主体框的肢体、武器、攻击框和导入素材保留。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 模型、API、校准与既有回归 | 122项通过 | [日志](../artifacts/v0.4.1/unit-tests.txt) |
| 浏览器工作流 | 10项通过，零页面错误 | [报告](../artifacts/v0.4.1/animation-browser/results.json) |
| Godot真实运行 | 来源动作、固定原点、88帧和12事件通过；待机与扩展攻击像素匹配 | [报告](../artifacts/v0.4.1/animation-godot/results.json) |
| 安装与升级 | Wine 18项通过，含升级、完整像素和离线反馈校验器 | [安装报告](../releases/v0.4.1/windows-verification.json) |

浏览器检查实际显示主体参考框和扩展画布，读取攻击PNG确认身体框外446个可见像素保留；大图集128×128、偏移(-32,-16)往返保留像素、帧ID和评论。来源动作通过真实按钮应用，姿势实际改变，CC0、作者、原始GLB哈希和来源进入反馈。工具关节点建议不改变保存项目，人工调整并确认后才持久化；外部AI文件声称已确认也重置为草稿。

Godot验证使用真实Quaternius来源Idle预设和特意超出主体框的攻击测试帧。扩展范围149×152、原点(0,56)，待机和攻击共用范围。待机1431个不透明像素、攻击1547个不透明像素与实际截图逐点匹配，攻击测试帧在主体外的像素未裁切。场景实际播放并检查非均匀时长及事件次数。

真实来源GLB、上游README、完整CC0许可、SHA-256和转换记录已保存；`node scripts/convert-motion-presets.mjs --check` 可逐字节复现四个预设。它们是作者制作的骨骼动画，不宣称为真人动捕。三维投影到简化二维骨架会损失深度和缩短效果，仍需目标角色上的人工审阅。

运行：`npm test`、`npm run build`、`python scripts/animation-smoke.py`、`npm run test:animation-godot`。Godot截图需要真实图形显示；不可用headless替代。安装验证为Wine及实际Windows Node配合Linux Chromium，不等于原生Windows实机验收。程序示例美术仍需独立验收。

[使用说明](PIXEL-ANIMATION.md) · [来源与许可](MOTION-SOURCES.md) · [实际截图](../previews/v0.4.1/README.md)
