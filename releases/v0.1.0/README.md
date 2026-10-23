# Game UI Studio v0.1.0

本版本通过 Git 提交和版本标签分发，ZIP 保存在仓库中。

| 文件 | 内容 |
| --- | --- |
| `game-ui-studio-v0.1.0.zip` | 完整本地实验项目、源代码、样例、美术、测试证据和配套 Codex skill |
| `game-ui-studio-skill-v0.1.0.zip` | 可安装的独立 `game-ui-studio` skill；使用命令时仍需完整应用 |
| `SHA256SUMS` | 两个 ZIP 的校验值 |
| `manifest.json` | 包大小、文件数、源文件和归档内容的 SHA-256 |
| `release-verification.json` | 对实际 ZIP 干净解压后的安装、测试、构建、启动及独立 skill 验证 |

完整项目解压后安装 Node.js 24，运行 `npm ci`、`npm run dev`。详细说明见包内 README。skill 安装及调用见 `docs/CODEX-SKILL.md`。

包含真实组件编辑、ID评论、反馈ZIP、受约束补丁、差异与回退、Godot场景导出，以及原始角色页样例。Windows 实机和 Penpot 文档级 MCP 修改仍未验证；美术需要独立验收。

包由 `npm run package:release` 生成，排除 node_modules、用户data、缓存、Git元数据、环境文件及 release 目录，避免递归打包。没有把本地服务或账号状态作为发行包的一部分。

发行包已在含空格的新目录中解压验证：`npm ci`、34项测试、生产构建和本地服务启动全部通过；独立 skill ZIP 解压到另一个目录后，已成功针对完整应用执行真实反馈包 dry-run。两次打包的校验值一致。
