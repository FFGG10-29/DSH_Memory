---
id: "06440146-da9d-466d-b1d8-046b23032dde"
title: "Hindsight 零成本可用配置：DSH 免费转发 LLM + 本地 bge-m3（D 盘模型）与三个诊断陷阱"
description: "硅基流动余额耗尽后，Hindsight 改用 DSH our-free-model 免费转发（openrouter/free）+ 本地 CPU bge-m3 的完整落地配置、验证结论，以及 HF_HUB_OFFLINE、bash 内联中文 JSON、初始化超时三个易致误判的陷阱"
status: "active"
created_at: "2026-11-02T09:25:20.606Z"
updated_at: "2026-11-02T09:25:20.606Z"
content_hash: "4523aae1c0336d207bd66e51cddbd8c8f407f4e8165b5478d383a6131156243d"
source_paths:
  - "pgwork/q_cn.json"
session_ids:
  - "ad2231d7-1225-49c9-9df7-0ab6aa99f46e"
memory_body_ids:
  []
---

# Hindsight 零成本可用配置（2026-11-02 落地）

适用：Windows，DSH 桌面版 profile `desktop`，`hindsight-all`（`hindsight-api.exe`），Provider = Hindsight（内嵌 pg0 PG）。
前置与本条排查链：GBK banner / LLM key 必填见 `ade0758c-42fc-4ade-a26a-4cd95b513559`；原硅基流动配置见 `208b79a6-873b-48ab-b03f-6a9c4b2db13c`；余额耗尽（402）诊断见 `6c4b97c5-69a6-4c60-9291-c71326a7c6f3`；pg0 数据与自启见 `246118b2-bea6-45bb-b69c-ea7b1b1e445b`。
本文覆盖**硅基流动余额耗尽之后**的新方案，取代 `208b79a6` 里的 LLM/Embeddings 来源（其余自启、验证手法仍适用）。

## 结论：LLM 与 Embedding 都改成零 API 成本

| 项 | 旧（已失效） | 现用 |
| --- | --- | --- |
| LLM | 硅基流动 `deepseek-ai/DeepSeek-V3.2` | DSH 插件 `our-free-model` 免费转发 `http://127.0.0.1:18899`，模型 `openrouter/free` |
| Embeddings | 硅基流动 `BAAI/bge-m3` | **本地 CPU** 跑 `BAAI/bge-m3`（1024 维） |
| 模型缓存 | C 盘 HuggingFace/torch 缓存 | `D:\AIModels\huggingface`、`D:\AIModels\torch`（约 9.7G） |

实测终态：`/health` 返回 `{"status":"healthy","database":"connected"}`；`Connection verified: openai/openrouter/free`；`local provider initialized (dim: 1024, device: cpu)`；`Application startup complete`；Mnemon 侧 v0.2.13、6 空间全 healthy，聚合 6056 条记忆 / 193743 边。

## 免费 LLM 转发的由来与取舍

- 转发能力来自 DSH 自带 `our-free-model` 插件：在 `settings.json` 打开 `forward.enabled` 后，插件自行生成 key 并存于 `llm.env`（不把 key 复制进文档或聊天）。
- 插件提供约 29 个免费模型，逐个实测后只有 `openrouter/free` 能直接跑通；其余多数报「需要 Bun 运行时」或已被限流。换模型前先做一次最小 `chat/completions` 实测，不要按列表假设可用。
- 代价：免费转发会 `TimeoutError [asyncio.CancelledError]`（日志可见），重试即可；不会产生费用。

## 环境变量落点

- 模型目录设为**用户级环境变量**：`HF_HOME` / `HF_HUB_CACHE` / `TRANSFORMERS_CACHE` / `SENTENCE_TRANSFORMERS_HOME` / `TORCH_HOME` → D 盘。
- `%USERPROFILE%\.dsh\hindsight\start.cmd` 里再显式设一遍，不依赖继承（该文件仍是唯一真源，VBS 与 Startup 只调用它）。
- `HINDSIGHT_API_MODEL_INIT_TIMEOUT` 从默认 300s 提到 **1200s**：bge-m3 首次下载（2.27G）会超过 300s 而被判超时。

## 三个曾经导致错误结论的陷阱

1. **`HF_HUB_OFFLINE=1` 反而破坏启动**。离线模式下 transformers 的 snapshot 解析找不到权重，加载失败；权重文件此前还是 `.incomplete`（缓存残缺）。去掉 `HF_HUB_OFFLINE` 后联网校验一次即可命中本地缓存、秒级完成。`start.cmd` 第 40 行已注明原因并移除该变量。
   → 判据：模型「下载过」不等于「缓存完整」，先查 `.incomplete` 文件再谈离线。
2. **bash 内联中文 JSON 会让请求体解析失败**。表现是 `{"detail":"There was an error parsing the body"}`，中文 query 一律 0 命中，而英文 query 命中 98–101 条 — 极易误判成「bge-m3 中文不生效」或「FTS 没分词」。把 JSON 写进文件再 `curl -d @file`，同一中文 query 命中 61 条。**这是测试方法问题，不是服务 bug。**
   → 判据：中英文命中率出现「全有/全无」级差异时，先怀疑自己传参编码，再怀疑模型。
3. **psql 直接传中文报 `invalid byte sequence for encoding "UTF8": 0xb7`**。改为把 SQL 写进 `.sql` 文件再执行。

## 复核用的证据链（可复现）

- 向量同源性：`cos(库中存储向量, 本地 bge-m3 编码同一文本) = 0.993`，`cos(查询"肥鱼", 库中向量) = 0.556`，全部 5967 条均为 1024 维非零 → 写入与查询共用同一模型，存储层完好。
- 中文全文检索本身确实弱：`to_tsvector('simple','肥鱼很可爱')` 整句成一词，`textsearch_to_tsquery` 对中文不分词，`'肥鱼'` 匹配 false；召回可用性依赖向量支路，不依赖 FTS。
- recall 的正确 schema：`query` 是**顶层字段**（另有 `types` / `budget` / `max_tokens` / `prefer_observations`）。
- 空间 ID 会随 DSH 重启重新注册而变化：旧 id 报 `unknown memory space` 属正常；注册表文件中新建的 "bot" 空间取代了旧「关于BOT聊天记录」，两者指向同一 bankId `dsh`。未 pinned 的空间会被 `Recall` 拒绝（`outside pinned Source view`），需先在记忆视图里固定。
- 调试脚本与临时文件落在 `D:\DeepSeekHarness\pgwork\`（`q_cn.json`、`q*.sql`、`cmp.py`、`one_emb.csv`）。

## 遗留与注意事项

- `consolidation_pending` 曾达 4642（后台把原始事实二次提炼为 observation），单条约 8–26 秒，跑完需十几小时；不阻塞检索，用免费模型不再烧钱。想降负载可调 `HINDSIGHT_API_WORKER_MAX_SLOTS` 或不触发。
- 磁盘卫生：迁移后 C 盘 `.cache` 从 664M 降到 1.3M，符合「内容存 D 盘、C 盘不留临时文件」的既有约定；复核时顺手 `du` 一下 C 盘缓存目录。
