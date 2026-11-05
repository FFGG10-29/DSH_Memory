---
id: "4ea0d902-b7a2-4f45-8f19-ab26c0fceb89"
title: "DSH Host 插件已验证 API 契约（dsh-memory-gateway 案例）"
description: "Verified DSH Host-plugin framework contracts discovered while building the dsh-memory-gateway HTTP→mnemon bridge: the requireAgent constraint, schemastery default export + no z.infer, and the ctx.effect factory pattern."
status: "active"
created_at: "2026-11-02T02:46:01.391Z"
updated_at: "2026-11-02T02:46:01.391Z"
content_hash: "582a24ffc7fb2345dc3b1c8f10b078e7d8a5b8e2223d87b4f10b7f37f9d90209"
source_paths:
  - "dsh-memory-gateway"
  - "dsh-memory-gateway/src/index.ts"
  - "dsh-memory-gateway/lib/index.js"
  - "dsh-memory-gateway/cordis.patch.yml"
  - "dsh-memory-gateway/package.json"
  - "dsh-memory-gateway/README.md"
  - "dsh-memory-gateway/tsconfig.json"
session_ids:
  - "cde39f65-9ccb-45b6-8eb3-7e5da18eab7a"
memory_body_ids:
  []
---

# DSH Host 插件已验证 API 契约（dsh-memory-gateway 案例）

适用环境：Windows 桌面，DSH profile desktop，DeepSeek Harness 实现 checkout `D:\deepseek\resources\app.asar\dsh\`。验证来源：`dsh-connect-workbuddy` 真实已编译插件 + 已安装 npm 包类型定义（`C:/Users/13966/.dsh/profiles/desktop/node_modules/@deepseek-ai/schemastery/lib/types/index.d.ts`）。

## 关键约束：记忆语义工具必须在活的 agent 上下文里调用

`mnemon_remember` 和 `mnemon_recall` 的 execute 都调用 `requireAgent(exec)`；当从 **bare Host 上下文（无 ambient session）** 调用时抛 `Mnemon semantic operations require a live DSH agent`。因此一个 Host HTTP handler **不能直接**调这些工具。

桥接方案（dsh-memory-gateway 采用）：用 `ctx.agents.create({ meta:{ origin:'subagent' } })` + `ctx.agents.withInitiator(agent, …)` 借一个活的 agent 上下文，再把该 agent 绑到 `ctx.tools.execute` 的 input 上派发。subagent 分支直接写入（无二次 LLM 路由），符合「显式指定 space」的设计。

## schemastery 已验证事实

- `@deepseek-ai/schemastery` 是**默认导出**：`import z from "@deepseek-ai/schemastery"`（不是 `import { z }`）。默认导出为 `Schema`（`lib/types/index.d.ts:210` 的 `export default Schema`）。
- **没有 `z.infer`**；config 类型需手写接口（如 `interface GatewayConfig { … }`）。
- 链式 API 可用：`z.object({…}).default(value).description(str)`、`z.number().default(8891).description(...)`、`z.string().default('')`、`z.boolean().default(true)`、`z.array(x).default([])`、`z.dict(x).default({})`。
- 包 exports：`.` 的 `import` 条件指向 `lib/index.mjs`（ESM），`require` 指向 `lib/index.cjs`。DSH 以 ESM（`type:module`）加载插件，`import z from` 取 default = `Schema`，解析正确。

## Cordis ctx 已验证契约

- `export const inject = ['webServer','agents','tools']`
- WebRoute 为裸 `node:http` 形态：`ctx.webServer.register({ kind:'exact', path, handler:(_req,res)=>… })`；handler 参数需显式类型（否则 tsc 报隐式 any，TS7006）。
- `ctx.tools.execute({ name, input })` 派发工具调用。
- `ctx.effect` 是**工厂返回 disposer**：必须 `ctx.effect(() => () => server.close())`。写成单箭 `ctx.effect(() => server.close())` 会在启动时立刻关服。
- 事件用法：`ctx.on("session/event", listener)`、`ctx.on("loader/volatile-update", …)`（源自 workbuddy）。

## cordis.patch.yml 最小 insert

与 `dsh-connect-workbuddy` 同款：`dsh.bundle.patch` 指向 `cordis.patch.yml`，最小 `insert` 条目。

## marketplace / 插件打包形态

`D:\DeepSeekHarness\dsh-memory-gateway\` 结构：`package.json`（`type:module`、`main:` 指向编译出的 `lib/index.js`）+ `src/index.ts` → `lib/index.js`（tsc 编译通过，ESM，保留 `import z from`）+ `cordis.patch.yml` + `tsconfig.json` + `README.md`。根目录需 `package.json` + `lib/`，**不要 ship `node_modules`**。

## 仍待活体验证的未知点

`ctx.agents.create` 的创建参数究竟是 `options` 还是 `createAgent(ownerCtx, options)`，`withInitiator` 是否真的把 agent 灌进 `exec.agent` —— 需在真实 DSH 会话加载插件、打一次 `/api/remember` 做端到端 smoke test 才能确认落库。代码按已核实签名编写，但端到端落库这一步最好实测确认。

## 相关文档

- `85bf0603-f2d9-4d02-bd11-bcee2aac0ba3`（Mnemon 跨工具记忆共享对齐）
- `f6a9a828-e1ee-446e-b5c6-5563dc451377`（旧 .mnemon 库非空修正）
