# Game UI Studio · local experiment

<img src="previews/branding/game-ui-studio-logo.png" alt="Game UI Studio Logo" width="120">

[Logo 透明 PNG 原图](previews/branding/game-ui-studio-logo.png)

用于独立游戏 UI 原型与等距地图的本地编辑和审阅工具。React + Konva 提供真实画布，Node 保存本地文件；角色详情页示例可以编辑、评论、导出反馈包、应用受约束的 JSON 补丁，以及导出 Godot 4 场景。不需要账户、付费 API 或在线 AI 服务。

**当前范围**：固定尺寸游戏界面、等距二维地图、单人文件工作流。不是完整 Figma 替代品。Penpot 自托管和官方本地 MCP 已单独做可行性验证，具体证据、许可和选型成本见 [技术选型](docs/TECHNICAL-DECISION.md)。

配套 Codex skill：[`$game-ui-studio`](.agents/skills/game-ui-studio/SKILL.md)。[安装与使用](docs/CODEX-SKILL.md)；[v0.4.1 Windows 安装包、源码与 skill](releases/v0.4.1/)。

已有图片已集中保存在 [previews/](previews/README.md)：包含原始画布、编辑器、Godot、角色插图和反馈局部截图，并附路径、尺寸、文件大小及 SHA-256 清单，可直接在 GitHub 查看。

## Windows 一键安装

下载 [Game-UI-Studio-Setup-0.4.1-x64.exe](https://github.com/sleeper-lfy/my-prototype/raw/refs/heads/main/releases/v0.4.1/Game-UI-Studio-Setup-0.4.1-x64.exe)，双击安装后从桌面打开。适用 Windows 10 / 11 x64，内置运行环境，无需安装 Node.js 或运行命令。项目数据独立保存，升级和卸载保留数据。安装包未签名。

[安装、退出、卸载与排障](docs/WINDOWS-INSTALL.md) · [发行文件与校验和](releases/v0.4.1/)

顶部 **“导入 UI”** 可以选择、拖入或粘贴 Codex 生成的项目 JSON，先检查组件及资源数量，再备份并导入。**“导出项目”** 单独保存当前设计；增量补丁在“差异”中导入。右上角可切换 **简体中文 / English**，设置保存在本机，重新启动仍有效。项目中的文字、组件 ID 和审阅内容保持原样。

[导入 UI 与语言切换图文说明](docs/IMPORT-AND-LANGUAGE.md)

## v0.4.1：像素角色动画、动作来源与骨架标定

顶部 **像素动画 / Pixel animation** 提供四方向人形骨架预设、确定性帧生成、逐帧与洋葱皮预览、姿势和时长编辑、素材导入、稳定帧评论、Codex 反馈和补丁、差异与回退，以及 Godot AnimatedSprite2D 导出。默认人物主体参考框为 **64×96**，动作帧自动扩展到所有动作的共同范围，武器和肢体可超出主体框。示例美术由程序绘制，用于动作验证；用户可替换自己的角色素材。动画独立保存在用户数据目录的 `animation-state.json`，使用动画 JSON 完整导入导出，不包含在 UI／地图项目 ZIP 内。[动画操作说明](docs/PIXEL-ANIMATION.md)。

**64×96 是主体参考，不是帧大小上限。** 超出的肢体、武器和素材使用全动作共同范围与固定原点保留。新增 Quaternius RobotExpressive（CC0）真实骨骼轨道的待机、行走、跑步、出拳预设；来源与转换记录见[动作来源](docs/MOTION-SOURCES.md)。骨架标定支持从当前骨架取点、本地轮廓建议、导入 AI／外部关节点 JSON，再通过拖动或数值调整并人工确认。轮廓建议不是语义 AI 识别。

## v0.3.0：项目工具箱

UI 顶部和地图工具栏提供 **项目工具箱**：完整项目库与资源 ZIP、多页面/地图、地图块与关联组件实例、矩形图集切分、连续地形连接规则、放置限制、可点击 UI 交互、文案多语言、安全区、九宫格、按钮状态、测量和参考图、全项目检查，以及带冲突预览的 Godot 增量更新。[完整操作说明](docs/PROJECT-TOOLBOX.md)。

Godot 更新仅管理独立生成目录，保留外部脚本和用户场景；手工修改过的生成文件需要明确处理冲突。地图旋转/镜像变换布局，方向性美术需提供对应素材。

## Codex 生成与 2.5D 地图

工作区上方可切换 **UI 设计 / 2.5D 地图**，两份文档分别保存在本机。已有 UI 不会被地图覆盖。

- **Codex 生成任务**：填写需求、尺寸和美术限制，选择角色、背包、商店、HUD、空白或当前设计模板，导出包含真实模型校验器与素材参考的 ZIP。让 Codex 返回 `result.project.json`，再点“导入 UI”。[操作指南](docs/CODEX-GENERATION.md)
- **选择性接受修改**：UI 和地图补丁都先预览差异，再勾选接受；部分接受后意见保留待处理，重新导出反馈继续修改。过期版本、锁定和保护字段仍由服务端检查。
- **吸附与辅助线**：UI 拖动时显示边缘和中心对齐线，支持吸附开关、多选对齐与等距分布，锁定及自动布局组件仍受约束。
- **地图工作区**：等距网格、地砖笔刷/橡皮/矩形/填充、图层锁定和显隐、素材拖放拼接、整数格占地轮廓、图层前后顺序、物件吸附拖动与锚点、阻挡、出生点和出口、走动预览。支持原生地图 JSON、本地素材和图集裁切、物件及区域评论、局部反馈与回退。[地图操作指南](docs/MAP-WORKSPACE.md)
- **Godot 地图导出**：面向 Godot 4.3+ 的 `TileMapLayer`、物件与稳定 ID 映射；实际测试方法及当前结果见 [本版验证](docs/VALIDATION-v0.3.0.md)。

本版提供规则驱动地形连接与表单式页面交互；没有三维地形、可旋转镜头、交互连线画布或内置 AI 聊天。内置村庄是可替换的原创矢量样例，美术效果需单独审阅。

## 源码安装和启动

1. 安装 [Node.js 24 LTS](https://nodejs.org/)。
2. 下载或克隆本仓库，在项目目录打开 PowerShell：

```powershell
npm.cmd ci
npm.cmd run dev
```

在本机浏览器输入 `http://127.0.0.1:4380`。服务仅监听本机。按 Ctrl+C 停止。也可运行 `powershell -ExecutionPolicy Bypass -File scripts/start-windows.ps1`（仅对这次脚本进程生效）。首次安装需访问 npm，依赖安装后编辑、审阅、补丁和导出流程均在本地完成。

生产构建：

```powershell
npm.cmd run build
npm.cmd start
```

Linux/macOS 使用相同 npm 命令，无需 `.cmd`。需要 Node >=22.12，推荐 24 LTS。`PORT` 可指定监听端口，`STUDIO_DATA_DIR` 可指定工作文件目录。

## 六步最小验证

1. 打开内置 Ashfall 角色详情页。选择图层或画布组件，拖动、缩放或在属性面板输入尺寸；保存后刷新验证。
2. 选择 `recruit-button` 或 `character-card`，填写修改目标、期望效果、禁止修改字段和优先级。评论以稳定 ID 关联组件；位置改变不影响关联。
3. 导出 Feedback ZIP。包内只有待处理意见、目标组件、必要祖先/局部上下文、设计规范、相关资源和局部截图，以及补丁模板。
4. 将 ZIP 交给本机 Codex，按 `PATCH-INSTRUCTIONS.md` 返回 JSON 补丁。无需把整个编辑器或整屏 HTML 反复生成。可先用内置示例补丁，把招募按钮改为 `RECRUIT · 240`。
5. 导入补丁，查看字段前后差异。补丁不能改 ID、越过评论范围或改禁止字段；过期 revision 会被拒绝。用户手动验收，或安全回退。回退遇到后续字段修改会拒绝覆盖。
6. 导出 Godot ZIP，解压后用 Godot 4 打开 `project.godot` 并运行场景。`node-map.json` 和节点 `studio_id` 保留映射；自由布局用 Control，自动排列用真实 Container。

## 文件和数据

| 路径 | 用途 |
| --- | --- |
| `examples/character.project.json` | 不可变的初始示例设计及两条待处理评论 |
| `examples/recruit.patch.json` | 最小增量补丁示例（仅匹配初始 revision；UI 示例按钮使用当前 revision） |
| `public/assets/` | 原创角色/背景/按钮/九宫格纹理和共用字体 |
| `examples/village.map.json` | 初始 16×16 村庄入口地图 |
| `data/map.json` | 独立保存的地图、区域评论与补丁历史 |
| `data/workbench.json` | 多项目、UI 页面、地图、模板与规则库 |
| `data/preferences.json` | 中英文界面偏好 |
| `data/project.json` | 当前工作设计、评论状态和补丁差异记录，自动持久化 |
| `data/assets/` | 用户导入的本地资源 |
| `data/exports/` | 反馈包及 Godot ZIP |
| `artifacts/` | 本次实际验证结果和截图；详见验收报告 |
| `research/penpot/` | 官方部署配置、复现脚本和独立探测结果 |

`data/` 不加入 Git。项目工具箱管理多个完整项目、UI 页面与地图；`project.json` 和 `map.json` 保存活动文档，`workbench.json` 保存项目库及其他文档。切换前自动记录活动文档。普通 JSON 只交换配置，跨机器迁移请选择含原始素材的“完整项目 ZIP”，或停止工具后备份整个数据目录。不要用版本控制覆盖工作目录。当前不做多人冲突合并。

共享组件：选中卡片/按钮组后用左侧“导出组件”保存子树 JSON，“导入组件”会重新分配稳定 ID。模板包含资源引用；跨机器共享时需一并携带资源文件。普通“导入组件”创建独立副本；需要关联实例与主模板更新时，使用项目工具箱的模板功能。

## 测试与 Godot 截图

```powershell
npm.cmd test
npm.cmd run build
$env:GODOT_BIN = 'C:\Tools\Godot\Godot_v4.6.3-stable_win64_console.exe'
npm.cmd run test:godot
npm.cmd run test:map-godot
```

Godot 可执行文件可放入 PATH，或用 `GODOT_BIN` 指定。截图需要图形显示；Windows 桌面直接运行，Linux CI 需 X11/虚拟显示和 OpenGL compatibility。纯 headless 引擎可以验证场景结构，但不能作为实际渲染截图成功的证据。测试脚本将导出示例到 `artifacts/godot-project/`，执行导入、节点验证和截图，并写入结果。结果文件不存在或脚本失败均不算通过。

浏览器验收使用开发测试工具 Python Playwright + Chromium：`python scripts/browser-smoke.py`，参数见脚本帮助。这不是日常运行依赖。功能测试结果与美术评审见 [验收报告](docs/VALIDATION.md) 和 [美术验收](docs/ART-REVIEW.md)。

## 已知边界

- 当前验证桌面固定画布，没有响应式断点、复杂约束系统、动画、交互连线画布或完整字体排版引擎。
- Container 子组件由容器排列，不能直接拖动 x/y。通过父容器的 gap/padding 和子组件尺寸调整，避免在 Godot 中出现“坐标被改写”的误解。
- Godot 导出的是基础视觉场景；按钮的游戏业务逻辑需要在游戏中绑定。字体栅格化、SVG 采样、主题状态和边缘抗锯齿可造成截图差异，不能据此声称像素级保真。
- 独立美术验收尚需用户确认。原创矢量角色是可替换的概念样例，功能通过不代表可直接作为最终商业美术。
- 本轮验证运行在 Linux 云机器；Windows 启动脚本和路径按 Windows 设计，未声称经过 Windows 实机测试。

代码与原创示例 SVG 使用 MIT；DejaVu 字体使用随附的 [字体许可](public/assets/FONT-LICENSE.txt)。Penpot 的 MPL-2.0 与第三方依赖许可详见技术选型文档。
