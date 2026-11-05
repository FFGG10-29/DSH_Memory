---
id: "dde917f5-af69-4ad4-aff7-42276c7a4c67"
title: "暗黑神王：三界地图页（P11）MapV2 重度商业化重构"
description: "《暗黑神王》P11 三界地图页 MapV2 重构：结构、架构决策、数据源、验证与发布流程、踩坑。"
status: "active"
created_at: "2026-11-04T16:38:31.462Z"
updated_at: "2026-11-04T16:38:31.462Z"
content_hash: "edec0987aa04be46a00deb8b3c1feb9ee3bdfcccd76f4868553f99423122b095"
source_paths:
  - "scripts/UI/MapV2.lua"
  - "scripts/UI/Panels.lua"
  - "scripts/Game/IconRegistry.lua"
  - "scripts/main.lua"
session_ids:
  - "82ae7ed5-2285-4346-92ca-964551e795aa"
memory_body_ids:
  []
---

# 暗黑神王：三界地图页（P11）MapV2 重度商业化重构

## 适用环境
- 项目：《暗黑神王》，TapTap Maker 工程，源码目录 `D:\workbuddy\_taptap_src`（入口 `main.lua`，脚本根 `scripts/`）。
- 引擎：UrhoX + `urhox-libs/UI`（Yoga Flexbox + NanoVG），竖屏 UI。
- 相关产物：`scripts/UI/MapV2.lua`（新建，约 635 行，全中文注释）、`scripts/UI/Panels.lua`（早分派 + 生命周期接入）。

## 改造前的问题
- 地图页 `P.BuildMap()` 是 14 张地图的纵向文字长列表（`T.SectionTitle` + 每行 `T.StatRow` + 小按钮），无图、无底栏。
- 旧实现含 `assert(ctx)` 与分派 fallback，`ctx` 缺失时会触发报错组件。
- `sys_map` 图标存在于 `scripts/Game/IconRegistry.lua`（`["sys_map"] = "assets/image/icon_sys_map.png"`），但 `IconRegistry` 不在 `scripts/UI/` 下，按 UI 目录搜索会误判"图标缺失"。

## 新结构（自上而下）
1. **上半部 232 高世界版图**：`MirSkin.MAP_BICHON` 真彩大地图铺底；顶部暗压条写「三 界 版 图」；底部信息条显示界域战力倍率与当前所在地图。
2. **三界域入口按钮**：`position="absolute"` + `left`/`top` 百分比，三个大按钮错落摆在地图上 —— 凡界(1-300) 左下、天界(301-600) 中上、神界(601-1000) 右下；含真图标、名称、等级区间、所在/未解锁角标；选中态 3px 界域色描边 + 外发光。
3. **下半部横向卡片**：`ScrollView{ scrollX = true }` 内 136×136 方正卡片，每卡以该地图真彩大图为底 + 顶部名字压条 + 右上 BOSS 头像圆徽 + 底部状态条（当前 / 需 Lv.N / BOSS Lv.N / 安全区）；未解锁地图 42% 透明度变灰。
4. **点击卡片 → 屏幕正中央浮窗**：`MapV2.NewModal()` 全屏遮罩 + 居中 86% 面板，内容为地图大图横幅 + BOSS 信息卡 + 地图介绍 + 大号金色[传 送]按钮 + [关闭]。
5. **强制底部导航** `[返回][地图][传送][排行榜]`：全图片切图（`BTN_DARK` / `TAB_ON` / `TAB_OFF`），每格 `flexGrow=1` + `flexBasis=0` + `fontSize=11`，避免文字挤压/截断。
6. **[传送] 子页**：三界域全地图 48% 宽网格，每格含缩略图 + BOSS 小图标 + 名字 + 锁状态，点击复用同一中央浮窗。
7. **[排行榜]**：跳 `V3.BuildRank`（荣耀排行榜）。

## 关键架构决策与理由
- **早分派优先于旧分支**：`P.Rebuild` 中 `V2PAGES[key]` 表先行分派（含 `map = MapV2.Build`），使 `P.BuildMap()` 不再被调用，旧 `assert`/fallback 路径自然失效；新增页面统一在 `V2PAGES` 表登记（现有 key：talent/pet/quest/market/mount/vip/carnival/escort/dungeon/rank/sigil/treasury/codex/guild/life/map）。
- **浮窗宿主挂 `CreateOverlay` 的 `overlay.children`**（与 `card` 平级），因此能真正覆盖全屏居中；`P.Close()` 与 `P.Rebuild()` 均调用 `MapV2.CloseModal()` 收口，避免面板关闭后浮窗残留。
- **数据源**：`Data.Tiers`（`key/name/short/color/minLv/maxLv/powerMult`）分界域；`Data.Maps`（JSON 载入 14 张，按 `tier` 1/2/3 分组并排序）；`Data.MapBgs` 提供大地图。
- **状态判定收敛到 `mapState()`**：当前所在 / 等级锁 / `ownerOnly` 地图走 `pl.account.owner`，全部单点判定。
- **复用范式**：`skinBtn`、`bigNumber`、`metalCard`、`nav` 沿用 GuildV2 / LifeV2 已有实现，保持五页视觉一致；`MapV2` 内无 assert 落空路径，`ctx.world` 缺失时仍返回 k 数组（空表），符合 `P.Rebuild` 的 `for _, w in ipairs(fn(ctx, P))` 契约。

## 验证与发布步骤（可复用流程）
1. `write_file` 落盘 `MapV2.lua`，再用一次性 Python 补丁脚本（`tools/patch_map_v2.py`）改 `Panels.lua`：新增 `require("UI.MapV2")`、`P.Close()` 加 `MapV2.CloseModal()`、`V2PAGES` 加 `map` 条目。
2. 语法/分派自检：打印 `P.Close` 全文、`P.Rebuild` head、`V2PAGES` 表确认补丁位置。
3. **临时冒烟**：在 `main.lua` 的 `TEST_PANEL`（第 20 行定义、第 85 行触发）旁加入临时块，遍历三界域 × 2 子页 × 14 张地图做 `MV.OpenModal` / `MV.CloseModal`，再 `Panels.Close()`。
4. `validate`（本地预览 validate）→ PASS，60 帧，`lua/resource/engine/total` 全 0；`runtime.log` 第 479 行出现 `Loaded Lua script UI/MapV2.lua`，无 `attempt to` / `nil value` / traceback。
5. **必须还原 `main.lua`**（`tools/restore_main_map.py` + 删除 14 行临时块），再做 pristine `validate` → PASS（run_id `1fa4e9f6`，60/0/0/0/0），避免临时冒烟代码进库。
6. `git push` → commit `2728d3e`；`build`（`maker_build_current_directory` 远端构建）→ 成功，submit commit `519d136`，preview_refresh 200，耗时约 43s；`git sync` → updated，本地干净。

## 踩坑记录
- `scripts/UI/IconRegistry.lua` 不存在，注册表实际在 `scripts/Game/IconRegistry.lua`；排查图标时应全库 grep，不要限定 UI 目录。
- `validate` 依赖本地 Lua 解释器，容器内直接 `subprocess` 调用会 `FileNotFoundError: [WinError 2]`，应走 Maker 的 `run-lua-validate` 通道而不是自起解释器。
- Maker 远端构建会给出文件长度提示：`scripts/UI/Panels.lua` 2276 行、`scripts/Game/Renderer.lua` 2171 行，均超 1500 行阈值，属待重构项（不影响构建）。

## 相关文档
- `7b4338fd-295c-44b5-abc0-16ab0bceba15` — 暗黑神王：角色走动抽搐/影分身的定位与修复（同项目 `Renderer.lua` 侧经验）。
