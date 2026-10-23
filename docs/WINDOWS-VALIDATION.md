# Windows 安装包验证记录

版本：0.1.1。日期：2026-10-23（北京时间）。安装包 SHA-256：`a70ff4ec60c686a95d3962f3d3f810703a4c707d85b2e49e190204cf50a3231d`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 模型、API、Codex skill、桌面启动器 | 39/39 通过 | [测试日志](../artifacts/windows-test-suite.txt) |
| 前端与 NSIS 构建 | 通过，原生 Windows x64 PE，24,287,179 字节 | [产物清单](../releases/v0.1.1/windows-manifest.json) |
| 官方 Node.js 24.19.0 Windows 运行环境 | 发行 ZIP 固定 SHA-256 匹配，Wine 中实际运行 | [产物清单](../releases/v0.1.1/windows-manifest.json) |
| Windows 安装程序的兼容层验收 | 14/14 通过 | [完整记录](../releases/v0.1.1/windows-verification.json) |
| 安装版 Codex helper | Windows Node 读取真实反馈 ZIP，完整项目 dry-run 通过 | [skill 记录](../artifacts/windows-skill-validation.json) |
| 原生 Windows 桌面 | 本次云环境未运行 | [Windows CI 工作流](../.github/workflows/windows-installer.yml) |

兼容层测试在 Linux 的 Wine 10 中执行实际 `.exe` 安装器和官方 Windows `node.exe`，不是用 Linux Node 代替安装后的运行环境。真实 `wscript.exe` 运行随包启动和停止脚本；Linux Chromium 访问该 Windows Node 服务，加载 36 个组件的 Konva 画布，实际修改属性、保存并刷新核验。

测试还覆盖中文和空格路径、全部 666 个安装文件哈希、桌面与四个开始菜单快捷方式、HKCU 卸载信息、并发重复启动、被其他进程占用的控制端口、已有安装下拒绝更换路径、应用运行时升级与卸载。升级和卸载后逐字节核对项目和导入资源，确认用户数据保留。安装器只操作自己的进程，没有全局结束 Node 进程。

早期验证发现 Windows 命名管道允许同名多实例，已改为确定性控制端口的独占监听；状态通过挑战及 HMAC 验证，编辑器 HTTP 端口仍自动分配。Wine 的 VBScript 参数枚举也促使启动脚本改用等价索引循环。上述报告对应修复后的最终安装包。

## 明确边界

- Wine 结果不等于 Windows 10 / 11 实机验收。原生 Windows CI 已提供，但本报告没有将尚未取得的 Actions 结果写成通过。
- 默认 Windows 浏览器关联和 SmartScreen 提示未在本环境测试；安装包未签名。
- 本轮没有新增截图、调用图像生成或改动已恢复预览；之前 14 个预览文件的 SHA-256 均保持一致。
- 本轮没有重新运行 Godot 引擎或美术验收。先前示例的 Godot 证据仍属于原先测试版本；新设计仍需单独验证。
