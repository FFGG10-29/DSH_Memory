---
id: "6c4b97c5-69a6-4c60-9291-c71326a7c6f3"
title: "Hindsight「存储异常」实为 LLM 余额耗尽导致启动失败（2026-11-02 实测）"
description: "Mnemon 面板报持久化/存储异常时，如何区分数据损坏与 Hindsight 因 LLM 402 余额不足启动失败；含证据链、token 成本核算、数据完整性核验与三种恢复选项及已失败的替代方案"
status: "active"
created_at: "2026-11-02T07:15:36.762Z"
updated_at: "2026-11-02T07:15:36.762Z"
content_hash: "7ef257d61ff5385d599d242cd625635b1967d54291bf45c2bf1703ccb234a1b8"
source_paths:
  []
session_ids:
  - "13a7964d-a9d2-4980-8034-6307140c75c0"
memory_body_ids:
  []
---

# Hindsight「存储异常」= LLM 余额耗尽，不是数据损坏

适用：Windows，DSH 桌面版 profile `desktop`，`hindsight-all 1.1.0`，Provider = Hindsight（pg0 自管内嵌 PG）。
配置真源见既有文档 `208b79a6-873b-48ab-b03f-6a9c4b2db13c`；pg0 数据目录与自启见 `246118b2-bea6-45bb-b69c-ea7b1b1e445b`；GBK banner / LLM key 必填见 `ade0758c-42fc-4ade-a26a-4cd95b513559`。本文记录的是一条**此前未覆盖的新根因**：账户余额归零。

## 症状与误判路径
用户侧只看到 Mnemon 面板报「存储异常」。真实链路是三层表象：

1. `daemon.out.log` 停在某一时刻（本次 15:01:43），**没有正常关停记录** → 易误判为「DSH 重启把子进程连带杀死」。
2. `hindsight-api.exe` 进程消失、8888 无监听，但 `postgres.exe`（5432）可能仍在 → 误判为「PG 活着、服务挂了」。
3. 重启后 Hindsight 立刻又退出，日志末尾才是真因：

```
openai.APIStatusError: Error code: 402 - {'code': 30001, 'message': 'Sorry, your account balance is insufficient', 'data': None}
ERROR:    Application startup failed. Exiting.
ValueError: LLM API key is required. Set HINDSIGHT_API_LLM_API_KEY environment variable.
```

注意：**402 与「key 缺失」两个错误会相继出现**。402 发生在启动健康探测阶段，账户无余额 → 启动失败退出；若随后用脚本重启而环境变量未带全，则表现为 key 缺失。二者都是启动阻塞，与数据无关。

## 判定顺序（可复用）
1. 先确认数据层没坏：`ls -la ~/.pg0/instances/hindsight/data`（本次 404M 完好）、`netstat -ano | findstr 5432`（PG 在监听即在跑）。
2. 直接打 Hindsight 自己的 health：`GET http://127.0.0.1:8888/health`，若返回 `{"status":"healthy","database":"connected"}` 而 Mnemon 仍报异常，问题在 Mnemon 侧重连/配置，不在数据。
3. 若 8888 不通，读 `%LOCALAPPDATA%\hindsight\daemon.out.log` **末尾 20 行**（不是开头），找 `Application startup failed`。
4. 验证 LLM 额度：`POST {BASE_URL}/chat/completions` 最小请求；返回 `code 30001 / insufficient balance` 即确诊。本次逐一实测 `Qwen/Qwen2.5-7B-Instruct`、`Qwen/Qwen3-8B`、`THUDM/GLM-4-9B-0414`、`deepseek-ai/DeepSeek-V4.1-Flash` **全部 402**，说明是账户余额整体归零，而非某个模型限制。
   补充：硅基流动旧余额查询端点 `GET /v1/user/info` 已废弃，返回 `code 20092 endpoint deprecated`，不能作为判断依据。

## 为什么额度会用完（成本核算）
- 写记忆时每条自动抽取：约 7,987 tokens/条，1430 条约 **500 万+ tokens**。
- consolidation：单批 8,000–29,000 tokens（日志实测 24,485 / 20,936 input），后台二次提炼。
- 结论：**consolidation 是最耗 token 的环节**，也是「免费额度」被吃光的主因；`Qwen2.5-7B-Instruct` 的「免费」是平台活动额度，不是永久免费。当前配置 `deepseek-ai/DeepSeek-V3.2` 为付费模型（成本更高）。

## 恢复选项
- A（最省事）：账户充值（小额即可），Hindsight 立刻可启动；同时把 `start.cmd` 的 `HINDSIGHT_API_LLM_MODEL` 降回低成本模型（如 `Qwen/Qwen3-8B`）降低日常消耗。
- B（不花钱）：换不需要余额的 LLM 源。DSH 平台自带的 `hy3`（cordis.patch.yml 中 `promos: hy3-free-trial-202608`，限时免费额度）走 DSH 内部网关，**不提供 OpenAI 兼容端点，Hindsight 接不上**；可行替代是本地 Ollama + 小模型（本机 2×4090 足够），需改 `HINDSIGHT_API_LLM_BASE_URL` 指向本地。
- C（降级）：确认 Hindsight 是否有跳过 LLM 健康探测的开关；若无，必须至少给一个可用的 LLM key 才能启动。

## 操作建议
- 恢复后 `pending_consolidation`（本次 4,676）应视为**纯后台二次提炼**，不阻塞检索；充值时先压低并发/暂停 consolidation，否则预算会被它迅速吃掉。
- 校验数据完整性的三条量（恢复后实测同一库）：`nodes 5945 / docs 1431 / links 191824`，`pending_ops 0 failed 0`；Mnemon 侧汇总为 6/6 空间 healthy、`totalInsights 6031`、`edgeCount 193647`。这些数值不对应才怀疑数据层。

## 无法在本机落地的做法（已实测失败，勿重复尝试）
- 用任务计划程序（`schtasks /create`）脱离 DSH 进程树：本会话无管理员权限，返回「拒绝访问」。替代：Startup bat + `start-hidden.vbs` 启动，并保证脚本内环境变量齐全（否则退化成上面的「key 缺失」）。
- 从 DSH 侧复用模型网关给 Hindsight：该网关不是 OpenAI 兼容端点，不可行。

## 安全提示
`start.cmd` 内含 API Key 明文，是唯一配置真源；排查时不要把 key 复制到日志、聊天或文档。
