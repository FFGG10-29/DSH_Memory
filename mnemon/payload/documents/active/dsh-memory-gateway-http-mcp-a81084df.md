---
id: "a81084df-258d-4c6e-a89a-ee4ae2d8b928"
title: "dsh-memory-gateway：外部工具集成契约（已实证，HTTP + MCP）"
description: "Verified external-facing integration contract for dsh-memory-gateway: published HTTP endpoints + field names, MCP tool surface (lib/mcp-server.js), connection-discovery/auth model, and the critical classification-routing caveat for WorkBuddy/CodeBuddy. Supplements 4ea0d902/3d1617fe/a3952ed4."
status: "active"
created_at: "2026-11-02T08:41:53.387Z"
updated_at: "2026-11-02T08:41:53.387Z"
content_hash: "e9c6a0d6a313b6064516c27b90150174b37f0e4bab0c904a6e32b9dd9c1d36a4"
source_paths:
  - "dsh-memory-gateway/src/index.ts"
  - "dsh-memory-gateway/src/mcp-server.ts"
  - "dsh-memory-gateway/package.json"
  - "dsh-memory-gateway/docs/EXTERNAL-SETUP.md"
  - "dsh-memory-gateway/cordis.patch.yml"
session_ids:
  - "905ce796-7a84-41d7-8ea5-9f31f825938e"
memory_body_ids:
  []
---

# dsh-memory-gateway：外部工具集成契约（已实证，HTTP + MCP）

适用环境：Windows 桌面，DSH profile `desktop`。验证来源：已编译 `dsh-memory-gateway/src/index.ts`、`src/mcp-server.ts`、`package.json`、`cordis.patch.yml`，及双链路实机通过（`POST /api/remember` → `ok:true, routedBy:coordinator`；`/api/recall` 经原生 mnemon CLI 命中真实记忆 `f7c402fc` / 空间 `186a10aa`）。

> 关联文档：`4ea0d902`（Host 插件 API 契约）、`3d1617fe`（mnemon 智能路由内部 + Phase 1 E2E）、`a3952ed4`（recall 门禁 + 原生 CLI 绕过）。用户向接入文档在 `dsh-memory-gateway/docs/EXTERNAL-SETUP.md`。

## 已验证的外部 API 契约

网关监听 `127.0.0.1:8890`，需同机 + Bearer Token。字段名均已从源码核实。

HTTP 端点：
- `POST /api/remember` — 智能写入。body `{ content(必填), source?, hintSpace?, category?, importance?, tags? }`。`hintSpace` 命中则 `routedBy:'hint'`，否则 `routedBy:'coordinator'`（DSH 借顶层 agent 做语义蒸馏分类）。
- `POST /api/recall` — 检索。body `{ query(必填), space?, limit?, mode? }`；读链路走原生 mnemon CLI（`--store <space>` 按 Memory Space 隔离、`--limit`、`--brief`、`--basic`）。
- `POST /api/write-direct` — 直写指定空间。`{ content(必填), hintSpace(必填), source? }`，无智能路由。
- `GET /api/spaces` 与 `GET /api/memory/spaces` — 列出 Memory Spaces。
- `GET /api/health` — 健康检查（注意：真实路由是 `/api/health`，早期曾误用 `/health`）。

MCP 服务端（`lib/mcp-server.js`，stdio ↔ HTTP 薄代理，不跑在 DSH 进程内）：提供工具 `memory_remember / memory_recall / memory_write_direct / memory_spaces`；`serverInfo` 版本 `0.2.0`，`protocolVersion 2024-11-05`。

连接发现优先级：`DSMG_TOKEN / DSMG_PORT / DSMG_HOST` 环境变量 → `<DSH_HOME>/profiles/desktop/memory-gateway.state.json`（含 `token`/`port`/`host`）→ 默认 `127.0.0.1:8890, token:''`。Token 在该 state 文件中（本机路径如 `C:\Users\13966\.dsh\profiles\desktop\memory-gateway.state.json`），不要外泄。

## 关键集成约束（设计坑）

- **外部工具必须走网关 `/api/remember` 才能享受 DSH 分类**。当前 WorkBuddy/CodeBuddy 的 Stop hook 仍直调裸 `mnemon remember`（仅靠 `MNEMON_DATA_DIR=D:\memory` 对齐库文件），**绕过**了 DSH 分类器，仅共享同一 `mnemon.db`。要让它们「像 DSH 一样分类存储」，需把写动作改为打网关 `/api/remember`。此项尚未动手。
- **身份决定路由分支**：网关刻意借**顶层（非 subagent origin）** agent，命中 `coordinator.remember` 做 LLM 分类；若以 subagent 身份调 `mnemon_remember` 会走 `sourceAction` 直写分支、**跳过分类**（哑写）。故外部写入必须走网关的顶层 agent 路径。
- 写入后立刻 recall 可能查不到：异步落库，属正常。

## 已解决的待验证项

`3d1617fe` 中标记的「`ctx.agents.create` 参数 / `withInitiator` / 端到端落库待实机验证」现已闭环：双链路在真实 `D:\memory\data\default\mnemon.db` 上实测通过（`delegated:true, runId` 为智能路由证据；recall 按空间隔离命中）。源 `index.ts` 的 `resolveMnemonCli()` 已从 `dsh-mnemon-source-memory-spaces/native-cli` 的 `findMnemonCommand` 解析真实二进制全路径（Windows 下 `.exe` 不需 shell，`.cmd` 需 `shell:true`），并已 `TSC_OK` 重新编译同步。
