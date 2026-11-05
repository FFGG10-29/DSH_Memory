---
id: "2d59b052-9b4d-4c1e-9f7c-712ce4449b2b"
title: "dsh-memory-gateway：设置页看不到的根因（slots.inject vs register）与双入口实证"
description: "Root cause of the missing dsh-memory-gateway settings UI: direct ctx.slots.register throws when the host slot isn't declared (silently swallowed), must use ctx.slots.inject(name, () => ctx.slots.register(...)); plugins.bundle.config only renders inside the package detail page, so an extra settings.section registration is needed. Includes verified save/health checks."
status: "active"
created_at: "2026-11-02T16:16:44.485Z"
updated_at: "2026-11-02T16:16:44.485Z"
content_hash: "282c37a485a8d7066f3b9aa5be86ed3c09c47b1fdff7f772bc418682c0fa28d6"
source_paths:
  - "dsh-memory-gateway/src/index.ts"
  - "dsh-memory-gateway/lib/client.js"
  - "dsh-memory-gateway/tests/run-client.mjs"
  - "dsh-memory-gateway/package.json"
session_ids:
  - "8c092011-d3b6-4e65-ba0f-58583d6116c9"
memory_body_ids:
  []
---

# dsh-memory-gateway：设置页看不到的根因与双入口实证

适用环境：Windows 桌面，DSH profile `desktop`，项目 `D:\DeepSeekHarness\dsh-memory-gateway\`，插件版本 0.4.0。
验证方式：UIA 观察真实 GUI → 点击保存 → 读配置文件 + `/api/health`。

> 关联文档：`06e5d07a-7ff7-403c-87d7-8cea7984422d`（Phase 3 client bundle UI 注册机制）记录了 `__ModuleLoader__.load` / `ctx.slots.register` / `dsh.client.inject` / install_bundle / 启动时扫描等契约。**本文纠正并补充其中「槽位注册」一节**：`ctx.slots.register` 不是无条件的，且在详情页槽位里注册 UI 等于把入口藏起来。

## 1. 真实根因：直接 register 会抛异常并被静默吞掉

原实现写在 `apply(ctx)` 中：

```js
try { ctx.slots.register("plugins.bundle.config", Component); } catch (e) { /* 静默 */ }
```

- 当宿主页面**尚未声明**该槽位时，`register()` 直接抛错；外层 `try/catch` 把它吞掉，表面现象就是「插件已安装、配置卡片却不存在」。
- 正确写法是延迟注册，等槽位真实出现时再注册：

```js
ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register("plugins.bundle.config", Component));
```

- 因此「代码能否执行」≠「宿主是否渲染」。之前几轮把问题误判为 bundle 未加载/需重启，方向是错的。

## 2. 第二个原因：槽位本身的渲染位置

- `plugins.bundle.config` **只在「插件管理页 → 某个包的详情页」内部渲染**。不点开那个包，就永远看不到卡片——即使注册完全成功。
- 修正做法：额外注册 `settings.section`，让「记忆网关」直接出现在 设置 → 左侧导航（最容易找到的位置）。两个入口并存，都可用。

| 入口 | 路径 | 状态 |
|---|---|---|
| 设置导航 | 左下角头像 → 设置 → 左侧「记忆网关」 | ✅ 已确认可见 |
| 插件详情页 | 侧边栏 插件 → 已安装 → `dsh-memory-gateway` | ✅ 已确认可见 |

## 3. 隔离「代码 vs 宿主」的诊断手法

用 `tests/run-client.mjs`（`node:vm` + 假 `ModuleLoader` + 假 `ctx.slots`）离线执行 client bundle，断言两处槽位注册成功。这样能先排除「client 代码本身跑不通」，再去怀疑宿主侧渲染/扫描时机。

## 4. 保存与运行时验证（已实测通过）

- 在设置页点「保存设置」后，写入 `C:\Users\13966\.dsh\profiles\desktop\memory-gateway.config.json`：

```json
{
  "allowExternalDelete": true,
  "defaultSpace": "default",
  "hindsightEndpoint": "http://127.0.0.1:8888",
  "ollamaEndpoint": "http://127.0.0.1:11434",
  "ollamaModel": "nomic-embed-text"
}
```

- 网关 `/api/health` 正常：`plugin=dsh-memory-gateway`、`version=0.4.0`、`port=8890`、`defaultSpace=default`，并回报 `settingsPath` 及 hindsight/ollama 端点。

## 5. 可复用的结论

- 写 DSH client bundle 的槽位 UI 时，一律用 `ctx.slots.inject(name, …)` 包住 `register`，不要直接 register 并用 try/catch 兜底——那会把「槽位不存在」变成无声失败。
- 想让配置入口好找，别只挂 `plugins.bundle.config`（绑定在包详情页内），同时挂 `settings.section`。
- 判断「UI 没出现」时按 代码执行 → 槽位注册 → 槽位渲染位置 → 宿主启动扫描 的顺序逐层排除，不要直接跳到最后一步。
