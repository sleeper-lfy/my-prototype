# Game UI Studio 0.1.1

Windows 10 / 11 x64 用户下载 [Game-UI-Studio-Setup-0.1.1-x64.exe](https://github.com/sleeper-lfy/my-prototype/raw/refs/heads/main/releases/v0.1.1/Game-UI-Studio-Setup-0.1.1-x64.exe)，双击安装即可。内置运行环境、编辑器、示例美术和 Codex skill，无需 npm 或其他前置安装。安装后从桌面打开，在默认浏览器中编辑本地项目。

- 安装包大小：24,287,179 字节，约 23.2 MiB。
- SHA-256：`a70ff4ec60c686a95d3962f3d3f810703a4c707d85b2e49e190204cf50a3231d`。
- 运行环境：官方 Node.js 24.19.0 x64，已核对发行 ZIP 的固定 SHA-256。
- 安装包未签名。Windows 可能显示未知发布者或 SmartScreen 提示。
- 应用按当前用户安装，无需管理员权限；升级前停止本应用，卸载保留 `%LOCALAPPDATA%\GameUIStudio\data`。

本版本新增一键安装、桌面启动、单实例复用、安全停机和用户数据隔离。安装器不会覆盖用户级 Codex skills；随包 skill 位于安装目录的 `app\.agents\skills\game-ui-studio`，客户端配置方式见 [安装说明](../../docs/WINDOWS-INSTALL.md)。Godot 引擎需另行安装才能运行导出场景。

## 文件

| 文件 | 用途 |
| --- | --- |
| [Windows 安装程序](Game-UI-Studio-Setup-0.1.1-x64.exe) | 一键安装编辑器 |
| [安装程序校验和](Game-UI-Studio-Setup-0.1.1-x64.exe.sha256) | 核对下载文件 |
| [windows-manifest.json](windows-manifest.json) | 安装内容、许可证、源文件和运行环境哈希 |
| [windows-verification.json](windows-verification.json) | 此安装程序的实际验证结果与测试边界 |
| [源码 ZIP](game-ui-studio-v0.1.1.zip) | 开发、重建和源码审阅 |
| [Codex skill ZIP](game-ui-studio-skill-v0.1.1.zip) | 独立配置用户级 skill；仍需本应用提供模型 |
| [SHA256SUMS](SHA256SUMS) | 源码与 skill ZIP 的校验和 |

安装、数据位置、停止服务、卸载和从源码构建的步骤见 [Windows 使用说明](../../docs/WINDOWS-INSTALL.md)。安装后的使用不依赖聊天图片是否能够显示；已有游戏界面和编辑器截图位于 [previews/](../../previews/README.md)。

## 验证边界

完整源码检查为 39/39 通过，见 [测试记录](../../artifacts/windows-test-suite.txt)。配套 skill 已使用内置 Windows Node 在 Wine 中验证真实反馈包，见 [skill 检查](../../artifacts/windows-skill-validation.json)。

此安装程序在 Wine 10 中 **14/14 项验收通过**：实际安装到中文及空格路径、666 个安装文件逐一校验、快捷方式与注册信息、真实启动/停止脚本、浏览器画布编辑保存、增量补丁、并发复用、端口冲突拒绝、重启、运行中升级和卸载。升级与卸载均核对用户项目和导入资源哈希，确认数据保留。详情见 [完整报告](windows-verification.json)。

Wine 是 Linux 上的 Windows 兼容层；其结果不等同于原生 Windows 实机测试。原生 Windows 安装、启动、保存、升级和卸载验收已配置到 [GitHub Actions](../../.github/workflows/windows-installer.yml)，状态以该工作流实际运行结果为准。已有 Godot 截图及美术验收是先前示例的结果，本次安装打包没有重新生成图片或重新宣称美术通过。
