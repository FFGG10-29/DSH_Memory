---
id: "987df47c-4ffd-4342-9588-2c804afad4da"
title: "暗黑神王：左上角 HUD（H01）重构 — VIP 徽章、等级纯文字、以血条字号为基准"
description: "《暗黑神王》左上角 HUD(H01) 重构落地记录：VIP 皇冠徽章、等级去方框改单行 Lv.N 并与血条字号对齐、240px 红渐变血条条内 x/y 数值、灵石图标行、300px 渐变底、删除左下摇杆；含多轮返工的根因（改\"方块尺寸\"而非\"字号\"）与 Python 补丁断言失败教训。"
status: "active"
created_at: "2026-11-04T18:45:17.639Z"
updated_at: "2026-11-04T18:45:17.639Z"
content_hash: "104d3948dac135d10222264c7a218c6c523b134a81aefaa042549b09d68e6073"
source_paths:
  - "scripts/UI/Hud.lua"
  - "scripts/UI/Joystick.lua"
  - "scripts/main.lua"
  - "tools/fix_hud_h01_scale.py"
  - "tools/fix_hud_h01_font.py"
  - "tools/fix_hud_h01_level.py"
  - "tools/fix_hud_level_nobox.py"
  - "tools/remove_joystick.py"
session_ids:
  - "fe1ac59a-aa64-4c74-904e-0898e650405a"
memory_body_ids:
  []
---

# 暗黑神王：左上角 HUD（H01）重构

> 承接 `3ac56773-2bfd-47f1-95bc-ebf4dcb6b64f`（PanelsV4 功法/战令页 + 切图烘焙文字修复）与 `cfdc114c-90b6-40a1-a0ce-fb527fbd8b7f`（PanelsV4 21 页铁律重构）中确立的「一次性 Python 补丁脚本 → validate → push/build」范式。本文只记录左上角 HUD 这一块。

## 环境与产物
- 项目：TapTap Maker《暗黑神王》，源码根 `D:\workbuddy\_taptap_src`，入口 `main.lua`，竖屏设计 1080×1920（截图视口 412×734）。
- 引擎：UrhoX + `urhox-libs/UI`（Yoga Flexbox + NanoVG）。
- 主改动文件：`scripts/UI/Hud.lua`（H01 段，改动后约 1326 行）；补丁脚本 `tools/fix_hud_h01_scale.py`、`fix_hud_h01_font.py`、`fix_hud_h01_level.py`、`fix_hud_level_nobox.py`、`remove_joystick.py`。
- 发布：commit `deb38a4`（H01 重构）→ `c115fd2`（移除摇杆）→ Maker 提交/远程构建 `019d7d3`，构建成功、`preview_refresh` 200（约 46s），之后 `git sync` 本地与远端一致、无未提交改动。

## 最终形态（自上而下）
1. **VIP 皇冠徽章**：`position="absolute"` 满覆盖圆形区域（`left/top/right/bottom = 0`，`borderRadius = 31`，`pointerEvents = "none"`），暗金渐变 + 外描边（`borderColor = {255,210,120,225}`）+ `boxShadow` 发光，配呼吸/流光动画。早期版本太暗几乎看不见，靠提高描边与阴影强度解决。
2. **等级**：**纯文字单行 `Lv.N`**（如 `Lv.100`），外面**不加任何方块/边框/背景**。等级文字字号与血条内文字一致（同一 `fontSize` 基准），描边 2px 黑。
3. **血条**：宽 **240px**、高 20，红色渐变 + 顶部高光 + 圆角 6；条内显示 `x / y` 数值（如 `225 / 234`），**不再显示百分比**。
4. **灵石行**：图标 + 数字，替代纯文字。
5. **整块底衬**：宽 **300px** 的黑色左浓右透明线性渐变，`flexShrink = 0`。

## 关键教训（本轮返工 3 次才对齐）
- **用户说「字体大小」时指的是字号，不是控件尺寸。** 第一轮把等级方块从 60×60 缩到 46×46 并压小数字，用户明确否定：「是等级太大，没有和血条一样，血条才是基准」。正确做法是**以血条内文字字号为唯一基准**去对齐等级文字，容器尺寸不动。
- **不要给文字套框。** 「等级外面套个方块干什么？」——等级是纯文字元素，任何 `UI.Panel` 包裹 + 边框 + 背景渐变都属于过度设计，会被要求删除。
- **等级要单行。** 早期做成两行（小字 `Lv.` caption + 大字数字），被要求直接改成一行 `LV.100`；两行方案在窄屏下 caption 只有 10px 更难读。
- **测试数据必须注入到每帧刷新处。** 直接改存档里的数值会被 Save/Load 覆盖；把假数据（等级、HP `225/234`）注入 HUD 的刷新函数（`refs.levelLabel:SetText` 附近）才每帧生效，改完再撤掉注入。
- **一次性 Python 补丁脚本的断言是有价值的护栏。** 本轮多轮失败都是 `count == 0` 断言（`levelLabel`、`hpBar`、`nameLabel` 各一次），原因是源码里同一段样式被重复写（例如 `fontWeight = "bold"` 出现两次）、缩进/换行与脚本里的字面量不完全一致。修法：**先 grep 打印真实片段，再用最小唯一子串做 replace**，不要凭记忆写补丁字面量；每次断言失败都要重新读文件确认上一轮补丁是否已生效（`[effects: unknown]`）。

## 删除左下角虚拟摇杆
- 用户明确「不需要轮盘」。删除点：`scripts/UI/Hud.lua` 中 `require("UI.Joystick")`、`Joystick.Build()`、`Joystick.Apply(world)` 每帧调用、`children` 里的 `joystick` 与 `refs.joystick`。`scripts/UI/Joystick.lua` 文件保留但不再被引用。
- 注意 `manualMove` 是**玩法层**字段（`scripts/Game/world/combat.lua`、`MirHero.lua`、`Renderer.lua`、`ActorAnim.lua` 都读它，自动寻路/攻击位移也在写），删摇杆**不要动 `manualMove`**，否则走位与动画状态会坏。删完跑 validate：PASS、`lua_errors = 0`。

## 协作方式（本项目实测）
- 一次截图要等约 40s 的远程构建，用户表示「改完上传代码老子自己看，不需要你看」。因此 HUD 这类纯视觉微调，之后应**直接改代码 + push（+ 用户明确要求时远程构建）**，由用户看效果再反馈，不要每轮都自己截图验证。
- 但涉及**运行时报错风险**的改动（删除组件、改 require）仍要跑本地 `validate` 确认 `lua_errors = 0` 再推送。
