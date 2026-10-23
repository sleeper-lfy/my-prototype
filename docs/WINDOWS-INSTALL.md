# Windows 一键安装

适用 Windows 10 / 11 x64。安装包内置 Node.js、已构建的编辑器、游戏示例资源和配套 Codex skill；使用编辑器无需另装 Node.js、npm、Python、Docker 或 Penpot。安装和本地编辑不需要联网。

## 下载与使用

1. 下载 [Game-UI-Studio-Setup-0.1.1-x64.exe](https://github.com/sleeper-lfy/my-prototype/raw/refs/heads/main/releases/v0.1.1/Game-UI-Studio-Setup-0.1.1-x64.exe)。[发行文件目录](../releases/v0.1.1/) 提供校验和及构建、验证记录。
2. 双击安装包。应用安装到当前 Windows 用户的目录，创建桌面和开始菜单入口，完成后打开默认浏览器中的编辑器。
3. 以后双击桌面 **Game UI Studio** 即可使用。修改自动保存在本机；重复打开会复用同一实例。

安装包尚未签名，Windows 可能显示“未知发布者”或 SmartScreen 提示。可以用发行目录中的 SHA-256 核对下载文件：

```powershell
Get-FileHash "$HOME\Downloads\Game-UI-Studio-Setup-0.1.1-x64.exe" -Algorithm SHA256
```

## 数据、退出与卸载

| 内容 | 默认位置 |
| --- | --- |
| 应用及内置运行环境 | `%LOCALAPPDATA%\Programs\Game UI Studio\` |
| 当前项目、导入资源和反馈包 | `%LOCALAPPDATA%\GameUIStudio\data\` |
| 运行状态与日志 | `%LOCALAPPDATA%\GameUIStudio\runtime\` |
| 配套 skill | 应用目录下 `app\.agents\skills\game-ui-studio\` |

浏览器地址使用自动分配的本地端口，只监听 `127.0.0.1`。通过快捷方式打开即可。关闭浏览器标签后，本地服务仍可继续运行；用开始菜单的停止入口退出服务。再次双击应用会恢复打开。

重新运行新版安装包会先停止当前应用再更新程序。通过 Windows“已安装的应用”卸载，或运行应用目录中的卸载程序；卸载保留上述 `data` 目录，方便重新安装后继续使用。备份时可在编辑器导出项目，或停止应用后复制整个 `data` 目录。

安装失败或打开失败时，保留安装提示和 `runtime` 目录内的日志用于排查。无需结束其他应用使用的 Node.js 进程。

## Codex 与 Godot

配套 skill 随应用保存；Codex 客户端仍需用户自己安装和配置。让 Codex 读取安装目录下的 `app\.agents\skills\game-ui-studio\SKILL.md`，或按 [skill 安装说明](CODEX-SKILL.md) 配置用户级 skill。运行 helper 时使用应用目录里的 `node.exe`，并传入 `--root "<安装目录>\app"`；实时修改的 `--url` 使用编辑器当前浏览器地址。

Godot 场景导出可直接使用。打开和运行导出的工程仍需本机安装 Godot 4；安装包未包含 Godot 引擎。既有示例美术和功能范围见 [验收结果](VALIDATION.md)。

## 从源码构建

构建环境需要 Node.js 24 和 NSIS 3.11 或更新版本（支持原生 x64 安装器）。Windows 或 Linux 均可生成 Windows x64 安装包：

```text
npm ci
npm test
npm run package:windows
```

构建脚本先构建前端，再按锁文件安装最小运行依赖，下载固定版本的官方 Windows Node.js ZIP 并核对 SHA-256，最后编译 NSIS。临时文件使用系统临时目录；工作项目、个人资源、凭据和研究依赖不会进入安装包。

可配置 `MAKENSIS_BIN` 指向 NSIS 编译器、`STUDIO_BUILD_DIR` 指向构建目录、`NODE_WINDOWS_ZIP` 指向已下载的固定版本 Node.js ZIP。即使使用本地 ZIP 也必须通过预定校验和。发行产物位于 `releases/v0.1.1/`。

原生 Windows 验收脚本为 `scripts/test-windows-install.ps1`，只允许在没有既有应用数据的干净测试用户中运行。GitHub Actions 的 Windows installer workflow 会执行安装、启动、保存、升级、卸载和数据保留检查。是否通过以实际报告为准，工作流存在不代表已经在 Windows 实机验收。
