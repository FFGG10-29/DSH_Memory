# dsh-memory-gateway — DSH 统一记忆网关

把 **DeepSeek Harness（DSH）变成所有外部 AI 工具的「中央记忆调度中心」** 的 Host 插件。

外部工具（CodeBuddy、WorkBuddy、Cursor、Claude Code、VS Code …）通过 **HTTP** 或 **MCP（stdio）** 写入和检索记忆；存储、去重、**智能分类路由**全部交给 DSH 自己的记忆引擎（`dsh-mnemon`）。网关只做 **接入 + 鉴权 + 上下文桥接**，不重复实现记忆路由。

> 一句话：现有方案解决「能不能共享」，本插件解决「**存得对不对、读得准不准**」。

![架构图](./docs/architecture.svg)

---

## 一、两个关键纠正（决定了插件能否真正跑起来）

### 1. `mnemon_*` 工具需要一个「活的 DSH agent」

最初的方案是在 HTTP handler 里裸调 `ctx.tools.execute({ name: 'mnemon_remember' })`。**这条路走不通。** `mnemon_remember` 和 `mnemon_recall` 内部都会调 `requireAgent(exec)`，没有 ambient session 时直接抛：

```
Mnemon semantic operations require a live DSH agent
```

所以网关必须**借一个活的 agent 上下文**：用 `ctx.agents.create({ ... })` 造一个 agent，再用 `ctx.agents.withInitiator(agent, ...)` 把工具调用包在它的身份里。

### 2. 智能路由需要**顶层 agent**，不能是 subagent

`mnemon_remember` 的 execute 按 `isSubagent(exec.agent)` 分叉：

```ts
return isSubagent(exec.agent)
  ? sourceAction(exec, "memory-spaces", "remember", request)        // 裸写，跳过分类
  : coordinator.remember(requireAgent(exec), request, exec.signal); // 智能路由
```

而 `isSubagent` 的判断是 `agent?.session?.header?.origin === "subagent"`。

**结论**：如果网关借的是 subagent，写入会跳过分类、直接落原始字符串；必须借**顶层 agent**（不设 `origin: 'subagent'`），才会命中 mnemon 的 Coordinator，做蒸馏 → 分类 → 挑正确的 Memory Space。这是让插件「精准命中」而非「垃圾堆」的关键。

---

## 二、已实现能力（当前版本 0.4.2）

- ✅ **HTTP 入口**：绑定 `127.0.0.1`（`port`，默认 `8890`），同时镜像到 DSH 自身 web 端口，DSH 内外都可调。
- ✅ **Bearer 鉴权**：首次启动自动生成随机 token，持久化到 `<DSH_HOME>/memory-gateway.state.json`；除 `/api/health` 与 `/api/config` 外全部需要 `Authorization: Bearer <token>`。
- ✅ **智能写入**：借顶层 agent 让 `mnemon_remember` 走 Coordinator（蒸馏 + 分类 + 去重 + 落到最合适的 Memory Space）。
- ✅ **全域智能检索**：借一个顶层 DSH agent 在真实 turn 内调用 `mnemon_recall`，由记忆引擎统一路由到**全部已安装的 Provider**（本地 mnemon + Hindsight + Mem0 + Honcho …），无需为每个 Provider 单独写适配器。
- ✅ **MCP stdio 代理**：`lib/mcp-server.js` 是薄代理，外部 MCP 客户端 spawn 它即可；token 与端口自动从环境变量或 state 文件发现。
- ✅ **插件设置卡片**：DSH 插件页内可实时查看状态、复制 token、开关「允许外部工具删除记忆」、改默认空间，保存后**立即生效、免重启**。
- ✅ **删除门禁**：默认只有拥有者 `adminToken` 能删；打开开关后共享 Bearer token 也可删。MCP 侧还额外要求 `confirm: true`。

---

## 三、目录结构

```
dsh-memory-gateway/
├── package.json          # dsh.bundle.patch + type:module + main:lib/index.js
├── cordis.patch.yml      # 最小 Loader insert
├── tsconfig.json
├── client.js             # 插件页卡片（浏览器端）
├── src/index.ts          # 网关主体（HTTP + DSH web 路由 + agent 桥接）
├── src/mcp-server.ts     # MCP stdio 代理源码
├── lib/index.js          # 编译产物（DSH 实际加载）
├── lib/mcp-server.js     # 编译产物（MCP 代理）
├── lib/client.js         # 与根目录 client.js 内容一致（两份独立文件，改一处要同步另一处）
├── lib/admin.html        # /api/admin 管理页
├── docs/EXTERNAL-SETUP.md  # 给外部工具的中文接入指南
├── docs/architecture.svg   # 架构图
├── tests/                # 自测脚本
└── LICENSE               # MIT
```

---

## 四、安装

### 从市场安装

上架包把 `package.json` 与 `lib/` **直接放在 ZIP 根目录**（不要多套一层文件夹）。依赖 `@deepseek-ai/schemastery` 由 DSH profile 的 `node_modules` 提供，声明但不随包携带。

### 本地开发安装

```bash
# 1. 编译
./node_modules/.bin/tsc -p tsconfig.json

# 2. 装进 profile，并在 profile 的 cordis.patch.yml 里加：
#      - insert:
#          - id: dsh-memory-gateway
#            name: dsh-memory-gateway
```

重载（必须 POST）：

```bash
curl -X POST "http://127.0.0.1:<DSH_WEB_PORT>/dsh-unlag/reload?requestId=<任意id>" \
  -H "x-dsh-unlag: 1"
```

---

## 五、配置项（`Config`）

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `port` | `8890` | 本地 HTTP 端口（绑定 `127.0.0.1`） |
| `token` | `""` | Bearer token；留空则自动生成并持久化到 `tokenFile` |
| `tokenFile` | `""` | 状态文件；默认 `<DSH_HOME>/memory-gateway.state.json` |
| `defaultSpace` | `default` | 调用方未指定空间时的兜底目标 |
| `asyncWrite` | `true` | `/api/remember` 返回 `202 accepted` 后后台写入 |
| `adminToken` | `""` | 拥有者专属密钥；外部删除关闭时 `/api/forget` 必须它 |
| `allowExternalDelete` | `false` | 关 ⇒ 只有 `adminToken` 能删；开 ⇒ 共享 Bearer token 也能删 |

> 从 v0.4.2 起，召回改由 DSH 的记忆引擎（`mnemon_recall`）统一路由到全部已安装的 Provider，
> 不再需要为 Hindsight / Ollama 等单独配置端点——装好对应 Provider 即自动生效。

**配置优先级**：插件页设置 > 插件 Config（`cordis.yml`）> 默认值。插件页保存的值落在 `memory-gateway.config.json`（与 token 状态文件同目录），重启后仍在。

---

## 六、插件页

插件页上共有 **两个入口**都能看到「记忆网关」这张卡片：

- **插件 → dsh-memory-gateway 详情页**（卡片在包详情里）
- **设置 → 左侧导航「记忆网关」**

卡片是**实时设置面板**，不只是状态展示：

- **允许外部工具删除记忆** 开关 — 开 ⇒ 任何持有共享 Bearer token 的外部工具都能调 `/api/forget`；关 ⇒ 只有拥有者 `adminToken` 能。打开后 `adminToken` 依然有效，拥有者不会把自己锁在外面。
- **拥有者助记令牌 / adminToken**、**默认记忆空间** — 都可在卡片里直接改。
- **保存设置** 通过 `POST /api/config` 生效，**无需重启 DSH**。

---

## 七、HTTP API

除 `/api/health` 与 `/api/config` 外，全部需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 请求体 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | 公开；版本、token 前缀、生效中的设置 |
| GET | `/api/config` | — | 公开；脱敏后的生效设置（不含密钥） |
| POST | `/api/config` | `{ confirm: true, allowExternalDelete?, adminToken?, defaultSpace? }` | 保存并立即生效；`confirm` 必填 |
| POST | `/api/remember` | `{ content, source?, hintSpace?, category?, importance?, tags?, entities? }` | 由 mnemon Coordinator 智能路由 |
| POST | `/api/write-direct` | `{ content, hintSpace, source? }` | 直接写指定空间，不做路由 |
| POST | `/api/recall` | `{ query, space?, limit?, mode? }` | 不传 `space` ⇒ 搜遍磁盘上每个空间并合并排序；返回扁平信封 `{ query, mode, searchedSpaces, results[] }` |
| GET | `/api/spaces` | — | 列出所有 Memory Space |
| POST | `/api/forget` | `{ id, memoryBodyId? }` | **破坏性**，软删除单条；门禁见上 |

**没有批量删除**：一次调用只删一个 id，MCP 侧还额外要求 `confirm: true`。

示例：

```bash
TOKEN=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('C:/Users/13966/.dsh/profiles/desktop/memory-gateway.state.json','utf8')).token)")
curl -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"content":"用户偏好使用 pnpm","source":"cursor"}' \
  http://127.0.0.1:8890/api/remember
```

> 中文请求体注意编码：Windows 下用 `--data-binary @file.json`（文件存 UTF-8），直接命令行 `-d '中文'` 可能被转成 GBK 导致乱码。

---

## 八、MCP（stdio）— 接 Cursor / Claude Code / VS Code / CodeBuddy / WorkBuddy

MCP server（`lib/mcp-server.js`）是 **stdio 代理**，不是进程内服务。把它加到客户端的 MCP 配置里，指向网关即可（token 与端口自动从 `<DSH_HOME>/memory-gateway.state.json` 发现，也可用环境变量 `DSMG_TOKEN` / `DSMG_PORT` / `DSMG_HOST` / `DSMG_STATE` 覆盖）：

```json
{
  "mcpServers": {
    "dsh-memory": {
      "command": "node",
      "args": ["D:/DeepSeekHarness/dsh-memory-gateway/lib/mcp-server.js"],
      "env": {
        "DSMG_TOKEN": "<你的 token>",
        "DSMG_PORT": "8890",
        "DSMG_HOST": "127.0.0.1"
      }
    }
  }
}
```

MCP 暴露 5 个工具：`memory_remember`、`memory_recall`、`memory_write_direct`、`memory_spaces`、`memory_forget`，与上面的 HTTP 端点一一对应。

`memory_forget` 是唯一的破坏性工具：需要 `{ id, confirm: true }`，只删一条，优先用共享 token（插件页开关打开时可用），否则回退到 `adminToken`。它的 `space` 参数一般不用填——留空会自动扫遍所有空间；响应会告诉你实际落在哪个空间，或在你给的 id 哪儿都找不到时返回 `searchedSpaces` 供核对。

stdio 传输在同一管道上同时支持两种分帧：官方 `Content-Length: N\r\n\r\n{json}`（WorkBuddy / VS Code）和裸换行分隔 JSON（MCP 规范，Claude Code / Codex），并且**用哪种格式收到的就用哪种格式回**，两边都不会卡住。

不装 MCP 宿主也能验证：

```bash
node tests/mcp-cli.mjs list                 # 五个工具
node tests/mcp-cli.mjs recall "某段记忆"
node tests/mcp-cli.mjs remember "一条长期事实"
node tests/mcp-cli.mjs forget <完整uuid>     # 会自动带 confirm:true
```

回归自测（全部无需 DSH 在跑，纯本地 fake ctx）：

```bash
node tests/e2e-mock.mjs          # HTTP 端点 + 鉴权 + 202 异步语义
node tests/e2e-mock-phase2.mjs   # 借顶层 agent 走 mnemon 智能路由
node tests/mcp-e2e.mjs           # MCP 五工具 schema + 分帧
node tests/run-client.mjs        # 客户端两处 slot 注册
node tests/spaces-check.mjs      # /api/spaces 不依赖 pinned View
node tests/recall-shape.mjs      # /api/recall 返回扁平信封（防回归）
node tests/forget-check.mjs      # forget 404 + searchedSpaces（需网关在线）
```

---

## 九、实测记录（2026-11-03）

- **MCP 写入**：`node tests/mcp-cli.mjs remember "接入实证…"` → `{"status":"accepted"}`；约 25 秒后 recall 验证，内容已被蒸馏归类为 `fact` 并落到具体空间，证明 stdio 写入链路可用。
- **HTTP 写入 + 召回**：`POST /api/remember` → `{"status":"accepted"}`；`POST /api/recall` 返回带分数与 `searchedSpaces`（6 个空间）的结果。
- **插件页**：DSH 插件页与「设置 → 记忆网关」两个入口均能渲染完整表单；点「保存设置」后 `memory-gateway.config.json` 落盘、`/api/health` 立即反映新值。
- **删除门禁**：外部 token 删除 → 401；正确 `adminToken` 删真实 id → 成功并返回所属空间（实测 `space=3d0a3580…`）；重复删 / 伪造 id → 404 且附 `searchedSpaces`。
- **全域召回（v0.4.2）**：`POST /api/recall` 借顶层 DSH agent 在真实 turn 内调用 `mnemon_recall`，`searchedSpaces` 覆盖全部已安装 Provider 的空间（含远端 bank），无需为每个 Provider 单独配端点。此路径当前仍在联调中。

---

## 十、路线图

- ✅ **Phase 1**：HTTP 入口 + token 鉴权 + agent 上下文借用（可编译）。
- ✅ **Phase 2**：顶层 agent 智能路由 + MCP stdio 代理。
- ✅ **Phase 3**：插件页卡片 —— 实时状态 + 可编辑设置 + 「允许外部工具删除」开关（`GET/POST /api/config`，免重启生效）。
- ✅ **Phase 4**：多客户端接入实证（CodeBuddy / WorkBuddy 的 MCP 配置已就位并跑通）。
- ⏳ **Phase 5**：MCP SSE 传输（目前仅 stdio）+ 市场演示 GIF。

---

## 十一、现场验收（在真实 DSH 上做一次）

1. 加载插件（控制台会打印 `✅ 统一记忆网关已启动`）。
2. `curl` 一条**主题明确、可分类**的内容（比如「某项目 + 技术栈」的一句话）。
3. 到 DSH 记忆界面（或 `D:\memory\data\default\mnemon.db`）确认：这条记忆被**蒸馏后放进了项目/代码类空间**，而不是原始字符串直存。

**成功 = Coordinator 跑了；失败（原始直存）= 借到的是 subagent**，回头检查传给 `ctx.agents.create` 的 `meta`。

---

## 十二、踩坑备忘（给后续维护者）

- `@deepseek-ai/schemastery` 是**默认导出**，且**没有 `z.infer`**，类型要手写接口。
- `ctx.effect` 是「工厂返回 disposer」：`ctx.effect(() => () => server.close())`。
- 工具调用字段名是 **`arguments`** 不是 `input`，且**必须传 `signal: AbortSignal`**，否则报 `Cannot read properties of undefined (reading 'aborted')`。
- `mnemon_recall` 硬编码 `requirePinnedView: true`，`ctx.agents.withInitiator` 伪造不出 pinned turn，会抛 `Recall requires the View pinned to the current turn`。v0.4.2 起靠 `agent.followup()` 唤醒一个**真实 turn** 让 agent 自己调 `mnemon_recall`，事后从 `session.surface.nodes` 截取 `tool/result`（这是不耦合私有 RPC、又能覆盖全部 Provider 的公开路径）。
- 借来的 agent 没有 pinned view，全局召回必须显式传全部 `memoryBodyIds`，否则空 pin 搜不到内容。
- 删除（`mnemon_forget`）走 `coordinator.write`，不需要 pinned turn，零 token 消耗；失败时回退原生 mnemon CLI。
- ESM 插件里不能用 `require`，要 `await import()`；Windows 下 `execFileSync` 不搜 PATH，需全路径，`.cmd` 要加 `shell: true`。
- 插件页卡片注册必须走 `ctx.slots.inject(slotName, () => ctx.slots.register(...))`；直接 `register()` 在槽未被声明时会抛，若外层套 try/catch 就会被静默吞掉，表现为「卡片永远不出现」。

---

## 许可证

MIT，见 [LICENSE](./LICENSE)。
