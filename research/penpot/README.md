# Penpot 本地可行性实验

本目录保存官方 Penpot 2.15.4 本地部署研究，不是 Game UI Studio 主程序的必需依赖。详细结论见 `docs/TECHNICAL-DECISION.md`。

## 文件与来源

- `compose.official.yaml`：从官方 `2.15.4/docker/images/docker-compose.yaml` 原样下载的参考配置。
- `compose.local.yaml`：上述文件的本地派生版。Penpot镜像固定2.15.4，发布端口只绑定127.0.0.1，关闭遥测，使用官方 air-gapped 配置，服务器key从不入库的 `.env` 读取。Postgres/Valkey/Mailcatcher仍按官方基础镜像标签；本次实际镜像摘要另存 `docker-images.json`。
- `LICENSE.penpot.txt`：Penpot MPL-2.0 原文，覆盖复制的官方配置。上游：https://github.com/penpot/penpot/tree/2.15.4
- `prepare.mjs`：生成本机key，已有文件保持原样；不输出key。
- `probe.mjs`：检查真实 HTTP / 数据库 readiness / MCP握手，可重复运行。
- `latest-probe.json`、`mcp-probe-result.json`：本轮真实结果，不是模拟响应。

## Windows 启动 Penpot

前提：安装 Git、Node.js 22 LTS 或兼容版本、Docker Desktop（Linux containers / WSL2 backend），启动Docker。以下命令在项目根目录运行，PowerShell 或 Git Bash 均可执行：

```text
node research/penpot/prepare.mjs
docker compose -p game-ui-penpot-eval -f research/penpot/compose.local.yaml up -d --wait --wait-timeout 180
node research/penpot/probe.mjs
```

浏览器手动打开 `http://127.0.0.1:9001`。本地注册一个实验账户；不需要云账户或付费API。服务运行期间数据写入本项目名的Docker资产卷与数据库卷。第一次拉取需要网络；镜像和本地资源准备后可离线使用。关闭外部字体/模板后，应导入有许可的本地字体和资源。

如Docker已启动而探测暂时失败，先检查日志，等待后端数据库迁移完成后再探测：

```text
docker compose -p game-ui-penpot-eval -f research/penpot/compose.local.yaml logs --tail 80
```

停止实验（保留卷和设计数据）：

```text
docker compose -p game-ui-penpot-eval -f research/penpot/compose.local.yaml down
```

不要在希望保留设计数据时加 `--volumes`。`compose.official.yaml` 是原始参考，启动时请选择 `compose.local.yaml`。

## 官方本地 MCP：可重复的源码路线

官方推荐的快速路线是 `npx -y @penpot/mcp@2.15.4`，但本次 npm 发布包启动受包管理器版本影响失败，所以以下给出本轮成功的固定源码与pnpm路线。Windows 按官方说明使用 Git Bash。源代码克隆位于研究目录且被Git忽略：

```text
git clone --depth 1 --branch 2.15.4 --filter=blob:none --sparse https://github.com/penpot/penpot.git research/penpot/source
git -C research/penpot/source sparse-checkout set mcp
cd research/penpot/source
npm exec --yes --package=pnpm@10.31.0 -- pnpm --dir mcp install --frozen-lockfile
npm exec --yes --package=pnpm@10.31.0 -- pnpm --dir mcp run build
npm exec --yes --package=pnpm@10.31.0 -- pnpm --dir mcp run start
```

保持终端运行。若位于受限云沙箱，可以将 `COREPACK_HOME`、`XDG_DATA_HOME`、`XDG_CACHE_HOME`、`npm_config_cache` 指到自己可写的缓存目录；Windows正常用户配置通常不需要该步骤。不要为解决网络问题关闭证书或包校验。

然后在另一终端，从 Game UI Studio 项目根目录执行：

```text
node research/penpot/probe.mjs --mcp
```

该探测会验证 MCP `initialize`、`tools/list`、overview 工具、插件 manifest。它**不会**冒充实际设计修改。

实际连接设计文件仍需人工完成：

1. 在自托管 Penpot 中打开一个设计文件。
2. 在 Plugins 中加载 `http://localhost:4400/manifest.json`。
3. 打开插件，选择 Connect to MCP server，保持插件窗口与浏览器标签活跃。
4. 支持 Streamable HTTP 的客户端连接 `http://localhost:4401/mcp`。
5. 先读取 API 信息，再针对明确组件 ID 执行可回退的少量属性更新；不要放开全文件重建权限。

本轮测试没有执行第1–5步的设计文件端到端修改。此边界也记录在探测JSON。前端/数据库 readiness 和 MCP协议成功，不能替代这一步。

## 本轮已解决的部署问题

官方原始Compose在此隔离网络中，前端Nginx因解析外部模板域名失败而重启。通过官方 `enable-air-gapped-conf` 解决，无需手动改镜像。正确健康端点为 `/readyz`，不是 `/api/health`。启动后必须运行本目录探测，不只看容器PID或 `up --wait`。
