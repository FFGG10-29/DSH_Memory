---
id: "2213e84a-747b-4b4d-9481-801dba642884"
title: "FCore fcore-web：本地仓库与服务器部署拓扑及一致性结论"
description: "服务器 /opt/fcore/fcore-web 是已部署副本（非 git 库），本地 main（9079d9f）为权威且与/领先于服务器；服务器端 admin/fcc.html 是无人引用的陈旧孤儿文件。避免重复全量 SSH 比对。"
status: "active"
created_at: "2026-11-02T11:35:14.789Z"
updated_at: "2026-11-02T11:35:14.789Z"
content_hash: "44b13537c71d36f02f2ce476e57e531376dcbf98a295d301a6507e7b45a3dd0c"
source_paths:
  []
session_ids:
  - "37812545-1efc-4380-8a6f-5c51e97b9687"
memory_body_ids:
  []
---

# FCore fcore-web：本地仓库与服务器部署副本的关系（2026-10-29 实测结论）

## 背景与一次性决策价值

2026-10-29 对 `D:\FCore`（FCore 火核调校官网/运营平台，Java 17 + Spring Boot 3.3.5 + Thymeleaf 3）做了本地代码 vs 服务器部署副本的字节级核对。结论对后续任务有用：**不要重复做昂贵的全量 SSH 文件比对**；本地 `main` 是权威源且已与/领先于服务器运行代码一致。

## 部署拓扑

- 服务器：`root@39.105.168.142`，运维私钥 `fcore_bot_ed25519`（项目文档记录；密钥本身已 gitignore，勿入库）。
- 权威运行源码位置：`/opt/fcore/fcore-web`。**该处不是 git 仓库**，是部署副本。
- Git 远端：`github.com/FFGG10-29/fcore-web`（origin/main）。本地含 `AstrBot`、`NapCatQQ` 两个 submodule（有未提交的 modified）。
- 当前工作目录 `D:\FCore`。

## 一致性核对结论（全量、按归一化去 CRLF/尾随空白）

- 所有 `src/main/java`、`src/main/resources/templates`（除 fcc.html）、`static`、`docker`、`tools`、`pom.xml`、compose/Dockerfile：本地与服务器**逐字节一致**（归一化后）。
- 代表性：`AdminAiController.java` 两侧 md5 均为 `e9eb39cb…`；`PanelGatewayService.java` 仅行尾尾随空白差异，内容一致。
- 方向：服务器文件 mtime 顶到 2026-10-29 ~12:46（最近一次部署）；本地 HEAD commit `9079d9f` 时间 2026-10-29 16:45（更新），且其跟踪文件与服务器运行代码一致。
- `.gitignore`：本地**领先**（已含 `MEMORY.md`、`deploy/`，服务器的旧版没有）。
- `README.md`：本地领先（622 行整合「唯一文档」vs 服务器 154 行拆分旧版）。

## 服务器端唯一异常：admin/fcc.html

- `src/main/resources/templates/admin/fcc.html` 只存在于服务器已部署副本，本地 HEAD 无此文件。
- 历史：本地 commit `b009c32` 曾新增该 FCC 面板模板；后在 `e5ce511`（三模块免密单端口接入 + 统一 AI 集成页改造）中删除，并入 `ai.html`/`ai-console.html`。
- 当前**没有任何 controller 引用 `admin/fcc` 视图**，服务器上的 `fcc.html` 是陈旧孤儿文件，可忽略/清理，不应拉回本地。

## 敏感/仅服务器文档

`ssh.md`、`FCC-接入文档.md`、`MEMORY-2026-10-28.md`、`dafeiyu.md`、`CLI.md`、`DEPLOY.md`、`部署.md` 为服务器端文档；其中 ssh.md / FCC-接入文档 / MEMORY-* 含密钥凭据且已 gitignore，不入库。

## 操作建议

未来若确认服务器含更新的工作，先确认是否在 `/opt/fcore/fcore-web` 之外（其他部署路径/分支/Docker 容器）；否则可视为与本地 `main` 齐平或落后。
