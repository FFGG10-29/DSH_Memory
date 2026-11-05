---
id: "a3952ed4-70a3-4cfc-954e-92dd01e961ad"
title: "dsh-memory-gateway：recall 门禁调查与原生 mnemon CLI 绕过（已实证）"
description: "Why mnemon_recall (requirePinnedView gate) and the dsh-mnemon closure-local lifecycle both fail for an external gateway, and the verified native mnemon CLI recall path (resolveMnemonCli + --store scoping). Supplements host-API doc 4ea0d902 and write-path doc 3d1617fe."
status: "active"
created_at: "2026-11-02T08:17:02.002Z"
updated_at: "2026-11-02T08:17:02.002Z"
content_hash: "556a4d92988147b5e8ada0c6f5825fa798b0e62361bd1f6ace585589a804c6bf"
source_paths:
  - "dsh-memory-gateway/src/index.ts"
session_ids:
  - "42fa4b89-365e-414c-89dd-93a2381beacc"
memory_body_ids:
  []
---

# dsh-memory-gateway：recall 门禁调查与原生 mnemon CLI 绕过（已实证）

适用环境：Windows 桌面，DSH profile `desktop`，`D:\DeepSeekHarness\dsh-memory-gateway\src\index.ts`。本文只补 **recall 读链路** 的新事实——写链路（智能路由 / 借 agent 哑写）见 `3d1617fe-96f9-4033-96ab-bf3742bd9d05`，Host 插件 API 契约（含 `mnemon` 工具需活 agent 上下文）见 `4ea0d902-b7a2-4f45-8f19-ab26c0fceb89`。

## 1. recall 为何走不通（源码逐行确认）

网关是「借来的顶层 agent」胶水上下文，从未真正跑过一个 turn。两条读路径都卡死：

- **`mnemon_recall` 工具 wrapper 硬编码 `requirePinnedView: true`**（"View pinned to the current turn" 门禁）。借来的 agent 没 pinned view → 抛 `Recall requires the View pinned to the current turn`。
- **直接调 `MnemonLifecycle` / `coordinator` 也走不通**：`dsh-mnemon` 的 host-facing lifecycle 是**闭包局部值**（不是注册 service）。`provide:["mnemonMemory"]` 只声明不注册，runtime `ctx.get` 永远拿不到；`coordinator` 同理无法从外部触达。

> 结论：外部网关的「读」不能用 mnemon 的工具/lifecycle 路径，必须绕开 DSH 的 agent 上下文。

## 2. 落地方案：原生 `mnemon` CLI（与 DSH 写同一个库）

正确读路径是原生 `mnemon` CLI，它读**同一个数据库**（`MNEMON_DATA_DIR=D:\memory`）且**不需要 agent、不需要 pin**。

`recallViaCli(input)` 实现要点（`src/index.ts` 约 194-218 行）：

- `args = ['recall', input.query, '--brief']`
- 空间隔离：`input.space` → `--store <uuid|name>`（按 DSH Memory Space 隔离）。
- 数量：`--limit <n>`；模式：`--basic` 切基础（smart 为默认）。
- 环境变量兜底：若 `MNEMON_DATA_DIR` 缺失或为空，设 `D:\memory`（注意源码里是单反斜杠字符串 `'D:\\memory'`，实际写盘为 `D:\memory`）。
- 用 `execFileSync(cli, args, { encoding:'utf8', windowsHide:true, timeout:20000, stdio:['ignore','pipe','pipe'] })`；失败把 stdout+stderr 拼进 Error。
- 解析 `JSON.parse(raw)`，失败则回退到 text envelope（CLI 不一定吐 JSON）。

### `resolveMnemonCli()`（约 83-113 行）

返回 CLI 全路径，顺序：

1. 配置 `config.mnemonCli` 若指向真实文件即用。
2. **官方 resolver**：`const spec = 'dsh-mnemon-source-memory-spaces/native-cli'; const mod = await import(/* @vite-ignore */ spec); mod.findMnemonCommand({ cliPath: undefined })`。本机实得全路径：
   `D:\Tools\npm-global\node_modules\@mnemon-dev\mnemon\node_modules\@mnemon-dev\mnemon-win32-x64\bin\mnemon.exe`
3. PATH 搜索（Windows 需 `.exe`/`.cmd` 扩展名）。
4. 常见位置：`D:/Tools/npm-global/mnemon.exe`、`%LOCALAPPDATA%/Programs/mnemon/mnemon.exe`、`%USERPROFILE%/go/bin/mnemon.exe`。
5. 兜底字面值 `'mnemon'`。

## 3. 顺手修掉的坑（实现手记）

1. **ESM 插件里 `require()` 不可用** → 改用 `await import(spec)`，spec 用**变量**（非字面量）绕过 tsc 字面量模块检查（`/* @vite-ignore */`）。
2. **`execFileSync('mnemon')` 在 Windows 不搜 PATH** → 必须解析成全路径；`.cmd` 需 `shell:true`，`.exe` 不需要。
3. **`resolveMnemonCli` 必须为 `public`**（原为 `private`）：`debugProbe` 在运行时访问它，tsc 报 `TS2341` 私有限制。改 public 后 `TSC_OK`。
4. **插件被 DSH 因早前「duplicate exact route」热重载失败隔离进 `node_modules/.ignored/`** → 移回 `node_modules/dsh-memory-gateway/`，插件重新加载、警告消失。

## 4. 实证结果（真实端到端）

- `/api/health` → `{"ok":true,"plugin":"dsh-memory-gateway","version":"0.2.0","tokenHint":"c7f3e5…","defaultSpace":"default"}`。
- `/api/recall {"query":"DSH_GATEWAY_PROBE"}` → **2 条真实记忆**（命中 id `f7c402fc`）。
- 带 `space=<uuid>` 空间隔离 recall → 正确命中该 store（id `186a10aa`，网关立项记忆）。
- 写入回归：`POST /api/debug/remember` → `ok:true`、`routedBy: coordinator`，source 强制 `external`。

**结论：写、读双链路已在真实 `D:\memory\data\default\mnemon.db` 上实证贯通。** 下一步为 Phase 3 前端卡片 + 打包上架 + 多客户端（CodeBuddy/WorkBuddy/Cursor）实测。

## 相关文档

- `4ea0d902-b7a2-4f45-8f19-ab26c0fceb89` — DSH Host 插件 API 契约（含 mnemon 工具需活 agent 上下文的核心约束）。
- `3d1617fe-96f9-4033-96ab-bf3742bd9d05` — mnemon 智能路由内部机制 + 写链路 Phase 1/2 状态。
- `85bf0603-f2d9-4d02-bd11-bcee2aac0ba3` — mnemon 跨工具 data-dir 对齐（MNEMON_DATA_DIR=D:\memory 三端共享）。
