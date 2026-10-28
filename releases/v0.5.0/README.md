# Game UI Studio v0.5.0

[下载 Windows x64 一键安装包](https://github.com/sleeper-lfy/my-prototype/raw/refs/tags/v0.5.0/releases/v0.5.0/Game-UI-Studio-Setup-0.5.0-x64.exe)

新增七项基础工作流：角色键盘试演、动画事件时间轴、地图多格角色可玩性检查、装备挂点与配色、Godot UI 有限回读、资源体检与引用、Codex 批量任务及人工验收。保留原 Logo，可从 v0.4.2 覆盖升级。

角色试演、时间轴、装备入口：像素动画 → 角色试演·时间轴·装备。地图新增内容位于地图工作区；任务队列、资源体检和场景回读位于顶部「工作流」。

[使用方式](../../docs/WORKBENCH-v0.5.0.md) · [实际截图](../../previews/v0.5.0/README.md) · [验证记录](../../docs/VALIDATION-v0.5.0.md)

- [源码 ZIP](game-ui-studio-v0.5.0.zip)
- [Codex skill ZIP](game-ui-studio-skill-v0.5.0.zip)
- [安装验证](windows-verification.json)

138 项自动测试、9 组 Chromium 工作流、19 项 Wine 安装检查通过。动画、地图、回读 UI 均在 Godot 4.6.3 实际运行并截图。

Windows 原生实机和独立美术验收尚未完成。音效/VFX 以事件信号交给游戏接入。Godot 回读支持标准 UI 范围，未知属性和脚本保留在源文本副本中。
