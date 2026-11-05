---
id: "cfdc114c-90b6-40a1-a0ce-fb527fbd8b7f"
title: "暗黑神王：PanelsV4 21 页 UI 铁律重构（分派接入、两处运行时崩溃、冒烟验证与发布）"
description: "《暗黑神王》新建 PanelsV4.lua 按 5 条 UI 铁律重构 21 个页面：结构范式、podium/页签两处崩溃根因、37 页×子页签冒烟验证流程、TEMP 块还原与构建发布。"
status: "active"
created_at: "2026-11-04T17:21:17.733Z"
updated_at: "2026-11-04T17:21:17.733Z"
content_hash: "611aec7a521578e28b4435b160197ed46ccd78de8f9453451a300207892a08cb"
source_paths:
  - "scripts/UI/PanelsV4.lua"
  - "scripts/UI/Panels.lua"
  - "scripts/main.lua"
  - "tools/patch_main_v4.py"
  - "tools/fix_v4_war_podium.py"
  - "tools/clean_main_v4.py"
session_ids:
  - "13bf5fe9-ab21-4220-93ce-2d8e374ef361"
memory_body_ids:
  []
---

# 暗黑神王：PanelsV4 21 页 UI 铁律重构

> 承接 `dde917f5-af69-4ad4-aff7-42276c7a4c67`（P11 MapV2 单页重构，确立了本项目的「早分派表 + 临时冒烟 + validate + push/build」范式）。本文记录该范式一次性铺开到全部剩余页面的一次落地。

## 适用环境
- 项目：TapTap Maker 游戏《暗黑神王》，源码根 `D:\workbuddy\_taptap_src`（工作目录 `D:\workbuddy\TapTap游戏开发`），入口 `main.lua`，竖屏 1080×1920。
- 引擎：UrhoX + `urhox-libs/UI`（Yoga Flexbox + NanoVG）。
- 产物：新建 `scripts/UI/PanelsV4.lua`（3911 行，全中文注释），`scripts/UI/Panels.lua`（2300 行）注册并接入统一分派。
- 提交：`724f1cb`（push 成功）；远程构建 submit `dd0fbfa`，构建成功，`preview_refresh` 200。

## 结构范式（每页同构）
- **入口**：`Panels.lua` 的 `V2PAGES`/分派表里登记新 key，早于旧 `P.BuildXxx()` 分支返回，旧实现自然失效（同 P11 的 `V2PAGES` 机制）。
- **底栏**：统一组件 `bottomNav`，首格固定【返回】；每格 `flexGrow=1` + `flexBasis=0`（+ `fontSize=11`）才不会被文字挤压截断。
- **详情**：一律走底部半屏抽屉 `V2.OpenSheet`，不做页面内嵌套滚动（抽屉 ScrollView 与页面 ScrollView 嵌套易出错）。
- **数据可视化**：所有百分比改「发光进度条」，所有规格大数字走 `bigNumber`（粗体＋描边＋底部阴影），替代原来的 `T.StatRow` 纯文字行。
- **卡片化/图标化**：原先纵向长文列表改成 N 列网格卡片（成长总览 28 条养成线 → 4 列网格；功法 17 种 → 4 列图标格；家园 5 列等），未解锁项用灰罩/剪影。
- **看板化**：榜单类页面用 `podium`（前三名巨像＋皇冠）替代文字排行榜。

## 两处运行时崩溃（根因与修法，可复用）
1. **`Panels.lua:1281` 角色页页签越界**：`P.titleLabel:SetText("角色 · " .. ROLE_TABS[idx])`，`ROLE_TABS` 只有 4 项而 `idx` 可能超界 → `attempt to concatenate a nil value (field '?')`。修法：取 `P.subTab["role"]` 后**钳制**到 `1..#ROLE_TABS`。
2. **攻城区间格式错**：`string.format("%d 次攻城", tostring(...))` —— `%d` 收到字符串。修法：改 `%s`。
3. **podium 参数形状不匹配**（同页，被 pcall 抓到）：榜单把 `{name, power}` 数组直接喂给 `podium`，内部 `string.format("%.2f", v)` 收到 table/nil 崩溃。修法：映射成 `{name=..., value=...}` 再传入；`podium` 现有调用点参数名有 `list` / `rankList` / `taxList` 三种，改前需全量 grep 确认签名。

> 关键教训：临时冒烟块要用 `pcall` 包住每页构建并 `print("[TEMP-V4] FAIL page=" .. ...)`，否则页面构建失败被引擎静默吞掉，只能看到「PASS 但没有页面」；报错文本要从 `runtime.log` 里 grep `TEMP-V4] FAIL` 才拿得到。

## 验证流程（本次实测有效）
1. 用 Python 一次性补丁脚本改 `main.lua` 注入 TEMP 块（`tools/patch_main_v4.py` / `patch_main_v4_diag.py`），并有 `restore_main_v4.py` / `clean_main_v4.py` 负责还原与清残留。
2. 冒烟覆盖 **37 个页面 × 每页 1~5 个子页签**，每页 `Panels.Rebuild` 后 `Panels.Close()`，`FAIL` 计数必须为 **0**。
3. 断言「PanelsV4 真被加载」：`runtime.log` 里应出现 `Loaded Lua script UI/PanelsV4.lua`（避免假通过）。
4. 还原 `main.lua` 后再跑一次 pristine validate：`PASS` + 60 帧 + `{"lua_errors":0,"resource_errors":0,"engine_errors":0,"total_errors":0}`；并 grep 确认 TEMP 残留为 0，同时保留 `if TEST_PANEL then OpenPanel(TEST_PANEL) end`。
5. 最后 `git push` + Maker 远程 build + `git sync`（本次 sync 后 ahead 0 / behind 1 / 本地干净）。

## 已知遗留
- 构建器代码质量提示（不阻塞构建）：`scripts/UI/PanelsV4.lua` 3911 行、`scripts/UI/Panels.lua` 2300 行、`scripts/Game/Renderer.lua` 2171 行，均已超过项目 1500 行拆分阈值，后续应把 PanelsV4 按页面域拆成多个模块。
- validate 的 preparation warnings 里 `mir_actors.lua` / `quests.lua` 有 50 条资源未匹配（`assets/image/mir/**`、`assets/image/game/*_sheet.png`），属于既有资源缺口，与本次 UI 改动无关。
