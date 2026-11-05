---
id: "3d1617fe-96f9-4033-96ab-bf3742bd9d05"
title: "dsh-memory-gateway：mnemon 智能路由内部 + Phase 2 修正 + Phase 1 E2E 状态（核实）"
description: "Verified mnemon smart-routing branch, fabric-API corrections for the proposed Phase 2, local plugin-load mechanism, and Phase 1 mock-E2E status for the dsh-memory-gateway HTTP→mnemon bridge. References existing doc 4ea0d902."
status: "active"
created_at: "2026-11-02T03:16:24.585Z"
updated_at: "2026-11-02T03:16:24.585Z"
content_hash: "202afcef491c0c2488334eaa5eb2d03831cf51c8cabc79e6c23f46afd89e1e24"
source_paths:
  - "dsh-memory-gateway/tests/e2e-mock.mjs"
  - "dsh-memory-gateway/lib/index.js"
  - "dsh-memory-gateway/src/index.ts"
session_ids:
  - "4b37f8ef-81af-4afc-b288-107e953f4af2"
memory_body_ids:
  []
---

# dsh-memory-gateway：mnemon 智能路由内部 + Phase 2 修正 + Phase 1 E2E 状态（核实）

适用环境：Windows 桌面，DSH profile `desktop`。验证来源：`dsh-mnemon` 与 `billion-context` 已编译包、profile `cordis.patch.yml`、本地跑通的 `dsh-memory-gateway/tests/e2e-mock.mjs`。

> 关联文档：`4ea0d902-b7a2-4f45-8f19-ab26c0fceb89`（dsh-memory-gateway 的 Host 插件 API 契约：requireAgent、schemastery 默认导出、ctx.effect 工厂、subagent 直写分支）；`85bf0603-f2d9-4d02-bd11-bcee2aac0ba3`（mnemon 跨工具 data-dir 对齐）。本文只补 `4ea0d902` 未覆盖的核实事实。

## 1. mnemon 智能路由的真实机制（已核实源码）

- `dsh-mnemon/lib/index.js:18744`：`const coordinator = new MnemonSubagentCoordinator(ctx.subagents, runtime, ctx, …)`。
  **mnemon 自己的"让 DSH 决定存哪"就是靠 `ctx.subagents` 起子 agent 做分类的**，不是 `ctx.agents.runTask`。
- `mnemon_remember` 的分支（已核实）：
  ```
  isSubagent(exec.agent) ? 直接写(sourceAction) : coordinator.remember(agent, …)  // 智能路由
  ```
  `isSubagent(exec.agent)` 的判定是 `exec.agent.session.header.origin === 'subagent'`。
- **结论**：subagent origin = 哑写（直写指定 space）；顶层（非 subagent）agent = 智能路由（由 mnemon coordinator 蒸馏 + 选 space）。
- dsh-memory-gateway **不应重写一遍智能路由**——mnemon 已经做了。Phase 2 正确姿势：绑定的 agent 必须是**顶层（非 subagent origin）**，把 content 传进去，等 `coordinator.remember` 选 space。

## 2. Phase 2 代码片段里被核实否决的"凭空 API"（需避免）

| 写法 | 真相（已核实） | 后果 |
| :-- | :-- | :-- |
| `ctx.agents.runTask({prompt, allowedTools})` | **不存在**。`ctx.agents` 只有 `create / createAgent / resume / get / withInitiator / …`（CORDIS INSPECT 全量目录确认），无 `runTask` | `undefined is not a function`，插件崩 |
| `ctx.ui` 返回 ViewModel 渲染卡片 | 真实 UI 注入是 `package.json` 的 `dsh.client.inject` + 一个**客户端 bundle**（参考 `dsh-connect-workbuddy`），不是 host 端一个 `ctx.ui` 调用 | 卡片须做成独立 client 插件，工作量比想象大 |
| "模拟顶层对话让 coordinator 介入"的方向 | 见 §1：subagent=哑写、顶层=智能路由。要让 mnemon_remember 走 coordinator，必须绑**非 subagent** 的 agent | 方向反了就一直哑写 |

## 3. 本机本地插件加载机制（已核实）

- 本机靠 profile 的 **`cordis.patch.yml`**（不是 marketplace 自动路径）挂插件。
- 插件是 profile `node_modules` 里的 npm 包（`C:/Users/13966/.dsh/profiles/desktop/node_modules/...`）。
- 强改当前运行 profile 的 `cordis.patch.yml` 再重启会动到活会话环境 —— 风险大，不要在沙箱里擅自动。

## 4. Phase 1 状态与 mock E2E（核实）

- `D:\DeepSeekHarness\dsh-memory-gateway\` 已编译：`src/index.ts`→`lib/index.js`（ESM，保留 `import z from`），含 `tests/e2e-mock.mjs`。
- mock harness 用假 `ctx` 加载**已编译的 `lib/index.js`**，真实执行 HTTP 路由 + "借 agent 上下文"胶水代码，`tests/e2e-mock.mjs` **12 项全 PASS**：
  - `/api/health` 免 token → 200；`/api/remember` 无 token → 401；带 token → 200（同步写）。
  - `agents.create` 恰好 1 次；`agents.withInitiator` 恰好 1 次；`tools.execute` 恰好 1 次且 `name === 'mnemon_remember'`。
  - `memoryBodyId` 透传为目标 space `'work'`；source 默认 `external`；agent 已绑到执行输入 `exec.agent`。
- harness **证明不了**的（须本机活 DSH 收口）：① `withInitiator` 在真 DSH 里是否真把 agent 灌进 mnemon 的 `exec.agent`；② 行是否真落进 `D:\memory\data\default\mnemon.db`。收口手法 = 活 DSH 加载插件 + curl 一次 `/api/remember` + 查库。
- 构建期依赖解析坑（已踩已解）：`@deepseek-ai/schemastery` 在沙箱外无法解析；解决法是本地 `npm install`，**不要 ship `node_modules`**；`mklink /D` 需管理员权限会拒，`NODE_PATH` 对 ESM 不生效。

## 5. 下一步（handoff，尚未实现）

Phase 2 待做：把 `withMemoryAgent` 从 `origin:'subagent'` 改为顶层 agent 模式（让 `mnemon_remember` 走 coordinator 智能路由），并把 mock harness 升级成覆盖"智能路由 vs 哑写"两种 agent origin 的断言。Phase 2 落库最终仍需本机活 DSH 实测。
