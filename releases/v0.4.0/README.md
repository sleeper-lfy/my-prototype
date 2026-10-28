# Game UI Studio v0.4.0

[Windows x64 一键安装包](https://github.com/sleeper-lfy/my-prototype/raw/refs/tags/v0.4.0/releases/v0.4.0/Game-UI-Studio-Setup-0.4.0-x64.exe)

打开顶部“像素动画 / Pixel animation”。默认64×96，提供四方向人形待机、行走、攻击预设，确定性像素帧生成、播放和洋葱皮、骨架与攻击框、姿势／时长编辑、部件和图集导入、帧评论、Codex反馈包与受保护增量补丁、差异与回退、Godot AnimatedSprite2D导出。

动画JSON包含素材像素和评论；请单独导出备份。现有UI／地图完整项目ZIP暂不包含动画。示例角色为程序绘制的动作参考，最终美术需独立验收。

[使用说明](../../docs/PIXEL-ANIMATION.md) · [真实截图](../../previews/v0.4.0/README.md) · [测试记录与边界](../../docs/VALIDATION-v0.4.0.md)

- [源码ZIP](game-ui-studio-v0.4.0.zip)
- [配套Codex skill](game-ui-studio-skill-v0.4.0.zip)
- [安装程序校验和](Game-UI-Studio-Setup-0.4.0-x64.exe.sha256)
- [实际安装验证](windows-verification.json)

110项自动测试与8项浏览器流程通过；Godot实际播放88帧并验证事件和截图。Wine安装与升级18项通过。安装包内置Node运行环境，Godot另行安装。Windows安装验证在Wine中进行，原生Windows和最终美术验收尚未完成；安装包未签名。
