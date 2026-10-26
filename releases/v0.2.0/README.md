# Game UI Studio v0.2.0

[下载 Windows x64 一键安装包](https://github.com/sleeper-lfy/my-prototype/raw/refs/tags/v0.2.0/releases/v0.2.0/Game-UI-Studio-Setup-0.2.0-x64.exe)

本版加入 UI 吸附与对齐辅助线、Codex 生成任务包，以及独立的 2.5D 等距地图工作区。

地图支持按 1×1、2×2、N×M 格占地拖放素材、图层前后关系、碰撞与走动、稳定 ID 评论、局部反馈、选择性接受补丁与回退。每层地形导出为真实 Godot TileMapLayer，保留物件、图层、占地与节点映射。

安装包内置运行环境，可以覆盖升级 v0.1.2，用户项目、地图、语言与导入素材独立保留。无需另外安装 Node.js。Godot 引擎需要另外安装。

- [地图使用](../../docs/MAP-WORKSPACE.md)
- [吸附与格单位](../../docs/ALIGNMENT-AND-GRID.md)
- [Codex 生成任务](../../docs/CODEX-GENERATION.md)
- [实测截图](../../previews/v0.2.0/README.md)
- [验证记录](../../docs/VALIDATION-v0.2.0.md)
- [安装文件校验](Game-UI-Studio-Setup-0.2.0-x64.exe.sha256)
- [Windows 兼容验证](windows-verification.json)

功能、导出保真与美术分别验收。地图为二维等距；不包含三维地形、自动地形过渡或内置付费 API。Windows 安装包未签名；本轮 Windows 程序在 Wine 中验证，没有声称 Windows 实机测试已通过。
