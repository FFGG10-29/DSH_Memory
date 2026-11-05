---
id: "06e5d07a-7ff7-403c-87d7-8cea7984422d"
title: "dsh-memory-gateway Phase 3：client bundle UI 注册机制（首次实证）"
description: "Verified DSH client-bundle registration mechanics discovered building the dsh-memory-gateway Phase-3 Plugins-page card: __ModuleLoader__.load/ctx.slots shape, dsh.client.inject requirement, install_bundle workspace link, /plugins/??pkg/client.js serve address, and the startup-only client-modules scan (hot reload insufficient, needs DSH restart). Supplements host-API doc 4ea0d902 and write-path doc 3d1617fe."
status: "active"
created_at: "2026-11-02T12:45:48.260Z"
updated_at: "2026-11-02T12:45:48.260Z"
content_hash: "9df23995024322ec08eef4fc9e0a9ce66a6af29d4bdd11edfb2be4e396b6e814"
source_paths:
  - "dsh-memory-gateway/package.json"
  - "dsh-memory-gateway/lib/client.js"
session_ids:
  - "6928e140-937b-4afa-9cbe-1175cc750d29"
memory_body_ids:
  []
---

# dsh-memory-gateway Phase 3：client bundle UI 注册机制（首次实证）

适用环境：Windows 桌面，DSH profile `desktop`，checkout `D:\deepseek\resources\app.asar\dsh\`，项目 `D:\DeepSeekHarness\dsh-memory-gateway\`。验证来源：本 checkpoint 实际 `install_bundle` + `/plugins/??…/client.js` 抓取 + `clientModules.graph`/dsh-unlag state 检查。

> 关联文档：`4ea0d902-b7a2-4f45-8f19-ab26c0fceb89`（Host 插件 API 契约）；`3d1617fe-96f9-4033-96ab-bf3742bd9d05`（智能路由/Phase 2/Phase 1 E2E）；`a3952ed4-70a3-4cfc-954e-92dd01e961ad`（recall 门禁与 mnemon CLI）。本文补的是 **Phase 3 客户端 UI** 的注册与 serve 机制，未覆盖于其它文档。

## 1. client bundle 的加载/注册契约（已核实）

- 客户端模块走 `window.__ModuleLoader__.load({ id, factory })`，`factory` 返回 `{ name, apply(ctx) }`。
- UI 注入用 `ctx.slots.register(<slot名>, 组件)`。实测注册目标为 DSH Plugins 页的 `plugins.bundle.config` 槽，key = 包名（`dsh-memory-gateway`）。
- 依赖无关（纯 DOM、无 React 构建）的 client 可直接手写 JS 发布，不需要走前端构建管线。

## 2. dsh.client 声明必须带 inject（曾踩坑）

- 只写 `"platform":"web"` 不足以让 DSH 把 client 纳入模块注册表。
- 必须声明 `dsh.client.inject: ["@deepseek-ai/dsh-client-ui-slots", …]`（对照 `dsh-connect-workbuddy` 的 `package.json`：inject 列出所依赖的 `@deepseek-ai/dsh-client-*` 包）。即使纯 DOM 也需写 inject 使 client 进入 graph。
- `package.json` 另需 `exports["./client"]` 指向 client 产物。

## 3. 正确安装方式：plugin_manager install_bundle（非手工塞 node_modules）

- 手工把包塞进 profile `node_modules` 不会被 client-modules 扫描自动发现。
- 正路：把 workspace 里的包目录作为 bundle 安装——`plugin_manager install_bundle target=<绝对包目录>` → 返回 `application: applied`，pnpm 登记进 lockfile 并变成 **workspace 软链接**（`node_modules/dsh-memory-gateway -> D:\DeepSeekHarness\dsh-memory-gateway`），`lib/client.js` 随链接一并可见。
- 安装后 client 由 DSH 通过 `/plugins/??<包名>/client.js` 地址 serve（注意 `??` 前缀是 bundle client 的寻址形式；裸 `/plugins/<包名>/client.js` 会 404）。

## 4. 关键卡点：client-modules 扫描是启动时做的，热重载不重扫

即使 `install_bundle` 成功且加了 inject：

- `clientModules.graph()` 的 entries/batches 仍**不含** dsh-memory-gateway（运行时已缓存）。
- `/plugins/??dsh-memory-gateway/client.js` 返回的是 **dsh-unlag 的空白占位**：`/* dsh-unlag: … not part of the plugin set served now … */ window.__ModuleLoader__.load({ id, factory: () => ({ name, apply(){ } }) })`——即 boot 时冻结的 serve 集（boot entries 64 条）里没有新装的 bundle，dsh-unlag 用空 `apply` 占位。
- 结论：**要让 GUI 真的加载该 client，需重启 DSH 让启动扫描重新纳入 dsh-memory-gateway**。热重载/reload 不会 re-scan client modules。这是环境限制，不是代码问题。

## 5. Phase 3 客户端卡片功能（本次实现的 UI）

`lib/client.js` 依赖无关纯 DOM 状态卡片，注册进 `plugins.bundle.config`，显示：监听端口、Bearer Token（带复制按钮）、记忆空间列表、`/api/remember /api/recall /api/write-direct /api/forget` 入口说明、服务健康状态（从 `/api/health`、`/api/spaces` 实时拉取）。

## 6. 重启后的验证步骤（未完成项）

1. 重启 DSH 后确认 `/plugins/??dsh-memory-gateway/client.js` 返回真实内容（不再是被 dsh-unlag 占位替换）。
2. 前端刷新让页面按当前 serve 集重新 boot（boot 列表需纳入 dsh-memory-gateway）。
3. 确认 `plugins.bundle.config` 槽出现卡片并正常渲染。
