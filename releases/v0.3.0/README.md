# Game UI Studio v0.3.0

[Windows x64 一键安装包](https://github.com/sleeper-lfy/my-prototype/raw/refs/tags/v0.3.0/releases/v0.3.0/Game-UI-Studio-Setup-0.3.0-x64.exe)

安装后从 UI 顶部或地图工具栏打开 **项目工具箱 / Project toolbox**。

本版提供：

- 多项目、多 UI 页面、多地图，以及含原始素材、字体、评论和模板的完整项目 ZIP。
- 地图块捕获、整体拖放、布局旋转和镜像、方向美术映射。
- 矩形瓦片图集切分、连续道路/河流/围墙连接规则、地形与占地放置限制。
- 关联组件模板与实例更新，保留本地字段覆盖及锁定项。
- 可点击 UI 交互、多分辨率和安全区预览、游戏文案多语言与字体检查。
- 可拖动九宫格边界、按钮正常/悬停/按下/禁用状态。
- 地图距离/宽度测量、锁定参考图、全项目问题检查。
- Godot 增量更新包、现有项目文件冲突预览、生成目录隔离和旧文件备份。

[完整操作说明](../../docs/PROJECT-TOOLBOX.md) · [实测截图](../../previews/v0.3.0/README.md) · [验证与边界](../../docs/VALIDATION-v0.3.0.md)

98 项自动测试、新工具箱 12 项及既有 UI/地图/语言/对齐浏览器回归通过。真实 Godot 用户场景在更新前后均运行并截图，外部用户脚本、场景和已有 project.godot 保持不变。Windows 程序在 Wine 中通过 17 项安装、升级和数据保留验证；原生 Windows 和最终美术验收尚未完成。

可覆盖升级 v0.2.0，保留已有设计、地图、资源、语言和项目库。运行环境已包含，无需另外安装 Node.js；Godot 引擎另行安装。

地形连接需要配置瓦片规则；旋转方向美术需要对应资源；组件更新同步外观/尺寸/占地，不自动合并结构变化。Godot 更新只管理 studio_generated/，手工改过的生成文件默认拒绝覆盖，需审阅后明确接受冲突。安装包未签名。

- [安装程序校验和](Game-UI-Studio-Setup-0.3.0-x64.exe.sha256)
- [安装验证](windows-verification.json)
- [源码 ZIP](game-ui-studio-v0.3.0.zip)
- [更新后的 Codex skill ZIP](game-ui-studio-skill-v0.3.0.zip)
