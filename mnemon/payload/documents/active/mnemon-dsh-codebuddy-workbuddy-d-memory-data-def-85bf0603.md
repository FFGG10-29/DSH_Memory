---
id: "85bf0603-f2d9-4d02-bd11-bcee2aac0ba3"
title: "Mnemon 跨工具记忆共享对齐：DSH / CodeBuddy / WorkBuddy 共用 D:\\memory\\data\\default"
description: "How the three mnemon data stores relate on this Windows desktop, the MNEMON_DATA_DIR alignment fix, and the persistence caveat a future session must re-verify."
status: "active"
created_at: "2026-11-01T23:19:08.095Z"
updated_at: "2026-11-01T23:19:08.095Z"
content_hash: "c1637851c7ac632a55d5a9121cb4a85c1361a322374d1c9520fcaf9f9978ef68"
source_paths:
  []
session_ids:
  - "4b7691df-a5dd-4829-976a-dd3898c36950"
memory_body_ids:
  []
---

# Mnemon 跨工具记忆共享对齐

适用环境：Windows 桌面，DSH profile `desktop`，`mnemon` v0.2.13。
相关既有文档：`feb5ab22-5f0c-4c04-88cf-3baff1838a82`（同机 DSH Mnemon CLI 路径修复与 `dataDir: D:\memory` 的 patch 配置）、`ade0758c-42fc-4ade-a26a-4cd95b513559`（Hindsight 守护进程）。

## 1. 三个 mnemon 数据落盘位置（实测架构）

| 来源 | data-dir 解析 | 实际数据库文件 |
|---|---|---|
| DSH `dsh-mnemon` 原生 store | 由 `cordis.patch.yml` 显式 `--data-dir D:\memory` | `D:\memory\data\default\mnemon.db` |
| CodeBuddy / WorkBuddy hooks | `${MNEMON_DATA_DIR:-$HOME/.mnemon}`（见 `prime.sh`/`stop.sh`） | 默认 `C:\Users\13966\.mnemon\data\default\mnemon.db`，设了变量后 → `D:\memory\...` |
| `mnemon` CLI 默认 | `MNEMON_DATA_DIR` 未设时 | `C:\Users\13966\.mnemon\data\default\mnemon.db` |

- DSH 的 Hindsight body 是**独立 UUID store**：`D:\memory\data\<uuid>/mnemon.db`，由 `memory-providers.json` 的 `hindsight` provider 单独管理，与 `default` store 互不相通。
- `mnemon --help` 确认 `--data-dir` 绑定环境变量 `MNEMON_DATA_DIR`，且 `--store` 可覆盖 active 文件。DSH patch 未设 `store`，故其原生 store 即 `default`。

## 2. 关键结论：原「默认 store 自动共享」前提不成立

DSH 与 CLI/hooks 原本指向**两个不同的 SQLite 文件**（`D:\memory` vs `C:\Users\13966\.mnemon`）。「all sessions share `default`」只在**同一 data-dir 内**成立。因此要切实互通，必须让 CB/WB 的 `mnemon` 调用落到 `D:\memory`。

## 3. 对齐做法（低风险、可逆）

设 `MNEMON_DATA_DIR=D:\memory`：DSH 不受影响（它显式传 `--data-dir`），而 CB/WB 的 hooks 及裸 CLI 调用都会解析到 `D:\memory\data\default`，与 DSH 原生 store 同库。

验证手法（父 checkpoint 内已用）：
- `mnemon status`（`MNEMON_DATA_DIR=D:\memory`）→ `db_path: D:\memory\data\default\mnemon.db`，与 DSH 侧一致。
- `mnemon status`（不设变量）原文为 `C:\Users\13966\.mnemon\data\default\mnemon.db`（证明默认分歧）。
- 旧空壳 `C:\Users\13966\.mnemon\data\default\mnemon.db`（`total_insights: 0`）可安全删除，无数据损失。

## 4. ⚠️ 必须复核的持久性问题（本审查无法执行命令验证）

父 checkpoint 声称「写入**持久用户环境变量** `MNEMON_DATA_DIR=D:\memory`」（选择事件对齐方案，输出 `set: D:\memory`，exit 0），但**未展示所用命令**。需警惕：

- 若是 shell 内的 `set` / `export MNEMON_DATA_DIR=...`，那是**会话级**的，写入当前 shell 进程环境，**不会**传播到之后新启动的 CodeBuddy / WorkBuddy 进程（两者是独立进程，启动时继承的是 Windows 持久环境，而非某个已退出 shell 的变量）。
- 真正的持久用户变量需 `setx MNEMON_DATA_DIR D:\memory`（写入 `HKCU\Environment`）或注册表写入，新进程才会继承。

复核命令（在可执行的会话里）：`reg query "HKCU\Environment" /v MNEMON_DATA_DIR`。若缺失，用 `setx` 重设，并**完全重启 CB/WB**（而非仅重开会话），再于一侧 `mnemon remember`、另一侧 `mnemon recall` 实测互通。

## 5. 已部署但易忽略的前提

- CB/WB 的 `mnemon setup` hooks 与 skills 已于本次排查当日部署（`.codebuddy` / `.workbuddy` 的 `settings.json` 及 `hooks/mnemon/{prime,stop,user_prompt}.sh`），无需重跑。
- 真正互通还要求 DSH 侧也有记忆写入 `default` store（`dsh-mnemon-native` 走它）；之前建的 Hindsight body 在另一条 store，不等同于这份共享记忆。
- 修改后必须重启目标进程才能读到新环境变量——这一点与 `feb5ab22` 中「改 patch 后必须完全重启 DSH」同理。
