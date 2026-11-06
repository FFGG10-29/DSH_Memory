---
id: "067366a7-7463-45ee-b255-52154f183b51"
title: "Mnemon insights → SuperBrain brain_snapshot JSON 转换方案（2026-11-06 实测）"
description: "把 DSH Mnemon insights 整理成 SuperBrain brain_snapshot JSON：格式规格、category→memory_type 映射、pad/tier/ts_ms 补全规则、软删处理、脚本与产物路径（2026-11-06 实测 109 条）。"
status: "active"
created_at: "2026-11-05T21:42:50.446Z"
updated_at: "2026-11-05T21:42:50.446Z"
content_hash: "24d3eb6c2901d5b4c829552ddcb30364ee89abfe1681047a8f34aa48cfd84a4e"
source_paths:
  - "pgwork/migrate/build_snapshot.py"
session_ids:
  - "a3ab7854-ee7f-4c3d-818e-987eeb75c81e"
memory_body_ids:
  []
---

# Mnemon insights → SuperBrain `brain_snapshot` JSON 转换（2026-11-06 实测）

关联既有文档：`85bf0603-f2d9-4d02-bd11-bcee2aac0ba3`（Mnemon 三个 data store 与 `D:\memory` 对齐）、`09c331e0-b1df-4617-aca7-d5929f0f0260`（Hindsight 批量导入）、`f6a9a828-e1ee-446e-b5c6-5563dc451377`（旧 `.mnemon` 库更正）。注意：**SuperBrain 与 Hindsight 是两套不同的系统**；上述文档讲 Mnemon/Hindsight，本文记录的是把 Mnemon insights 整理成 SuperBrain 快照 JSON 的格式转换，内容不重叠。

## 1. 任务边界（避免重复踩坑）

用户给出 `C:\Users\13966\Desktop\brain_snapshot_20261106_0531.json`，声明「这是新记忆单元的标准格式」，要求把之前的（DSH Mnemon）记忆按此格式梳理出来。

- 交付物是**一份符合该格式的 JSON 快照文件**，不是往 SuperBrain 的 SQLite / `neurons` 表写数据，也不是设计双向迁移方案。
- 最初排查曾去读 SuperBrain `D:\Super-Brain\Data\relational.db`（`neurons` 表含 payload / namespace / memory_type / PAD / 强度 / 稳定性等，实测 68 条；另有 `C:\Users\13966\AppData\Roaming\super-brain\data\relational.db` 仅 2 条）与写入接口，方向偏离。用户明确只要「按格式填进去」。后续如再做，直接产出 JSON 即可。

## 2. 目标格式（参考 `brain_snapshot_20261106_0531.json`，963 行 / 24943 字节）

顶层 6 个键：`engine_health`、`memory_stream`、`pad_axis`、`synapse_topology`、`tier_distribution`、`sync_status`。

- 记忆单元（`memory_stream.items[]`）字段固定为：`id / content / memory_type / tier / pad[3] / ts_ms`。
- `engine_health`（6 个引擎及计数）、`synapse_topology`、`sync_status` 属于 SuperBrain 自身运行状态 → **原样保留**。
- `memory_stream`（`count` + `items`）、`pad_axis`（`summary` + `series`）、`tier_distribution`（`tiers` / `pyramid` / `total`）→ **按新记忆重建**，三者计数须一致。
- 参考快照实测：`memory_stream.count=55`（items 截断 20）、`pad_axis.samples=67`、`series=67`、tier 仅 `buffer`、`pyramid.raw`；`memory_type` 取值含 fact / emotion / scenario / profile / code。
- `pad_axis.series[]` 每条字段：`ts_ms / neuron_id / agent_id / p / a / d / source`；`pad_axis.summary` 含 `samples / pad / peak`。

## 3. 数据源（Mnemon `insights`）

- 库：`D:\memory\data\*\mnemon.db` 的 `insights` 表；5 个 space：`3d0a3580…`(33) / `81e1734c…`(40) / `aaa5eea1…`(3) / `dad8a509…`(34) / `default`(24)。
- 列：`id, content, category, importance, tags, entities, source, access_count, stored_at, created_at, updated_at, deleted_at, last_accessed_at, embedding, effective_importance`。
- 合计 **134** 条，`deleted_at` 非空的软删 **25** 条 → **109 条 live**（`default` 的 24 条里 21 条已软删，仅 3 条有效，故不能只看总数）。
- 分布：`category` = fact 82 / context 18 / decision 12 / insight 11 / preference 8 / general 3；`source` = agent 68 / user 33 / external 33；`content` 共 55850 字符；`created_at` 范围 `2026-11-01T22:31:08Z ~ 2026-11-02T23:51:09Z`。（原库曾出现 GBK 乱码，需按 UTF-8 正确解码。）

## 4. 映射规则（核心可复用知识）

| Mnemon | → SuperBrain | 规则 |
|---|---|---|
| `category=preference` | `memory_type=profile` | |
| `category=fact` / `general` | `memory_type=fact` | |
| `category=context` | `memory_type=scenario` | |
| `category=insight` / `decision` | `memory_type=code` | |
| `id` | `id` | 直接用原 UUID |
| `content` | `content` | 原样 |
| — | `tier` | 统一 `buffer` |
| — | `pad` | profile `[0.8,0.5,0.7]`；fact `[0,0,0]`；scenario/code `[0.9,0.8,0.7]`（按参考快照同类记忆取值补全） |
| `created_at` | `ts_ms` | ISO → epoch 毫秒 |
| 其余元数据 | 另存 | `category / importance / tags / entities / source / _space / created_at` 等全部保留到第二个文件，不丢 |

- `pad_axis.series` 由每条记忆的 `ts_ms` / `neuron_id(=id)` / `p,a,d` 重建；`agent_id` / `source` 无对应值，按参考快照惯例补。
- 输出分布：fact 71、code 22、scenario 11、profile 5（共 109）；`ts_ms` 范围 `1793572268000 ~ 1793663469000`。

## 5. 脚本与产物

- 转换脚本：`pgwork/migrate/build_snapshot.py`（工作区 `D:\DeepSeekHarness`），遍历各 space 的 `insights`、过滤软删、按上表映射并重建三个计数区块。
- 产物（均在桌面）：
  - `C:\Users\13966\Desktop\brain_snapshot_from_mnemon_20261106.json`（162352 字节，主交付，已 present）
  - `C:\Users\13966\Desktop\mnemon_insights_full_20261106.json`（182051 字节，含全字段元数据，已 present）

## 6. 验证结果

- 顶层键集合与参考快照一致（True）；记忆单元字段集合一致：`{'id','content','memory_type','tier','pad','ts_ms'}`。
- `memory_stream.count=109` 且 `items=109`；`tier_distribution.total=109`；`pad_axis.samples=109`、`series=109`。
- `engine_health` 原样保留 = True；`sync_status` 原样保留 = True。
