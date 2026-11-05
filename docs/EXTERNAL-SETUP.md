# DSH 记忆网关 — 外部工具接入指南（WorkBuddy / CodeBuddy）

> 给 WorkBuddy、CodeBuddy 等外部 AI 工具的接入说明。配置好之后，它们写入的记忆会**进入 DSH 同一个记忆库**，并且**由 DSH 自己的记忆引擎做智能分类、路由到正确的 Memory Space**——和你直接在 DSH 里存记忆的行为完全一致。读取时也复用同一套语义检索。

---

## 一、它解决什么问题

本机虽然通过环境变量 `MNEMON_DATA_DIR=D:\memory` 让各工具的 `mnemon` CLI 指向了同一个数据库文件（`D:\memory\data\default\mnemon.db`），但**裸 `mnemon` CLI 直写不经过 DSH 的分类器**，不会智能路由到 Memory Space。

要走「和 DSH 一样分类存储」的能力，**请走本网关**（HTTP API 或 MCP），不要再用裸的 `mnemon remember`。

---

## 二、接入方式（两种都支持，按需选用）

> - **HTTP API**：适合 hook / 脚本在事件触发时自动调用（如 WorkBuddy、CodeBuddy 的 Stop hook）。
> - **MCP**：适合支持 MCP 的客户端（Cursor / Claude Code / VS Code 等）。
>
> 两种方式底层都走同一个 DSH 网关，记忆写入同样经过 DSH 智能分类、检索同样复用同一套语义库，行为完全一致。

### A. HTTP API —— 适合 hook / 脚本在事件触发时自动调用

网关监听 `127.0.0.1:8890`，所有写/读请求都需要在 Header 带 Bearer Token。

**Token 与端口在哪里获取：** 在运行 DSH 的那台机器上有一个状态文件：

```
<DSH_HOME>/profiles/desktop/memory-gateway.state.json
```

内容形如：

```json
{ "token": "<你的 token（首次启动自动生成）>", "port": 8890, "createdAt": "<ISO 时间戳>" }
```

`DSH_HOME` 通常是 `C:\Users\13966\.dsh`。向 DSH 使用者索取这个 `token` 即可。

> 安全要求：网关只监听本机回环地址（127.0.0.1），所以你的工具必须和 DSH **运行在同一台机器**。

#### 1) 写入（智能分类，推荐）

```bash
curl -X POST http://127.0.0.1:8890/api/remember \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "要记住的内容（自包含的一句话记忆）",
    "source": "workbuddy",
    "category": "可选分类",
    "importance": 4,
    "tags": ["可选标签1", "可选标签2"]
  }'
```

字段说明：

| 字段 | 必填 | 说明 |
| :--- | :--- | :--- |
| `content` | ✅ | 记忆正文 |
| `source` | 否 | 调用方工具名，如 `workbuddy` / `codebuddy`，用于溯源 |
| `category` | 否 | 分类提示 |
| `importance` | 否 | 1–5 |
| `tags` | 否 | 字符串数组 |

返回 `202 { "status": "accepted" }`：**写入是异步的**（DSH 分类需要一点时间），立即返回不阻塞你的工具，后台分类完成后自动落库。

#### 2) 检索（智能检索，默认搜全部激活空间）

```bash
curl -X POST http://127.0.0.1:8890/api/recall \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"query": "要回忆什么", "limit": 5}'
```

可选字段：

| 字段 | 说明 |
| :--- | :--- |
| `query` | ✅ 自然语言查询 |
| `limit` | 返回条数，默认 5 |
| `space` | 限定某个 Memory Space（uuid 或名字），不填则搜全部激活空间 |
| `mode` | `smart`（默认）/ `keyword` / `basic` |

> **检索范围（重要）**：`space` 不填时，`/api/recall` 借 DSH agent 调用 `mnemon_recall`，由记忆引擎路由到**全部已安装 Provider 的空间**（含本地 mnemon 库与远端记忆库，如 Hindsight / Mem0 / Honcho …），装好对应 Provider 即自动生效，无需单独配置端点。传了 `space` 则只搜该空间。

响应是**扁平**的一层结构，`results` 直接就是数组：

```json
{
  "query": "要回忆什么",
  "mode": "smart",
  "searchedSpaces": ["3d0a3580-…", "default"],
  "results": [
    { "id": "…", "content": "…", "category": "fact", "space": "3d0a3580-…", "score": 0.54 },
    { "id": "…", "content": "…", "space": "<另一 Provider 的 Space>", "score": 0.42 }
  ]
}
```

`searchedSpaces` 列出实际搜过的空间（覆盖全部已安装 Provider 的 Space），便于核对「是没搜到」还是「压根没搜」。`results` 由记忆引擎（`mnemon_recall`）返回，具体字段随 Provider 而略有不同。

#### 3) 直写指定空间（跳过智能分类）

```bash
curl -X POST http://127.0.0.1:8890/api/write-direct \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"content": "内容", "hintSpace": "<space-id 或 name>", "source": "workbuddy"}'
```

`hintSpace` 为必填，指定目标 Memory Space。

#### 4) 列出空间 / 健康检查

```bash
curl http://127.0.0.1:8890/api/spaces -H "Authorization: Bearer <TOKEN>"   # 需 token
curl http://127.0.0.1:8890/api/health                                       # 公开，无需 token
```

---

### B. MCP 服务器 —— 适合支持 MCP 的客户端（Cursor / Claude Code / VS Code）

网关附带一个 **stdio 模式**的 MCP 服务器 `lib/mcp-server.js`。它由 DSH 主机上的 Node 启动，把 MCP 工具调用转发到上面的 HTTP API（分类、路由等重活都在 DSH 内部完成，MCP 层只是个薄代理）。

**提供连接信息（任选其一）：**

- 显式设置环境变量：`DSMG_TOKEN` + `DSMG_PORT` + `DSMG_HOST`
- 或让它读状态文件：设置 `DSMG_STATE=<DSH_HOME>/profiles/desktop/memory-gateway.state.json`
- 或什么都不设，用默认：host `127.0.0.1`、port `8890`

**MCP 客户端配置示例：**

```json
{
  "mcpServers": {
    "dsh-memory": {
      "command": "node",
      "args": ["<插件目录>/lib/mcp-server.js"],
      "env": {
        "DSMG_TOKEN": "<TOKEN>",
        "DSMG_PORT": "8890",
        "DSMG_HOST": "127.0.0.1"
      }
    }
  }
}
```

启动后可用工具（语义与上面 HTTP 接口一致）：

| 工具 | 说明 |
| :--- | :--- |
| `memory_remember` | 智能分类写入；`content` 必填，`source`/`space`/`category`/`importance`/`tags` 可选 |
| `memory_recall` | 智能检索；`query` 必填，`space`/`limit`/`mode` 可选 |
| `memory_write_direct` | 直写指定空间（跳过分类）；`content` + `space` 必填 |
| `memory_spaces` | 列出所有可用 Memory Space |
| `memory_forget` | 删除一条记忆；`id` 必填，`confirm: true` 必须显式带上，`space` 一般留空（自动扫遍所有空间） |

> **关于「删除」**：默认情况下外部工具**只能写入和检索**，不能删除——删除是 DSH 拥有者专属操作，走独立的 `adminToken`。
> 但拥有者可以在**插件页把「允许外部工具删除记忆」开关打开**，打开后任何持有共享 `token` 的外部工具就能删（MCP 侧还需显式传 `confirm: true`）。开关关闭时，共享 token 调用删除一律 401。
> 即使开关打开，`adminToken` 依然有效，拥有者不会把自己锁在外面。

### 拥有者专属：删除一条记忆（`/api/forget`）

两种鉴权方式，取决于插件页开关：

| 场景 | 用哪个令牌 |
| :--- | :--- |
| 「允许外部工具删除记忆」**关闭**（默认） | 必须 `adminToken` |
| 「允许外部工具删除记忆」**打开** | 共享 `token` 或 `adminToken` 都可以 |

```bash
curl -X POST http://127.0.0.1:8890/api/forget \
  -H "Authorization: Bearer <ADMIN_TOKEN 或 共享 TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"id": "<memory-insight-id>"}'
```

- `adminToken` 在插件配置里设置（也可直接改插件页）；为空则该接口在开关关闭时返回 403（禁用）。
- **不需要传空间 id**：网关会遍历磁盘上每个 Memory Space 逐个尝试，命中即返回实际所在空间；全部未命中才 404，并在 `searchedSpaces` 里列出扫过的空间，方便核对。
- 返回：`200 {"status":"deleted","space":"<实际空间>",...}` 成功软删；`404 {"status":"not_found","searchedSpaces":[...]}` 该 id 哪儿都找不到；`400` 缺少 id；`401` 鉴权失败；`403` 未启用。
- 只会删**一条**，没有批量删除；MCP 侧额外要求 `confirm: true` 防误触。
- 删除是**软删除**（数据保留，仅从检索中排除），与 DSH 原生 `mnemon forget` 语义一致。

---

## 三、接入后的行为对照

| 行为 | 走本网关 | 裸 `mnemon` CLI |
| :--- | :--- | :--- |
| 写入的库 | `D:\memory\data\default\mnemon.db`（同 DSH） | 同一库 |
| 是否智能分类 / 路由到 Memory Space | ✅ 是（DSH Memory Agent 蒸馏） | ❌ 否，直写原生 store |
| 检索范围 | 全部激活空间 / 指定空间 | 取决于 CLI 调用 |

---

## 四、前置条件清单

- [ ] DSH 主机上 `dsh-memory-gateway` 插件已启用并运行（网关在 `127.0.0.1:8890` 监听）。
- [ ] 你的工具与 DSH **运行在同一台机器**（网关仅本机回环，出于安全考虑）。
- [ ] 已从 DSH 使用者处取得状态文件中的 `token`。
- [ ] （仅 MCP 方式）本机有 Node.js 22.19+ 或 24+，且能访问插件目录下的 `lib/mcp-server.js`。

---

## 五、常见问题

**Q：写入后立刻 recall 查不到？**
A：正常。`/api/remember` 返回 202 表示「已接受」，DSH 分类落库是异步的，稍等一两秒再检索即可。

**Q：能不能跨机器访问？**
A：当前版本网关仅监听 `127.0.0.1`，不支持跨机器。如需跨机器，请在 DSH 所在机器上做反向代理并自行承担安全风险。

**Q：`source` 字段填什么？**
A：填你工具的名字即可（`workbuddy` / `codebuddy`），仅用于记忆溯源，不影响分类。
