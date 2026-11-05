---
id: "208b79a6-873b-48ab-b03f-6a9c4b2db13c"
title: "Hindsight 守护进程接硅基流动并接入 mnemon 的可用配置（Windows）"
description: "Hindsight 用 SiliconFlow(DeepSeek-V3.2 + bge-m3 + rrf) 跑通的完整启动配置、自启方式、mnemon 持久化策略接入与实测验证步骤"
status: "active"
created_at: "2026-11-01T22:45:22.070Z"
updated_at: "2026-11-01T22:45:22.070Z"
content_hash: "e30eb77ff2076394cedaf26439aac63ec3808f52bbbdf36433ba954a4e9aa72a"
source_paths:
  []
session_ids:
  - "0c241bb2-9c50-40c7-9e10-ed0ad6c0eaff"
memory_body_ids:
  []
---

# Hindsight × 硅基流动：可用配置与 mnemon 接入

适用：Windows，DSH 桌面版 profile `desktop`，`hindsight-all 1.1.0`。
前置排查（GBK banner 崩溃、LLM key 必填）见既有文档 `ade0758c-42fc-4ade-a26a-4cd95b513559`；本文只记录**跑通之后**的配置与验证手法。

## 结论
硅基流动（SiliconFlow）可作为 Hindsight 的 LLM + Embeddings 单一来源，全部走 OpenAI 兼容协议，无需本地下载模型。
实测：`/health` 200，写入 bank `dsh` 一条记忆后 consolidation 完成，`total_nodes: 2`、`total_links: 1`、`failed_operations: 0`。

## 关键配置项
| 项 | 值 | 原因 |
| --- | --- | --- |
| LLM | `openai` 协议 → `https://api.siliconflow.cn/v1`，模型 `deepseek-ai/DeepSeek-V3.2` | 对话/抽取可用；`GET /v1/models` 返回 98 个模型 |
| Embeddings | `openai` 协议 + `BAAI/bge-m3`（1024 维） | 绕开本地嵌入模型下载 |
| Reranker | `rrf` | 默认 `local` 会去下载 cross-encoder，改 rrf 避免 |
| 编码 | `PYTHONUTF8=1` | 修掉 `banner.py` 的 GBK `UnicodeEncodeError` |

环境变量名（源码常量）：`HINDSIGHT_API_LLM_PROVIDER` / `_MODEL` / `_BASE_URL` / `_API_KEY`，嵌入侧 `HINDSIGHT_API_EMBEDDINGS_PROVIDER` 等；API key 只写在启动脚本里，不要复制到文档或聊天记录。

## 启动与自启（已统一，三处不再各写一套）
- `C:\Users\13966\.dsh\hindsight\start.cmd` — 全部环境变量 + 启动 exe，是唯一真源。
- `C:\Users\13966\.dsh\hindsight\start-hidden.vbs` — 隐藏窗口调用 start.cmd。
- Startup 的 `hindsight-autostart.bat` — 只负责调用上面两个；旧版本是 `Qwen/Qwen2.5-7B-Instruct` 且无 embeddings 配置，已替换。重复的快捷方式（`.lnk`）已删除。

## 两个易踩的运维陷阱
1. **进程存活 ≠ 服务可用**：曾出现 PID 15316 常驻但 1 线程、CPU 0、8888 零监听（卡死）。判定顺序：端口 LISTENING → 进程 CPU/线程 → 父进程与命令行。
2. **被 shell 作业连带杀死**：前台/作业方式拉起的 PID（如 16824）会在命令结束时被杀。必须用 `start /min cmd /c ...`（配合 VBS/Startup）脱离作业，再确认 health 200 且作业结束后仍存活。

## 验证配方（可复用）
1. `GET /health` 应 200 且 `database: connected`。
2. `GET /v1/default/banks/<bankId>` 看 `total_nodes` / `total_links` / `failed_operations`；写入测试记忆后等 consolidation，日志中应出现 `CONSOLIDATION COMPLETE` 与真实 token 计数。
3. 日志位置：`D:\Tools\hindsight-api.log`（守护进程输出），以及 `%LOCALAPPDATA%\hindsight\daemon.*.log`。

## mnemon 侧接入
在 `C:\Users\13966\.dsh\profiles\desktop\cordis.patch.yml` 的 `- id: mnemon` → `config.persistenceStrategy`：
- `rules.allowedProviderIds: [mnemon-native, hindsight]`
- `providerConnections.hindsight: { endpoint: http://127.0.0.1:8888, bankId: dsh, budget: mid }`

注意：**配置文件只在 DSH 启动时读取**。改完后运行态仍是旧值（`allowedProviderIds` 还是 `[mnemon-native]`），必须完全退出再启动；重启后 设置 → Mnemon → 持久化策略 里应能看到 Hindsight 且端点已填。

## 性能与调优
DeepSeek-V3.2 做 consolidation 单次约 16 秒（输入约 4355 tokens，输出约 111）。日常可用；嫌慢可换 `Qwen/Qwen3-8B` 一类更快模型，只改 `start.cmd` 里的 `HINDSIGHT_API_LLM_MODEL`。
