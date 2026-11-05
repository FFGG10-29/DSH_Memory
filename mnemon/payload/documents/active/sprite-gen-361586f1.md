---
id: "361586f1-f829-433e-89f3-2f4cefb06017"
title: "暗黑神王：角色跑动动画的资产限制与可行方案（无跑动帧 / sprite-gen 不可用）"
description: "记录《暗黑神王》角色无跑动帧的资产限制与跑动动画可行方案"
status: "active"
created_at: "2026-11-03T16:10:00.120Z"
updated_at: "2026-11-03T16:10:00.120Z"
content_hash: "c4e6bb8764c91a655061fff65686b28d2b46688c5f4488a84436bec72285d46a"
source_paths:
  - "scripts/Game/Renderer.lua"
  - "assets/image/model_1108_0..9.png"
  - "assets/image/hero_frame_0..9.png"
  - "save_darkgod.json"
session_ids:
  - "d4344f4d-6811-40ce-b0c3-74d5da4bee6b"
memory_body_ids:
  []
---

# 暗黑神王：角色跑动动画的资产限制与可行方案

> 承接文档 `7b4338fd-295c-44b5-abc0-16ab0bceba15`（走动抽搐/影分身修复）。本文记录该修复之后、对"真正跑步动作"的进一步定位结论。

## 适用环境
- 项目：TapTap Maker 游戏《暗黑神王》，本地预览源 `D:\workbuddy\_taptap_src`（工作目录 `D:\workbuddy\TapTap游戏开发`）。
- 相关文件：`scripts/Game/Renderer.lua`（英雄绘制与帧选择）、`assets/image/model_1108_0..9.png`、`assets/image/hero_frame_0..9.png`。
- 运行时：UrhoX / TapTap Maker 本地预览窗口（竖屏 1080×1920）。

## 结论（核心）
- **当前角色素材只有"待机呼吸帧"，没有跑动/走路的腿动作帧。** 10 帧 `model_1108_0..9.png` 与 `hero_frame_0..9.png` 帧间差仅 1–2px，纯粹是呼吸循环，任何代码都无法靠它们摆出口服的"跑步"动作。
- 因此此前"锁单帧 + `walkBob` 上下摆动 + `walkTilt` 侧倾"只能表现**滑行/待机晃动感**，不能表现跑步。用户明确要求"跑步动作"，这条路不成立。
- 要做真跑步，**必须新增一套跑动序列帧**，或更换自带跑动动画的角色素材。

## 证据（来自 checkpoint）
- PIL 帧分析：`model_1108_0.png (220,220) bbox (62,61,154,149)`；`model_1108_1.png bbox (62,61,154,154)`；`model_1108_4.png bbox (63,62,154,147)`；`model_1108_9.png bbox (62,63,154,147)`——各帧 bbox 差异仅几个像素，是呼吸级差异。
- `Renderer.lua` 帧选择注释自述："走动时锁单帧——那 10 帧只是待机呼吸帧（帧间差 1-2px），快速循环会抽搐，走动感改由 walkBob 上下摆动 + walkTilt 侧摆 + 拖尾承担。"
- 资产目录同时存在 `hero_frame_0..9.png` 与 `model_1108_0..9.png`（各 10 帧 + `.meta`），无其它带动作的序列帧。
- `sprite-gen` 技能（`SKILL.md`）存在，但其铁律 1 要求 MCP 工具 `sprite_gen`；本环境 Tool 清单只暴露 provider/事件/配置发现类工具，**未注册 `sprite_gen` 或任何图片生成工具** → 当前环境不支持精灵生成。
- 预览 `prepare` 附带错误：`Could not find resource Cube/Day/DaySpecularHDR.dds`（资源映射提示，非本次动画改动引入）。

## 可选实现路径（按成本排序）
1. **用 sprite-gen 生成跑动序列帧**：需先让 `sprite_gen` MCP 工具可用；否则按其 SKILL.md 铁律 1 提示"当前环境尚未支持精灵生成，敬请期待"，不能继续流程。
2. **用 Maker 资产生成工具生成跑动帧**：当 `taptap-maker canvas model-settings` 的 generation=maker 时，可用 `generate_image` / `batch_generate_images` 逐帧生成跑动帧，再写入 `assets/image` 并接入渲染。
3. **更换角色素材**：换成自带跑动动画的 2D 序列帧角色，或改用带腿部动作的模型/Spine 骨骼动画（`engine-docs/recipes/state-machine.md`）。
4. **接受现状**：保留锁单帧方案，明确告知用户当前只能"滑行"，不声称是跑步。

## 渲染接入要点（若新增跑动帧）
- `Renderer.lua` 当前帧选择逻辑：攻击（`world.swingTimer > 0`）`fps = 16`；站立 `fps = 6.5`；走动锁单帧 `fi = 1`。接入跑动帧后，应在 `world.walking` 分支按新帧序列切帧（而非锁单帧），并为跑动帧另建命名（如 `model_1108_run_<i>.png`）与 `R.heroFrames` 缓存键，避免与待机帧混用。
- `world.trail` 残影绘制已删除，不要为跑动重新引入，否则会再次出现"影分身"。

## 验证状态（截至本 checkpoint）
- 代码改动已落盘（`Renderer.lua`），预览窗口已 reload（`reload_id 1`，新进程 `16540`）。
- **未确认**：用户要求的"真正跑步动作"尚未实现——资产层面已判定无法用现有 10 帧做到。下一步需先解决序列帧来源（见上）。

## 要点（可复用）
- 2D 角色的"待机呼吸帧"帧间差极小，不承载任何动作信息；用程序化摆动顶替动作会被用户直接识破为"不是跑/走"。
- 给小尺寸 2D 英雄加"速度拖尾"残影易被看成"影分身/帧分离"，应避免。
- 精灵/序列帧生成依赖外部 MCP 工具（`sprite_gen`）；工具不可用时应先确认环境能力，不要声称能凭空生成帧。
