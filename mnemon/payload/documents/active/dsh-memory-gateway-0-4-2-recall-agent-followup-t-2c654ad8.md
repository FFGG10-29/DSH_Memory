---
id: "2c654ad8-42bb-43a9-87b2-d12a4744e19f"
title: "dsh-memory-gateway 0.4.2：recall 改为「借活 agent + followup() 真实 turn」路径（架构变更 + 当前实证状态）"
description: "v0.4.2 recall 架构重写为借活 agent+followup() 真实 turn，推翻 a3952ed4 的原生 CLI 结论；当前实测返回空结果，根因未定。"
status: "active"
created_at: "2026-11-03T13:46:07.166Z"
updated_at: "2026-11-03T13:46:07.166Z"
content_hash: "34018943a7aab13e01738e57adf40cd5e857d884f9dc6687c8284a91a9970953"
source_paths:
  - "dsh-memory-gateway/src/index.ts"
  - "dsh-memory-gateway/lib/client.js"
  - "dsh-memory-gateway/package.json"
session_ids:
  - "ba2feb31-f45c-4e29-b3dc-70fe1d205b35"
memory_body_ids:
  []
---

适用环境：Windows 桌面，DSH profile `desktop`，项目 `D:\\DeepSeekHarness\\dsh-memory-gateway`，网关 `127.0.0.1:8890`。验证来源：本 checkpoint 的源码 header、构建、自测与实机 HTTP 探测。

> 关联文档：`a3952ed4-70a3-4cfc-954e-92dd01e961ad`（recall 门禁 + 原生 mnemon CLI，已实证）、`a85dc4e2-da18-47b0-a854-8431d5a242b1`（0.4.1 信封修复）、`06e5d07a-7ff7-403c-87d7-8cea7984422d`（Phase 3 客户端 UI）。本文补的是 **v0.4.2 的 recall 架构重写 + 当前未修通的实证状态**，依据 checkpoint 的源码 `src/index.ts` 头部注释与运行实例。

## 1. 架构变更（v0.4.2，已在源码 header 与运行实例确认）

`src/index.ts` 头部重写 WRITE / RECALL / DELETE 三条链路：

- **WRITE**：借顶层活 agent → `mnemon_remember`（非 subagent，避免绕过 coordinator 的 distill+classify 选对 Memory Space）。
- **RECALL**：借顶层活 agent + `followup()` 唤醒一个**真实 turn**，让 agent 在 turn 内调用 `mnemon_recall`。该工具硬编码 `requirePinnedView: true`（"View pinned to the current turn" 门禁），只有真实运行中的 turn 能满足。coordinator 路由覆盖全部 provider（Native + Hindsight + Mem0 + Honcho + …），无需 per-provider adapter。代价：每次 recall 一次 LLM 生成（token + latency）。`--store <uuid|name>` 限定 Space。
- **DELETE**：借顶层活 agent → `mnemon_forget`（`coordinator.write` 不需要 pinned view，覆盖全部 provider 含远程 banks）；agent 路径不可用时回退到原生 `mnemon` CLI 扫本地 stores。

**含义**：v0.4.2 的 recall 设计**直接推翻** `a3952ed4` 的「`mnemon_recall` 的 `requirePinnedView` 门禁对外部网关不可行 → 必须用原生 mnemon CLI」结论，改为在网关内借活 agent + `followup()` 造出一个真实 turn 来满足门禁。

## 2. 当前实证状态（checkpoint 实测，root cause 未定）

- 构建通过（TSC_OK），hot-reload 生效：`/api/health` 回报 `v0.4.2`、无 hindsight/ollama 字段；`/api/config` GET 显示清洗后的 schema（`persisted:true`）。`lib/client.js` 已移除 Hindsight/Ollama 字段并跟着升版。
- recall 实测（`POST /api/debugRecall '阿鱼'`）回报：
  - `{"ok":true,"ms":51830,"results":{"query":…,"mode":"smart","searchedSpaces":[…含 "hindsight-…" 及各 Space / "default"],"results":[],"note":"agent recall produced no tool result"}}`
  - 正面：agent 路径确实触达了 Hindsight space（provider 覆盖逻辑在跑）。
  - 负面：~52s 后 `mnemon_recall` 未产出工具结果，最终 `results` 为空。
- 父对话在 checkpoint 截止时正准备加 `/api/debug/recall-raw` 诊断端点 dump session surface events 以定位根因，**故根因未定**。候选（仅列举，未经证实）：
  1. 借来的 agent 没有 `mnemon_recall` 工具可用；
  2. `whenIdle()` 在 turn 真正开始之前就返回；
  3. 模型没有真正调用该工具；
  4. surface 抽取用的 key（`meta.name === 'mnemon_recall'` / `eventAt(seq)`）与实际事件结构不符。

## 3. 对维护者的含义

- 截至本 checkpoint，v0.4.2 的「agent + `followup()` recall」路径**未经验证、实测返回空结果**。
- `a3952ed4` 记录的「原生 mnemon CLI recall」仍是**唯一经实证的可用读链路**，直到 agent 路径被修通并在端到端实测中返回非空。
- 修通前**不要**假设新 recall 路径可用，也**不要**据此删除或改写 `a3952ed4` 的原生 CLI 方案。
- 待补：用 `/api/debug/recall-raw` 确认借来 agent 的真实事件流，定位上面 4 个候选之一。

## 4. 其他 v0.4.2 伴随变更（已在 checkpoint 确认）

- 从 `Config` schema、client card、`/api/config` 响应中移除了 Hindsight / Ollama 相关字段与旋钮（保留 `allowExternalDelete` switch 及 port / token / space / adminToken 等必需项）。
- 版本号 `package.json` / `src/index.ts` / `lib/mcp-server.js`（`serverInfo.version`）统一升至 `0.4.2`。
- DSH 工作区为 symlink（非 watch 路径），修改后需 `dsh-unlag` reload 端点触发重建；health 版本号是判断热重载是否生效的最快信号。
