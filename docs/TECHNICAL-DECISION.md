# Game UI Studio：技术选型与真实能力验证

核查日期：2026-10-23。Windows 是交付目标；本轮自动实测运行在 Linux 云机器，因此不把 Linux 成功等同于 Windows 已验收。

## 结论

第一阶段采用 **React + Konva 的受限组件编辑器 + 本地 JSON 文件交换 + Godot 4 导出**。不开发通用矢量设计平台，也不让 AI 每轮重建 HTML。设计文档是可版本化 JSON，稳定组件 ID 是评论、差异和 Godot 节点映射的共同主键。

**Penpot 本地自托管和官方本地 MCP 都真实可运行，保留为第二阶段设计输入适配器。** 本轮已启动官方 2.15.4 Docker 服务并验证 HTTP 和数据库 readiness；官方 MCP 已安装、构建、启动并完成协议握手和只读工具调用。没有把 MCP 接到打开的 Penpot 设计文件执行修改，因此那部分仍待端到端验证。

选择自建的原因是第一期最重要的交付是“结构化组件评论 → 受限制增量修改 → 审阅差异 → 有限 Godot 类型”，这需要一个小而明确的语义模型。Penpot 已有优秀的编辑能力，但仍需编写业务评论模型、文件桥接、差异检查及 Godot 语义适配；原生视觉对象并不自动具有 Control/Container/九宫格/按钮状态的游戏语义。

若后续工作转向复杂路径、钢笔、布尔运算、专业文本排版、大型组件库，优先投入 Penpot 适配器；继续扩大自建编辑器会显著增加维护成本。

## 已核实的 Penpot 事实

| 事项 | 核实结果 | 对项目的含义 |
| --- | --- | --- |
| 官方源代码 | `penpot/penpot`，测试标签 `2.15.4`、提交 `d49fa51fefc2faaafa69bd46ec273ba48d682731` | 固定版本，不跟随 develop 的不稳定接口 |
| 官方本地 MCP | 当前主仓库的 `mcp/`；旧 `penpot/penpot-mcp` 在 2026-02-03 归档并合并 | 不采用旧仓库的安装教程作为当前事实 |
| MCP 网络结构 | 本地 HTTP MCP 4401，插件静态服务 4400，WebSocket 4402；设计操作由浏览器插件执行 | 不是无需打开 Penpot 的离线设计文件 CLI；插件窗口需保持打开 |
| MCP 支持动作 | 实测工具列表：`execute_code`、`high_level_overview`、`penpot_api_info`、`export_shape`、`import_image` | 可以通过插件 API 查询、新建、增量修改、导出形状；必须约束写入范围 |
| 可视化编辑 | Penpot 本身已有图层、自由定位、变换、组件、布局、共享库、撤销、文本和矢量绘制 | 自建方案不应以“Penpot 缺少编辑器功能”为理由 |
| 稳定身份 | `Shape.id` getter 返回文档 shape UUID；存在 `setPluginData` / `setSharedPluginData` | 移动/改样式保留原对象 ID；复制、删除重建、跨文件导入不能假定还是同一 ID，需额外逻辑 ID 和冲突处理 |
| 评论 API | 2.15.4 源码有 `Page.addCommentThread`、`findCommentThreads`、线程回复、`resolved`；要求 `comment:read` / `comment:write` | 可以开发插件，不能声称没有官方评论接口 |
| 原生评论语义 | `addCommentThread(content, position, board)`，原生状态是 resolved boolean，线程定位用页面/board坐标 | 任意按钮 ID 的语义锚点、禁止修改属性、优先级和四阶段状态需自定义数据模型；不能假定移动任意按钮时原生位置评论自动跟随 |
| 元数据 | shape/page/file 相关插件存储接口，支持命名空间共享数据；写入需权限 | 适合保存逻辑 ID、Godot 类型、评论索引、布局语义；完整历史宜旁车 JSON 保存 |
| 导出 | 插件支持图形导出，官方 MCP 有 `export_shape` | 没有核实到官方 Godot 4 原生导出；不能把 PNG/SVG 等同于可编辑 Godot 控件 |
| Windows | 官方 MCP 源码说明 Windows 使用 Git Bash；Penpot 服务可使用 Docker Desktop 的 Linux 容器 | 需要 WSL2/虚拟化、Docker和Node；不是独立 Windows 原生 EXE |

来源均可直接复核：

1. [Penpot 2.15.4 MCP README](https://github.com/penpot/penpot/blob/2.15.4/mcp/README.md)
2. [旧官方 MCP 归档说明](https://github.com/penpot/penpot-mcp#readme)
3. [官方 2.15.4 Docker Compose](https://github.com/penpot/penpot/blob/2.15.4/docker/images/docker-compose.yaml)
4. [官方 Docker 安装文档源码](https://github.com/penpot/penpot/blob/2.15.4/docs/technical-guide/getting-started/docker.md)
5. [Page 插件接口](https://github.com/penpot/penpot/blob/2.15.4/frontend/src/app/plugins/page.cljs)
6. [Shape 插件接口](https://github.com/penpot/penpot/blob/2.15.4/frontend/src/app/plugins/shape.cljs)
7. [Comment 插件接口](https://github.com/penpot/penpot/blob/2.15.4/frontend/src/app/plugins/comments.cljs)
8. [官方离线配置和启动实现](https://github.com/penpot/penpot/blob/2.15.4/docker/images/files/nginx-entrypoint.sh)

本环境访问 `help.penpot.app` 遇到网络代理 403，因此使用同一官方仓库内的文档源码及实现核对，未将访问失败解释为产品能力不足。

## 本轮实际验证和失败诊断

结果文件：[`research/penpot/latest-probe.json`](../research/penpot/latest-probe.json)、[`mcp-probe-result.json`](../research/penpot/mcp-probe-result.json)。可复测脚本：[`probe.mjs`](../research/penpot/probe.mjs)。

| 检查 | 结果 |
| --- | --- |
| Docker Engine / Compose | 28.4.0 / 2.40.3，可实际使用 |
| 官方 2.15.4 镜像拉取 | 成功；frontend/backend/exporter/mcp + PostgreSQL 15 + Valkey 8.1 + Mailcatcher |
| Penpot 前端请求 | `GET /` → 200，返回应用 HTML（约 258 KB） |
| 数据库就绪 | `GET /readyz` → 200，正文 `OK`；官方 handler 会执行数据库查询 |
| 后端 RPC | `GET /api/rpc/command/get-profile` → 200，返回 Anonymous User |
| MCP 冻结锁安装 | 官方 tag 2.15.4，pnpm 10.31.0，`install --frozen-lockfile` 成功 |
| MCP 构建 | TypeScript/服务端 bundle/插件构建均成功 |
| MCP 协议 | `initialize` → 200，协商 `2025-03-26`；`tools/list` 五个工具；overview 调用返回内容 |
| 插件服务 | `/manifest.json` → 200 |
| 真实 Penpot 文件通过插件被修改 | **未运行**；本轮不宣称完成这一项 |
| Windows Docker Desktop 和浏览器端到端 | **未运行**；提供复现方式，留作目标机验收 |

发现并处理的问题：

- 原始 Docker 前端启动因容器无法解析外部模板站点 `raw.githubusercontent.com` 而不断重启。采用官方 `enable-air-gapped-conf` 开关后启动成功；该开关关闭 Google Fonts 与外部模板区，对完全本地目标合适。没有关闭 TLS 校验或改写证书信任。
- `docker compose up --wait` 一度成功，但随后前端重启。这证明容器存活并不足以验收，最后以 HTTP、RPC 和数据库 readiness 为准。
- `GET /api/health` 不是本版本健康端点，返回 404；源码定位正确端点是 `/readyz`，后者已通过。
- npm 发布包 `@penpot/mcp@2.15.4` 的便捷启动在本机因 pnpm 版本选择及不可写用户缓存失败。切换到官方相同 tag 源码、该 tag 固定的 pnpm 10.31.0、可写临时缓存，冻结锁安装及构建成功。源码包内版本标为 `2.15.0`，不能把该字符串误认为实际检出错版本；Git tag 和 SHA 已核对。pnpm 提示忽略依赖的安装脚本，随后真实构建正常；未禁用任何包完整性或 TLS 校验。

## Penpot 适配器设计：可行，但本期没有伪装成已经实现

建议以后增加一个 Penpot 插件和一个只监听回环地址的本地桥接服务：

1. 插件读取选中对象，持久保存 `gameUi.componentId`、`godotType`、`layoutMode`、`assetRefs` 等命名空间元数据。
2. 评论真源是 sidecar JSON：`commentId + componentId + expected + protectedProperties + priority + status`。Penpot 线程只做可见入口，关联 thread UUID；不能只保存坐标。
3. 反馈包只导出待处理条目、被引用的设计规范、选中局部图和必要父级上下文。插件 API 导出选区图像，本地桥接保存文件。
4. 导入 patch 前校验项目版本/组件 ID/字段白名单/禁止字段；在一个撤销块内执行，只更新白名单属性。
5. 重新从 Penpot 读取真实应用后的值，生成结构化 diff 和局部截图；历史保存在本地文件，不把浏览器内存作为唯一备份。
6. Godot 适配器只处理已声明类型；未支持的路径、蒙版、复杂文本和组件变体应给出诊断，不能静默栅格化成“所有功能已导出”。

官方 MCP 可以替代部分桥接交互，但它不会自动提供反馈预算、受保护字段、事务回退或 Godot 节点语义。第一期文件交换不需要启动 MCP，更不需要付费模型 API。MCP 验证仅证明以后接入路径真实存在。

## 许可证与分发成本

| 能力 | 许可证与维护影响 |
| --- | --- |
| Penpot | 官方根 LICENSE 为 **MPL-2.0**。允许本地使用、商业使用与修改；分发修改后的被覆盖文件时，需履行文件级源码提供和通知义务。独立插件/桥接的独立文件不会仅因连接 Penpot 就自动变成 MPL。具体分发组合需按实际依赖核查。 |
| Penpot MCP | 根仓库的 MPL-2.0 适用范围需保留；部分子包 `package.json` 标 MIT，不能据此宣称整个分发物全为 MIT。此仓库的研究配置复制官方 Compose，同时附完整官方许可与来源。 |
| React / Konva / react-konva | 官方仓库和 npm 元数据为 **MIT**；分发时保留版权与许可证。Konva 提供 Canvas 场景图、Transformer、事件及拖动能力，不是现成编辑器。 |
| Docker Desktop | 与 Penpot 开源许可无关，Docker Desktop 自身有使用条款；独立个人/小团队通常符合免费条件，应按使用主体核对。也可在自备 Linux/WSL2 Docker Engine 环境运行。 |
| 字体与游戏资源 | 需分别登记来源和许可；开源编辑器许可不覆盖用户导入贴图、字体或商业游戏素材。 |

官方许可：[Penpot](https://github.com/penpot/penpot/blob/2.15.4/LICENSE)、[React](https://github.com/facebook/react/blob/main/LICENSE)、[Konva](https://github.com/konvajs/konva/blob/master/LICENSE)、[react-konva](https://github.com/konvajs/react-konva/blob/master/LICENSE)。

## 能力和维护成本对照

| 维度 | Penpot + 插件/本地桥接 | React + Konva 受限编辑器 |
| --- | --- | --- |
| 成熟的设计编辑能力 | 直接复用，优势明显 | 必须实现选择、属性、历史、吸附、分组、键盘行为并持续测试 |
| 稳定评论/约束/验收状态 | 自定义业务模型 + Penpot UUID 映射 | 直接纳入项目模型，改动路径短 |
| 本地文件是设计真源 | 需 export/sidecar/同步策略，Penpot服务有数据库 | 原生 JSON，适合 diff、备份、Git和增量patch |
| 免费离线使用 | 初装下载后可自托管；维护 7 服务、数据库和资产卷 | 初装 Node 依赖后可本地运行；本期不依赖AI云API |
| Godot类型约束 | 需要将视觉对象映射为受限游戏组件 | 数据模型从开始就限制类型与布局语义 |
| 高级排版和专业矢量 | 成熟工具更合适 | 不纳入一期；不要无界扩展 |
| 升级成本 | Penpot版本、插件API、数据库迁移、MCP匹配、备份恢复 | React/Konva版本兼容、序列化迁移、交互和渲染测试 |
| 一期主要风险 | 时间花在运行栈与双数据源同步，业务约束仍需开发 | 演变成半成品通用编辑器；必须严格限制类型和单页样本 |

工程时间只是计划估算，不是本轮性能数据：一名熟悉相关栈的开发者，Penpot业务插件和文件桥接到稳健验证版本约 **2–4 人周**；受限 React/Konva 编辑器约 **3–6 人周**，复杂矢量/字体/大文档应另立项目。本轮最小实验只用于发现问题和验证闭环，不能据此声称拥有生产级编辑器。

## 本期验收边界

功能验收、导出运行验收和美术验收分开记录。角色详情页的组件拖动、属性编辑、稳定 ID 评论、增量 patch 和差异、基础 Godot 场景运行构成首期闭环。美术要求应另外检查构图、层级、图文对比、字体、纹理、按钮状态、九宫格边缘和目标分辨率，不以“能导出截图”判定设计质量合格。
