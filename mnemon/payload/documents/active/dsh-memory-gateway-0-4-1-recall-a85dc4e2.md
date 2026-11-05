---
id: "a85dc4e2-da18-47b0-a854-8431d5a242b1"
title: "dsh-memory-gateway 0.4.1：recall 响应信封缺陷修复与「客户端是否依赖私有信封」的实证方法"
description: "0.4.1 修复 /api/recall 双层信封（应为扁平 query/mode/searchedSpaces/results）、MCP 协议层无错的区分、判定客户端是否依赖私有信封的实证步骤、回归测试 recall-shape.mjs 与三宿主 mcp.json 注册实况。补充 a81084df。"
status: "active"
created_at: "2026-11-02T23:57:40.386Z"
updated_at: "2026-11-02T23:57:40.386Z"
content_hash: "460a7b680812905f41ae88cc48ec06b4dbf3582fd6aed2ebf54cbc571a1b11a6"
source_paths:
  - "dsh-memory-gateway/src/index.ts"
  - "dsh-memory-gateway/src/mcp-server.ts"
  - "dsh-memory-gateway/package.json"
  - "dsh-memory-gateway/tests/recall-shape.mjs"
  - "dsh-memory-gateway/docs/market-entry.yml"
  - "dsh-memory-gateway/README.md"
  - "workbuddy/DSH记忆网关-CodeBuddy接入配置.md"
session_ids:
  - "a03cacb7-269f-47db-983b-8bab96b2bc54"
memory_body_ids:
  []
---

# dsh-memory-gateway 0.4.1：recall 响应信封缺陷修复与客户端依赖实证

适用环境：Windows 桌面，项目 `D:\DeepSeekHarness\dsh-memory-gateway`，网关 `127.0.0.1:8890`，下游 Hindsight `127.0.0.1:8888` / Ollama `127.0.0.1:11434`（nomic-embed）。验证来源：本 checkpoint 的源码/构建/自测/实机 HTTP 与 MCP stdio 调用。

> 关联文档：`a81084df-258d-4c6e-a89a-ee4ae2d8b928`（外部 HTTP+MCP 集成契约）、`a3952ed4-70a3-4cfc-954e-92dd01e961ad`（recall 门禁与原生 CLI）、`3d1617fe-96f9-4033-96ab-bf3742bd9d05`（智能路由/写链路）、`06e5d07a-7ff7-403c-87d7-8cea7984422d`（client bundle UI）。本文只补 0.4.1 的信封修复与其判定证据。

## 1. 缺陷本身（自家信封，不是 MCP 协议）

- `src/index.ts` 的 `POST /api/recall` 路由把 `recall()` 的返回值又包了一层 `{ results: <envelope> }`，实得 `{"results":{"query":…,"searchedSpaces":[…],"results":[…]}}`。
- 契约应为扁平信封：`{"query","mode","searchedSpaces":[…],"results":[…]}`。修复点约 `src/index.ts:759-767`，改后实测 `http=200` 且 `top keys: query,mode,searchedSpaces,results`。

## 2. 关键区分：MCP 协议层从未出错

- MCP `CallToolResult`（`@modelcontextprotocol/sdk/dist/cjs/spec.types.d.ts:1035-1045`）形状为 `{ content: ContentBlock[]; structuredContent?: {...}; isError?: boolean }`。
- `src/mcp-server.ts:170` 的 `toContent()` 始终返回 `[{ type:'text', text: JSON.stringify(data) }]`，即被双层包装的是 **text 字符串里的 JSON 信封**，不是协议字段。因此 WorkBuddy/CodeBuddy 侧不存在「协议不符」。
- 教训：定位此类问题时先分清「协议字段」与「自家响应体信封」两个层面，别把后者的缺陷表述成前者。

## 3. 「是否有客户端依赖双层结构」的实证方法（可复用）

按以下顺序定向检查，成本低且结论硬：

1. 宿主的 MCP 工具清单缓存：`.workbuddy/mcp-tool-list.json` 只有 `name` + `description`，**不含返回体结构** —— 缓存清单不能证明调用方依赖字段形状。
2. 插件/hook 目录内搜 `results` 解析代码：`.workbuddy/plugins`、`.workbuddy/hooks`、`.codebuddy/hooks`、`.codebuddy/plugins` 与 `lib/admin.html`、`client.js` 均零命中。
3. 用量日志（`.workbuddy/usage-log.json`，638 字节）：无 `memory_recall` 调用记录，说明该宿主尚未真正消费过返回体。
4. 找「反差证据」：CodeBuddy 自写的接入文档 `D:\workbuddy\DSH记忆网关-CodeBuddy接入配置.md:90` 明写「返回体里的 `searchedSpaces`」，即期望顶层字段 —— 旧双层结构下它在 `results.searchedSpaces`，说明是文档与实现的内部矛盾。
5. 兜底考虑：若外部已有按 `results.results` 写的脚本，可加兼容（保留 `legacy:{results:…}` 字段或按 `Accept-Version` 头切换），但需先确认真实调用方存在。

## 4. 0.4.1 交付内容

- 版本号 `package.json` / `src/index.ts`（`ok:true, plugin, version`）/ `src/mcp-server.ts`（`serverInfo.version`）/ `README.md` 统一升至 `0.4.1`。
- 新增回归测试 `tests/recall-shape.mjs`：断言 `results` 必须是数组，且禁止出现 `results.results`。
- 自测全绿：`e2e-mock`、`e2e-mock-phase2`、`mcp-e2e`、`run-client`、`spaces-check`、`recall-shape`、`forget-check` 均 PASS；`TSC_OK`；MCP stdio 初始化返回 `dsh-memory-gateway 0.4.1`，工具面为 `memory_remember/memory_recall/memory_write_direct/memory_spaces/memory_forget`。
- 产物重打包 `dsh-memory-gateway-0.4.1.zip`（约 41 KB），内容含 `docs/architecture.svg`、`docs/EXTERNAL-SETUP.md`、`lib/{admin.html,client.js,index.js,mcp-server.js}`、`cordis.patch.yml`、`LICENSE`、`package.json`、`README.md`；另新增 `docs/market-entry.yml`。

## 5. 客户端接入注册（本机实况）

三个宿主均已指向同一 MCP 入口，命令统一为绝对路径 `C:\Users\13966\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`（v22.22.2）+ `D:\DeepSeekHarness\dsh-memory-gateway\lib\mcp-server.js`：

- `C:/Users/13966/.cursor/mcp.json` —— servers: `maker-lua-lsp`、`dsh-memory`
- `C:/Users/13966/.codebuddy/mcp.json` —— servers: `dsh-memory`
- `C:/Users/13966/.workbuddy/mcp.json` —— servers: `rea`、`dsh-memory`

用该 node 绝对路径模拟宿主启动，`initialize` 成功返回 `dsh-memory-gateway 0.4.1` 与 5 个工具，三份 JSON 均合法且 exe 路径 exists=true。

踩坑记录：bash 里拼 Windows 反斜杠路径时 `\1`、`\n`、`\.` 会被转义吞掉（出现 `C:Users966.workbuddyinaries`），改在 PowerShell/单引号或用正斜杠处理；仅做存在性校验时优先用正斜杠路径。
