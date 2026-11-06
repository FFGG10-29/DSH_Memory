---
id: "0a52656d-ce5b-4a33-b916-e95609533612"
title: "super-brain-memory（超级大脑）MCP 接入契约：X-Super-Brain-Bridge 鉴权 + streamable-http 握手"
description: "Empirically verified integration contract for the external 超级大脑 super-brain.exe streamable-http MCP bridge at 127.0.0.1:8766: correct auth header, mandatory MCP session handshake, tool surface, and the known recall-hang / gateway-restart issues. Distinct from dsh-memory-gateway."
status: "active"
created_at: "2026-11-05T23:01:57.878Z"
updated_at: "2026-11-05T23:01:57.878Z"
content_hash: "5ce255d281a9fc0b1741dfaf4d6e4f754ec54ecab65ca256b3e1ec964b20b09c"
source_paths:
  - "pgwork/migrate/http_closed_loop.py"
  - "pgwork/migrate/http_save.json"
  - "pgwork/migrate/http_recall.json"
session_ids:
  - "5aecfd6c-a667-4efe-bfe3-0351e8b7c535"
memory_body_ids:
  []
---

# super-brain-memory（超级大脑）MCP 接入契约（实证）

适用：Windows 桌面，外部 MCP 服务「超级大脑 / Living Memory v2.1」（进程 `super-brain.exe`，可执行文件 `D:\Super-Brain\super-brain\super-brain.exe`）。目标是把它的 streamable-http 桥接 `http://127.0.0.1:8766/mcp` 接入 DSH。依据：本 checkpoint 内一组 curl / Python 探针实机验证（用户亦明确指出头名）。

> 区分：这是「超级大脑 super-brain.exe」自带的 MCP 服务，**不是** `dsh-memory-gateway`（见 `a81084df-258d-4c6e-a89a-ee4ae2d8b928`，走 `127.0.0.1:8890` + Bearer + 工具 `memory_*`）。两者端口、鉴权、工具面完全不同，勿混淆。

## 服务端契约（实证）
- `serverInfo`: name `super-brain-memory`, version `2.2`；`protocolVersion 2025-06-18`。
- `tools/list` 暴露 6 个工具：`save_memory`、`recall_memory`、`timeline_query`、`profile_read`、`conflict_report`、`health_check`。`save_memory` 入参 `content`(必填)/`agent_id`；`recall_memory` 入参 `query`(必填)/`agent_id`/`top_k`。
- `initialize` 响应头下发 `Mcp-Session-Id`，响应体 `Content-Type: application/json; charset=utf-8`。底层 Server 为 `BaseHTTP/0.6 Python/3.12.10`。

## 鉴权头（关键，用户明确指出 + 实机确认）
- 正确头：`X-Super-Brain-Bridge: <token>`，**无** `Bearer` 前缀。
- 错误写法一律 401「MCP 令牌无效」：`Authorization: Bearer`、`X-MCP-Token`、`X-Api-Key`、无鉴权头；给 `X-Super-Brain-Bridge` 值加 `Bearer ` 前缀同样 401。（用户贴的示例 JSON 用了 `Authorization: Bearer`，是错的。）只要 `X-Super-Brain-Bridge` 正确，额外附带一个 `Authorization: Bearer` 头仍可通过。
- token 会**轮换**：checkpoint 时旧 token 已作废，需改用当前有效 token。具体值属凭据，见用户提供的接入 JSON 及配置文件，**不在此记录**。
- 正确配置已写到 `C:\Users\13966\Desktop\super-brain-mcp-http.json`（`headers` 内仅放 `X-Super-Brain-Bridge`）。

## streamable-http 必须完整握手，否则 tools/call 挂起（根因）
裸调 `tools/call`（不带 session）会超时/连接重置（curl 显示 `[000]`、30–120s `TimeoutError`、`WinError 10054`、远程主机强迫关闭连接）。正确顺序（已在 `http_closed_loop.py` 验证）：
1. `POST initialize` → 从响应头取 `Mcp-Session-Id`。
2. `POST notifications/initialized`（带该 session）→ 202，空体。
3. 之后每个 `tools/call` 都带 `Mcp-Session-Id` 头。

带 session 后 `health_check` 约 12s 返回 200（六引擎全绿）、`save_memory` 200 落库（`applied:true`）；`tools/list` 与 `initialize` **不带 session 也能秒回**——这正是早先误判「服务全功能可用」的原因。

## 当前已知问题（checkpoint 时状态，非 DSH 配置问题）
- `recall_memory` 在 stdio 与 HTTP **两条通道都挂起**（60–120s 超时 / 连接重置），而握手 / `tools/list` / `save_memory` / `health_check` 全绿。判断为桌面端 `super-brain.exe` 自身检索/重排路径卡死。当天更早时 stdio 完整读写闭环曾通过（召回三通道命中 score 2.94），现退化为「能写不能查」。
- HTTP gateway（8766）反复重启、PID 频繁变化、端口时有时无、一度 `Not Responding`、出现双 PID 同时 LISTENING，导致 `mcp_connector_import_json` 报「目标服务拒绝连接」；stdio 连接不受影响、稳定可用。
- 观察到两套数据目录：`C:\Users\13966\AppData\Roaming\super-brain\data\*`（早期，neuron 极少）与 `D:\Super-Brain\Data\*`（后期，neuron 增长到 90 条），疑似重启后切库；排查数据一致性时需注意 `health_check` 回报的实际 `path`。

## 复用要点
接入或复测时：先用 `X-Super-Brain-Bridge` + 有效 token 走完整三步握手再调工具；若只有 `recall` 卡住而其余正常，优先怀疑后端检索路径而非鉴权/配置；不要把 `tools/list` / `initialize` 秒回当作全功能可用；浏览器/导入工具对端口重启敏感，失败后先 `netstat` 确认 LISTENING 再重试。

测试脚本产物（工作区内）：`D:\DeepSeekHarness\pgwork\migrate\http_closed_loop.py`、`http_save.json`、`http_recall.json`。
