---
id: "feb5ab22-5f0c-4c04-88cf-3baff1838a82"
title: "DSH 桌面 profile 插件配置修复记录：Mnemon CLI 路径与 WorkBuddy provider 冲突"
description: "Windows 下 DSH mnemon 插件 spawn ENOENT 的根因与 cliPath 修复，以及手动 workbuddy provider 与 dsh-connect-workbuddy 插件 id 冲突的清理过程"
status: "active"
created_at: "2026-11-01T22:29:41.684Z"
updated_at: "2026-11-01T22:29:41.684Z"
content_hash: "5b1557ac5df61bb3e6e0202277a11f65d9c1ccd08463c499a0d43a21831c33cd"
source_paths:
  []
session_ids:
  - "2b17988e-3291-43a4-bc0c-f6c779786aff"
memory_body_ids:
  []
---

# DSH 桌面 profile 插件配置修复记录

适用环境：Windows，DSH 桌面版，profile `desktop`。
唯一改动文件：`C:\Users\13966\.dsh\profiles\desktop\cordis.patch.yml`（该 profile 的 patch 层，启动时一次性加载）。

## 1. Mnemon 插件报 spawn mnemon ENOENT

### 现象
`mnemon_status` 返回 `healthy: true` 但 `commandFound: false`，错误为
`failed to launch mnemon ("mnemon"): spawn mnemon ENOENT`，可用记忆空间 0 个。
会话内 `which mnemon` 也找不到命令。

### 根因（两层）
1. **npm 安装包在 Windows 下没有 `mnemon.exe`**。`D:\Tools\npm-global\node_modules\@mnemon-dev\mnemon` 下只有 `mnemon`（sh 脚本）、`mnemon.cmd`、`mnemon.ps1`。插件用 `spawn("mnemon")` 启动，Node/libuv 在 Windows 只补 `.exe`，不会解析 `.cmd`/`.ps1`，因此即使目录在 PATH 里仍报 ENOENT（已实测）。
2. **运行中的 DSH 主进程环境是启动时冻结的**。DSH 于 05:40:46 启动，mnemon 于 06:20 才安装，事后写入的用户 PATH 对已运行进程无效。

### 修复
- 真正的原生可执行文件在包的依赖里：
  `D:\Tools\npm-global\node_modules\@mnemon-dev\mnemon\node_modules\@mnemon-dev\mnemon-win32-x64\bin\mnemon.exe`
  （实测可运行，输出 `mnemon version 0.2.13`）。
- 在 patch 的 `- id: mnemon` 下新增 `cliPath:` 指向该 exe；同时把用户环境变量 `MNEMON_CLI_PATH` 设为同一路径作为冗余保险（插件界面文案声明支持该变量）。
- 改完后必须**完全退出并重启 DSH**，仅重载界面不生效。重启后在 Mnemon 设置页确认 CLI 路径与记忆空间数量。

### 排查手法
- 验证 patch 整体仍是合法 YAML 并统计条目数（当时 14 条 patch 行、mnemon 配置可读出）。
- 对比 `spawn` 行为：绝对路径 exe → 成功；裸 `mnemon` + PATH → ENOENT。

## 2. 手动配置的 workbuddy provider 与插件冲突

### 冲突点
- 手写在 `llm-pi-ai` 插件 config 下的 provider id 是 `workbuddy`，`baseURL: http://127.0.0.1:8710/v1`（本地 WorkBuddy 桥），并列了 7 个模型（hy3、hy4-preview、deepseek-v4.1-flash、glm-5.3、glm-5.3-flash、glm-5.3-flashx、step-5-preview）。
- 插件 `dsh-connect-workbuddy`（v5.17.0）默认 provider id 也是 `workbuddy`：源码 `lib/index.js` 中 `const providerId = options.provider ?? "workbuddy"`。
- 同一 id 被两个适配器注册 → 模型列表重复或互相覆盖，默认模型可能指向失效条目。

### 清理内容（用户要求改用插件供给）
- 删除 patch 中整块 `- id: llm-pi-ai`（含 baseURL 与全部手写模型），文件从 191 行降至约 152 行，YAML 仍可解析。
- 停止本地桥进程（监听 `127.0.0.1:8710` 的 node `server.mjs`），确认端口释放；删除启动项 `WorkBuddy Bridge.lnk`。
- 保留 `C:\Users\13966\.dsh\workbuddy-bridge` 文件夹，需要回退时可重跑其中的 `start.cmd`。

### 有意保留
- `compaction-basic` 仍配置 `provider: workbuddy` / `model: glm-5.3-flash`，改由插件供给后仍可解析。
- `agent-default-model` 为 `deepseek-account/deepseek-flash`，不涉及 workbuddy，未受影响。
- `.credentials.yaml` 中的 WorkBuddy API key 已无引用方，保留无副作用。

## 3. 可复用的操作惯例
- 修改 patch 后必须重启 DSH；用插件状态/设置页验证，而不是只看文件内容。
- 引入同类 provider 插件前，先确认其默认 provider id 是否与手写配置重复；有重复时删除手写那份，而不是改 id 试探。
- 排查 Windows 上「命令找不到」时，先区分是 PATH 问题还是 `spawn` 无法解析 `.cmd` 的问题，优先用 exe 绝对路径验证。
