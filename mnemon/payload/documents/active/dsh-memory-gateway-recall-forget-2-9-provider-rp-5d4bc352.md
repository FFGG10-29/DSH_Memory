---
id: "5d4bc352-0c3b-4f53-9fd7-e143ef955cbe"
title: "dsh-memory-gateway：recall/forget 仅覆盖 2/9 Provider 的缺口与通用路径（RPC search / 公开工具）调查"
description: "未落地的方向调查：recall/forget 当前只覆盖 Mnemon Native+Hindsight，7 个远端 Provider 读不到删不了；发现 DSH 通用 memory-spaces search 路径及公开工具 vs RPC 直连的取舍与用户\"勿绑私有字段\"约束。"
status: "active"
created_at: "2026-11-03T07:34:35.803Z"
updated_at: "2026-11-03T07:34:35.803Z"
content_hash: "f3b76261ab39bdefadf1df30604f959ce973c9e8df06d7c713d2e7019512ee9e"
source_paths:
  - "dsh-memory-gateway/src/index.ts"
  - "DSH mnemon connection service (lib/types/rpc-host.js, rpc.js, peer.js)"
session_ids:
  - "14ede9e8-3429-400a-b25b-c002cff59e47"
memory_body_ids:
  []
---

适用环境：Windows 桌面，项目 `D:\DeepSeekHarness\dsh-memory-gateway`，网关 `127.0.0.1:8890`。本 checkpoint（b7–b38 压缩块指纹 + 9620–9688 工具结果）是一次**未落地的方向调查**，结论待用户确认，尚未改码。

> 关联文档：`a3952ed4`（原生 CLI recall 已实证，但仅覆盖本地 Mnemon Native store）、`a81084df`（外部 HTTP+MCP 集成契约）、`3d1617fe`（智能路由/写链路）、`4ea0d902`（Host 插件 API 契约，含 mnemon 工具需活 agent 上下文）、`85bf0603`（data-dir 对齐）。

## 1. 当前覆盖缺口（核心发现）

- **写入 `/api/remember`**：借顶层 agent → `mnemon_remember` 公开工具 → `coordinator.remember` → 自动路由到目标 Space 的 Provider。**已天然通用，覆盖全部 9 个 Provider**（Mnemon Native / Hindsight / Mem0 / Honcho / ByteRover / Supermemory / OpenViking / RetainDB / Holographic），无需改。
- **读取 `/api/recall`**：原生 `mnemon` CLI（只扫本地 `mnemon.db`）+ 单独硬编码 Hindsight HTTP 特例。→ **只覆盖 Mnemon Native + Hindsight**。
- **删除 `/api/forget`**：原生 `mnemon` CLI。→ 同上。

即 7 个基本都是远端 API Provider 的记忆「写入能存、但网关读不到也删不了」。这就是用户感知的「只有前两个接口」。注意：这与 `a3952ed4` 不矛盾——CLI recall 对**本地库**实证可用，但**不实现跨 Provider 通用**，与网关「全 9 Provider 通用」目标相悖。

## 2. DSH 已有的通用内存层路径

DSH 浏览器 UI 的跨 Provider 检索走 RPC 通道 `/dsh-mnemon-read` 的 `search` 端点，内部是：

```
runtime.source("memory-spaces").read("search", payload, signal)
```

特性（来自 checkpoint 源码摘录 `rpc-host.js`/`rpc.js`/`peer.js`）：
- 不经过 `mnemon_recall` 工具的 `requirePinnedView:true` 门禁；不需要 agent、不调 LLM。
- 自动路由到**所有已启用 Provider**；write 通道 `/dsh-mnemon-write` 同理（`remember`/`forget`/`provider-service-update`）。
- 若走此路径，7 个远端 Provider 自动全覆盖，Hindsight 硬编码特例可一并删掉。

## 3. 实现风险点与用户约束

- **风险**：网关与 mnemon 同 host 进程；上述通道注册在 `connection` 服务（带 web 鉴权）。进程内绕过鉴权拿 handler 需访问私有字段 `connection.interceptors`（checkpoint `rpc-host.js` 见 `interceptors = new Map()` 及 `registerInterceptor`/`createSharedFetchHandler` 经 `this.interceptors.get(channel)`）。属**访问未公开 API、与 mnemon 实现细节硬绑定**，对上市插件脆。
- **用户约束（m00004 自定义回复 + 9688 澄清）**：
  - 「不装 mnemon 还能用吗？不能和别的插件绑定」——用户明确反对硬绑 mnemon 内部。
  - 结论（产品定义，非实现缺陷）：DSH 记忆层本身就是 mnemon，网关本质是「外部工具 ↔ DSH 记忆层」桥，**记忆层没了桥就没意义**；但网关只应依赖 mnemon 的**公开工具接口**（`mnemon_remember`/`mnemon_recall`/`mnemon_forget`/`mnemon_memory_bodies` 这些 DSH 工具），**而非其内部 RPC 通道/私有字段**。公开工具是稳定契约，私有字段不是。

## 4. 重新审视后的干净方案（待用户认可，未实现）

- 写入：保持现状（已通用）。
- 读取/删除：改用 `ctx.tools.execute('mnemon_recall' / 'mnemon_forget', …)` 调**公开工具**，而非本地 CLI。
- 唯一卡点：`mnemon_recall` 工具硬编 `requirePinnedView:true`（「必须 pinned turn」），借来的 agent 无真实 turn，故此前退化成 CLI。
- **解法**：让借来的 agent **真正跑一轮 turn** 来 pin 住视图，再在该 turn 内调 recall → 走 `coordinator.recall` → `runtime.source("memory-spaces").read("search")`，**自动覆盖全部已启用 Provider，连 Hindsight 特例都能删掉**。
- 代价：每次 recall/forget 借 agent 跑一轮会烧一次 LLM、延迟数百毫秒到数秒。但这是**只用公开 API、与 mnemon 实现零耦合**的唯一路径，稳健、可上架。
- 取舍：默认「公开工具 + 借 agent 真跑 turn」（无耦合）；「直连 RPC」仅作为**可关闭的进阶高性能模式**（需明确标注依赖私有字段）。

## 5. 给下一步 agent 的提示

1. 先确认 `mnemon_recall`/`mnemon_forget` 公开工具的精确入参与 `requirePinnedView` 行为（实现时实证，checkpoint 仅调查推断）。
2. 「借 agent 跑真 turn」的 pin 机制需实机验证能否稳定触发 `coordinator.recall` 的 universal 路由。
3. 落地后删掉 `src/index.ts` 里 Hindsight 硬编码特例与本地 CLI 依赖（若改走公开工具）。
4. 本调查未改码；`a3952ed4` 的 CLI 路径在「仅本地 Mnemon Native」场景仍有效，但不再作为通用 recall 的推荐方案。
