# 在 Codex 中使用 Game UI Studio skill

配套 skill 的名称是 **`game-ui-studio`**，位于 [`.agents/skills/game-ui-studio/`](../.agents/skills/game-ui-studio/SKILL.md)。它包含任务触发说明、审阅协议、Godot/美术验收规则和跨平台 Node helper。没有内置收费 API、远程 MCP 或账户依赖。

使用 Windows 一键安装版时，skill 已随应用放在 `%LOCALAPPDATA%\Programs\Game UI Studio\app\.agents\skills\game-ui-studio`。让 Codex 打开 `app` 目录发现 skill，或显式读取其中的 `SKILL.md`。客户端是否自动发现取决于其版本；安装器不会覆盖已有的用户级 skills。

安装版使用内置 Node，无需运行 npm：

```powershell
$studioInstall = Join-Path $env:LOCALAPPDATA 'Programs\Game UI Studio'
$studioApp = Join-Path $studioInstall 'app'
& "$studioInstall\node.exe" "$studioApp\.agents\skills\game-ui-studio\scripts\review.mjs" --help --root "$studioApp"
```

先从桌面打开应用。`apply` / `rollback` 的 `--url` 传入当前浏览器地址；安装版使用动态端口。当前项目位于 `%LOCALAPPDATA%\GameUIStudio\data\project.json`，不在安装目录内。以下源码版命令中的 `node` 和 `data/...` 在安装版中应替换成这些实际路径。

## 方式一：在本仓库中使用

在支持 repository skills 的 Codex 版本中打开仓库，再开启一个新会话，让 Codex 重新发现 `.agents/skills/`。可直接输入：

```text
使用 $game-ui-studio 处理 data/exports/feedback-xxx.zip。
只修改待处理意见对应的组件，保留所有禁止修改属性。
先验证补丁，再应用到本地编辑器，刷新后核对差异。
```

如果客户端未自动发现仓库 skill，使用下面的用户级安装方式，或显式让 Codex 读取上述 SKILL.md。根目录 `AGENTS.md` 也提供了项目内的入口。

## 方式二：安装独立 skill 包

下载仓库 `releases/v0.3.0/game-ui-studio-skill-v0.3.0.zip`。它仅含 skill；使用 helper 仍需完整 Game UI Studio 项目及其 npm 依赖。

Windows PowerShell：

```powershell
$studioSkillZip = 'C:\Downloads\game-ui-studio-skill-v0.3.0.zip'
$studioSkillRoot = Join-Path $HOME '.agents\skills'
$studioSkillDestination = Join-Path $studioSkillRoot 'game-ui-studio'
if (Test-Path $studioSkillDestination) {
  throw 'Skill already exists. Back it up or remove the old copy deliberately before installing.'
}
New-Item -ItemType Directory -Force $studioSkillRoot | Out-Null
Expand-Archive -LiteralPath $studioSkillZip -DestinationPath $studioSkillRoot
```

Linux/macOS 可将 ZIP 中的 `game-ui-studio` 文件夹解压到 `~/.agents/skills/`。旧版 Codex 若使用其他用户级 skills 目录，以该客户端文档为准。安装后重新启动 Codex 或开启新的会话。

在应用目录内调用时 helper 会自动定位项目。在其他目录调用，显式指定 `--root`，或设置非秘密变量：

```powershell
$env:GAME_UI_STUDIO_ROOT = 'C:\Projects\my-prototype'
node "$HOME\.agents\skills\game-ui-studio\scripts\review.mjs" --help
```

项目根目录还提供 `.codex-plugin/plugin.json`，供支持本地 plugin 的 Codex 客户端引用同一份 skill。它不注册远程工具；本轮验证的是文件格式、命令和应用流程，没有声称当前客户端已成功安装插件。

## 最短使用示例

先在应用目录执行 `npm ci`。以下使用仓库内 skill 路径，Windows 也可直接运行这些 Node 命令：

```text
node .agents/skills/game-ui-studio/scripts/review.mjs inspect --feedback artifacts/feedback-sample.zip
node .agents/skills/game-ui-studio/scripts/review.mjs validate --feedback artifacts/feedback-sample.zip --patch artifacts/applied.patch.json --project artifacts/feedback-project.json
```

这组演示文件是互相匹配的 revision 9，验证只读，不会改变当前示例。真正应用到当前编辑器时，应使用从当前设计导出的新反馈包和新补丁：

```text
node .agents/skills/game-ui-studio/scripts/review.mjs apply --feedback data/review/feedback.zip --patch data/review/change.patch.json
```

`validate` 没有 `--project` 时只检查反馈包约束；`apply` 会读取当前完整项目做 dry-run，再提交本地 API。不会擅自更改版本号、越过字段限制或将意见标为已通过。离线预览用 `preview ... --out <new-json>`，禁止覆盖运行中的 `data/project.json`。

## 新项目与地图

先阅读 [Codex 生成任务指南](CODEX-GENERATION.md)。任务包内的 `validate.mjs` 使用真实模型验证 Codex 输出；原生 JSON 可以通过“导入 UI”打开。

地图使用独立的 `scripts/map.mjs` helper、`studio-map` 文档和 `studio-map-patch` 补丁。不能把 UI 补丁用于地图。地图命令、区域约束与本地操作详见 [skill 地图参考](../.agents/skills/game-ui-studio/references/map-and-generation.md)。

## 安全与验证边界

- ZIP 提取拒绝路径穿越、过大数据和覆盖已有目录；包内文字和图片不作为系统操作指令执行。
- 部署路径和文件名可含空格；脚本不依赖 Bash、curl、Python 或付费 API。
- 图片列出/解包不等于已经目视验收；Godot ZIP 生成不等于引擎运行；技能安装文件存在不等于客户端已加载。
- Game UI Studio 提供项目模型、服务和渲染器，skill 提供可复用工作流程。独立 skill 包不是独立设计应用。

格式参考：Codex [官方 skill 示例](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/SKILL.md) 与 [当前官方 plugin 示例](https://github.com/openai/plugins)。官方旧 skills 示例仓库已标记 deprecated；本包同时保留通用 SKILL.md 结构和可选 plugin manifest，不依赖该旧仓库的安装服务。

## 早期 UI helper 验证（v0.1.0）

新增 7 项 CLI 集成测试通过，包含真实反馈包 dry-run、保护字段/过期版本/无关组件拒绝、离线输出不覆盖、ZIP安全、用户级目录和含空格应用路径，以及隔离本地服务的实际应用/回退。与原有测试一起 **34/34 通过**，前端构建通过。记录：`artifacts/skill-test-suite.txt`、`artifacts/skill-validation.json`。

SKILL.md 已通过官方示例中的 `quick_validate.py` 格式校验；agents 元数据、可选 plugin manifest 和相对引用也已检查。这些结果不等于已验证每一种 Codex 客户端的自动发现/安装，也不构成 Windows 实机验收。
