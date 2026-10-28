# Game UI Studio v0.4.1

[Windows x64 一键安装包](https://github.com/sleeper-lfy/my-prototype/raw/refs/tags/v0.4.1/releases/v0.4.1/Game-UI-Studio-Setup-0.4.1-x64.exe)

本版修正并扩展像素角色动画：

- **64×96是人物主体参考，不是动画帧上限**。武器、肢体和素材可超出，所有帧使用共享扩展范围与固定原点，预览／反馈／Godot导出都保留完整像素。
- 接入Quaternius RobotExpressive的真实Idle、Walking、Running、Punch骨骼轨道（CC0）。保留作者、来源版本、原文件哈希、完整许可和可复现转换脚本；原始动作是关键帧动画，不声称为真人动捕。
- 新增17点骨架标定：从现有骨架取点、轮廓工具建议或导入AI关节点JSON，再拖动或输入坐标，人工确认后应用。建议不自动成为已确认数据。

在顶部打开“像素动画”，左侧选择来源动作，右侧“标定”调整角色关节。完整帧图片不会自动拆成可独立运动的身体部件；轮廓建议是几何启发式，需人工校正。

[使用说明](../../docs/PIXEL-ANIMATION.md) · [动作来源](../../docs/MOTION-SOURCES.md) · [实测截图](../../previews/v0.4.1/README.md) · [验证与边界](../../docs/VALIDATION-v0.4.1.md)

- [源码ZIP](game-ui-studio-v0.4.1.zip)
- [Codex skill](game-ui-studio-skill-v0.4.1.zip)
- [安装校验和](Game-UI-Studio-Setup-0.4.1-x64.exe.sha256)
- [实际安装验证](windows-verification.json)

122项自动测试与10项浏览器流程通过。Godot实际验证真实来源动作、88帧、12事件，以及统一原点和身体框外像素。Windows安装与升级18项Wine测试通过，结果与最终EXE哈希见链接报告；Wine不等于原生Windows实机验收，美术继续独立验收。安装包未签名。

可覆盖升级v0.4.0，保留既有UI、地图和动画数据。动画使用独立JSON备份，仍不包含在UI／地图完整项目ZIP中。
