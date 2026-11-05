---
id: "ade0758c-42fc-4ade-a26a-4cd95b513559"
title: "Hindsight 守护进程在 Windows 上起不来：GBK banner 崩溃与必填 LLM 配置"
description: "hindsight-all 1.1.0 已安装但 8888 不监听的实测根因（GBK 编码崩溃、HINDSIGHT_API_LLM_API_KEY 必填）与验证手法"
status: "active"
created_at: "2026-11-01T22:37:21.273Z"
updated_at: "2026-11-01T22:37:21.273Z"
content_hash: "3cee79454bcaa6b5f627aa54b1516f1fd2bc9445abe86a85294611635252f11d"
source_paths:
  []
session_ids:
  - "702fe38b-ba04-42af-ac4b-2f9838923788"
memory_body_ids:
  []
---

# Hindsight 守护进程在 Windows 上起不来

适用环境：Windows，DSH 桌面版 profile `desktop`，`hindsight-all 1.1.0`（`D:\Python312\Scripts\hindsight-api.exe`）。
配套背景见既有文档 `feb5ab22-5f0c-4c04-88cf-3baff1838a82`（同一次排查里的 Mnemon CLI 与 WorkBuddy provider 部分）。

## 症状
- `dsh-mnemon-provider-hindsight` 面板显示「✅ 已装」，但 `127.0.0.1:8888` 探测始终 `000`，无 LISTENING。
- 曾有一个 `hindsight-api.exe` 进程（PID 15316，由 WorkBuddy 的 bash 拉起）常驻：1 个线程、CPU 0、端口零监听——属于**卡死而非运行**，看进程存在不等于服务可用。
- 插件侧的「已装」判定只检查 exe 是否存在，不探测端口，因此会给出误导性的通过状态。

## 两个真实启动阻塞（依次出现）
1. `UnicodeEncodeError: 'gbk' codec can't encode character '\u2580' illegal multibyte sequence`
   位置 `hindsight_api/banner.py` 的 `print_banner()`：启动时打印 ASCII/Unicode logo，中文 Windows 控制台默认 GBK 直接抛错。
   规避：启动前设 `PYTHONUTF8=1`（或 `PYTHONIOENCODING=utf-8`）。
2. `ValueError: LLM API key is required. Set HINDSIGHT_API_LLM_API_KEY environment variable.`
   来自 `hindsight_api/engine/memory_engine.py` 的 `MemoryEngine.__init__`：它必须有一套 LLM 才能抽取记忆，缺 key 直接拒绝启动。

## 需要的环境变量（源码常量）
`HINDSIGHT_API_LLM_PROVIDER` / `HINDSIGHT_API_LLM_MODEL` / `HINDSIGHT_API_LLM_BASE_URL` / `HINDSIGHT_API_LLM_API_KEY`
（另有 `_MAX_CONCURRENT`、`_MAX_RETRIES`）。嵌入侧为 `HINDSIGHT_API_EMBEDDINGS_PROVIDER`、`_LOCAL_MODEL`、`_LOCAL_FORCE_CPU`、`_QUERY_PREFIX`、`_PASSAGE_PREFIX`。
即任何 OpenAI 兼容端点（DeepSeek 官方 key，或 WorkBuddy 插件自带的本地 shim，后者端口动态、需先取 base_url 与 key）都能满足。

## 排查手法（可复用）
- 判定守护进程是否真的活着：先看端口（`netstat` 找 LISTENING），再看进程 CPU/线程数，最后看父进程与启动命令行；三者任一为假就别信「已装」。
- 前台手动跑一次 exe 并抓 stderr，比读日志更快定位 init 阶段异常；`hindsight` 的日志在 `C:\Users\13966\AppData\Local\hindsight\daemon.err.log` / `daemon.out.log`。
- GBK 类 `UnicodeEncodeError` 出现在 `print` 上时，优先当作编码问题而非业务故障，改环境变量再试。

## 当前状态与决策点
Hindsight 保持未启用状态，不影响 Mnemon（Mnemon 侧已确认 healthy：v0.2.13、2 个记忆空间 active+healthy）。是否配置 Hindsight 取决于为它选定 LLM 来源，尚未落地。
