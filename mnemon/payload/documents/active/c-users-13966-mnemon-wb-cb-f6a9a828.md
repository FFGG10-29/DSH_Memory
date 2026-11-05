---
id: "f6a9a828-e1ee-446e-b5c6-5563dc451377"
title: "修正：旧 C:\\Users\\13966\\.mnemon 库非空且含关键偏好；最终迁移策略与 WB/CB 协议分歧行"
description: "更正文档 85bf0603 中「旧 .mnemon 是空壳可安全删除」的错误；记录本次实际迁移策略、仍需复核的持久环境变量，以及写给 WorkBuddy/CodeBuddy 的协议需补的那一行分歧说明。"
status: "active"
created_at: "2026-11-01T23:38:56.931Z"
updated_at: "2026-11-01T23:38:56.931Z"
content_hash: "dd3ad4dd0d7410eb4a49ab8bca71a45a91b958fb774c48072d755d21a1604f63"
source_paths:
  []
session_ids:
  - "59173b1c-da41-4bc4-8a9c-82934e34b7ef"
memory_body_ids:
  []
---

# 修正：旧 `.mnemon` 库非空 + 最终迁移策略 + WB/CB 协议分歧行

补充/更正既有文档 `85bf0603-f2d9-4d02-bd11-bcee2aac0ba3`（Mnemon 跨工具对齐）。该文档声称旧库 `C:\Users\13966\.mnemon\data\default\mnemon.db` 是空壳（`total_insights: 0`）可安全删除——**此结论已被本 checkpoint 推翻**。

## 1. 旧库实测并非空壳（更正 85bf0603 第 3 节）

在用户于 WorkBuddy 侧用 mnemon 写入「记忆分歧」偏好后，旧库实际含 **3 条 live insights**（通过 `MNEMON_DATA_DIR` 未设时的 `mnemon status`/`log`/`show` 实测）：

| id | 类别 | 重要度 | 内容 | 处置 |
|---|---|---|---|---|
| `417b708e-7091-4eb3-8da9-9b2cbdbc07de` | preference | **5** | 每次涉及长期记忆时，存储与读取都必须使用 mnemon 技能（存储用 `mnemon remember`，读取用 `mnemon recall`/`search`），不得手动写或读 MEMORY.md 及其他文件来替代 | **已迁移**至 `D:\memory` |
| `21deb6aa-f84e-4f93-ab55-be5fae7b3dea` | preference | 4 | 每次存储/记录信息时，使用 mnemon 记忆系统（通过 `mnemon remember`/`recall` 等命令）进行持久化，而非仅依赖对话上下文 | **已迁移**至 `D:\memory` |
| `5f23d89c-5b98-4055-9e5b-8d3dfafebc2c` | fact | 3 | `hsuhbdshsdehjcbnshcfjh`（测试乱码） | 留旧库未动 |

> 注意：`mnemon show <id>` 在旧库直接跑会报 `sql: no rows in result set`（因该 CLI 默认 data-dir 已指向 `D:\memory`）；需显式 `--data-dir "C:\Users\13966\.mnemon"` 才能看到。旧库的 3 条记录是**真实用户偏好**，删除会造成数据损失——`85bf0603` 第 3 节的「可安全删除」**不适用**。

## 2. 最终采用策略（已落地）

- 将两条有意义的 preference（`417b708e`、`21deb6aa`）**迁移**进共享库 `D:\memory\data\default\mnemon.db`，新 id 分别为：
  - `fe5b764f-6916-43f5-be5b-10854c424a55`（内容同 417b708e，confidence high）
  - `eb909219-331c-4bfb-aedc-dd6483f9d692`（内容同 21deb6aa，confidence low）
- 乱码 `5f23d89c` 留在旧库，**未迁移也未删**。
- 迁移后 `D:\memory` 的 `total_insights` 从 0 → 2；DSH 侧 `recall "mnemon 技能"` 可召回这两条。
- 旧库 `C:\Users\13966\.mnemon` 因此**继续存在且仍非空**，WB/CB 在「设环境变量前启动」的进程里仍会读写它——这正是用户说的「WorkBuddy 还是认的 /13966 下面的」。

## 3. 给 WorkBuddy / CodeBuddy 的协议须补的一行（分歧 + 最终策略）

用户要求：在写给 WB/CB 的【长期记忆协议】中明确分歧与最终策略，**加一行即可**。采用文字（已写入对话交付，供反复粘贴）：

```
重要：记忆默认数据目录原本是 C:\Users\13966\.mnemon，而 DSH 的 dsh-mnemon 读的是 D:\memory；
为使三端（DSH / WorkBuddy / CodeBuddy）共享同一份记忆，最终策略是统一用环境变量
MNEMON_DATA_DIR=D:\memory 把 WorkBuddy 和 CodeBuddy 的 mnemon 指到 D:\memory\data\default
——你无需改动命令，照常调用 mnemon 即可，底层已落到共享库；
若 mnemon status 显示的 db_path 不是 D:\memory\data\default\mnemon.db，说明进程是设环境变量前启动的，请完全退出并重启本工具。
```

## 4. 仍须复核（沿用 85bf0603 第 4 节）

- 持久环境变量 `MNEMON_DATA_DIR=D:\memory` 是否真用 `setx`（写入 `HKCU\Environment`）落地，而不只是某 shell 内的 `set`/`export`（后者不传播到后续新进程）。复核：`reg query "HKCU\Environment" /v MNEMON_DATA_DIR`。注册表显示值为 `D:\memory`，但需确认来源是 `setx` 而非会话级。
- 旧库 `C:\Users\13966\.mnemon` 因历史进程仍存在；要让 WB/CB 完全落到 `D:\memory`，必须**完全退出并重启**两者，使其继承新环境变量。

## 5. 关键源路径（可见证据）

- 旧库：`C:\Users\13966\.mnemon\data\default\mnemon.db`（仍含 3 条 insights）
- 共享库：`D:\memory\data\default\mnemon.db`（含迁移后的 2 条 preference）
- WB hooks 脚本：`C:\Users\13966\.workbuddy\hooks\mnemon\{prime,stop,user_prompt}.sh`（解析 `${MNEMON_DATA_DIR:-$HOME/.mnemon}`）
- 相关文档：`85bf0603-f2d9-4d02-bd11-bcee2aac0ba3`（架构）、`feb5ab22-5f0c-4c04-88cf-3baff1838a82`（CLI 路径/patch）、`ade0758c-42fc-4ade-a26a-4cd95b513559`（Hindsight）

## 6. 待办（未在本 checkpoint 执行）

- 可选清理：将乱码 `5f23d89c` 从旧库 `forget` 掉（低风险，非必须）。
- 把含分歧行的协议文案存成桌面文件供反复粘贴（用户曾问，未执行）。
- 重启 WB/CB 后做三端互通实测（`remember` 一侧 → `recall` 另一侧）。
