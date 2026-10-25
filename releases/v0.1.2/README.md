# Game UI Studio 0.1.2

新增明显的 **导入 UI** 入口及 **简体中文 / English** 界面切换。

[下载 Windows 10 / 11 x64 安装程序](https://github.com/sleeper-lfy/my-prototype/raw/refs/heads/main/releases/v0.1.2/Game-UI-Studio-Setup-0.1.2-x64.exe)。安装包内置运行环境，可直接覆盖升级 0.1.1；用户项目、资源和语言设置独立保留。

## 使用变化

- 顶部“导入 UI”支持文件选择、拖放和粘贴原生项目 JSON，显示格式检查与项目摘要，默认下载当前项目 JSON 备份后再导入。
- “导出项目”与导入分开；补丁、组件模板和素材的入口有明确说明。
- 右上角切换简体中文和英文，覆盖主要面板、提示和错误。语言保存在本机，端口变化或重启后仍有效；设计文案、组件 ID 和评论不被翻译。
- 文件错误或缺少素材时保留当前项目，并在导入窗口内显示错误。

[操作说明及截图](../../docs/IMPORT-AND-LANGUAGE.md) · [安装与升级](../../docs/WINDOWS-INSTALL.md)

## 下载与校验

| 文件 | 用途 |
| --- | --- |
| [Game-UI-Studio-Setup-0.1.2-x64.exe](Game-UI-Studio-Setup-0.1.2-x64.exe) | Windows 一键安装程序，24,297,537 字节 |
| [安装包 SHA-256](Game-UI-Studio-Setup-0.1.2-x64.exe.sha256) | 核对下载文件 |
| [windows-manifest.json](windows-manifest.json) | 运行环境、安装内容及源文件哈希 |
| [源码包](game-ui-studio-v0.1.2.zip) | 源码、测试和重建脚本 |
| [配套 skill](game-ui-studio-skill-v0.1.2.zip) | Codex 审阅与增量修改流程 |
| [ZIP 校验和](SHA256SUMS) | 源码和 skill ZIP 的 SHA-256 |

安装程序 SHA-256：`e754f2651027f9df1397fb5bc87af83ef25328e2362f0ed2acf589efcdc68bcc`。安装包未签名。

## 验证

42 项模型/API/skill/启动器检查、9 项导入和语言浏览器检查、16 项原有编辑/审阅回归、11 项组件和字体检查均通过，见 [验证汇总](verification.json)。

[Windows 安装包 Wine 验收](windows-verification.json) 15/15 通过，包括从运行中的 0.1.1 升级并逐字节保留项目、中文及空格路径安装、真实脚本启动、安装后导入项目与中英切换、重启及升级保留语言选择、卸载保留数据。测试实际使用内置 Windows Node 和真实 Chromium。

Wine 不等同于原生 Windows。当前云环境尚未验证原生 Windows、默认浏览器关联和 SmartScreen；原生测试见 [Actions 工作流](../../.github/workflows/windows-installer.yml)。本版本没有重新进行 Godot 引擎渲染或美术验收。
