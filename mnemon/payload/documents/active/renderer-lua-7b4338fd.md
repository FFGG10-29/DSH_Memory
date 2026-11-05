---
id: "7b4338fd-295c-44b5-abc0-16ab0bceba15"
title: "暗黑神王：角色走动抽搐/影分身的定位与修复（Renderer.lua 帧选择策略）"
description: ""
status: "active"
created_at: "2026-11-03T14:09:17.079Z"
updated_at: "2026-11-03T14:09:17.079Z"
content_hash: "ecfc5371781cbe2c0da4fa02cbc6913fe3ee3dba207b277f72ab4cac594e0faa"
source_paths:
  []
session_ids:
  - "74039b3b-614e-494c-8022-dc427f034e97"
memory_body_ids:
  []
---

# 暗黑神王：角色走动抽搐 / 影分身的定位与修复

## 适用环境
- 项目：TapTap Maker 游戏《暗黑神王》，本地预览路径 `D:\workbuddy\_taptap_src`。
- 相关文件：`scripts/Game/Renderer.lua`（英雄绘制与帧选择）。
- 运行时：UrhoX / TapTap Maker 本地预览窗口（`loopback_manifest`，竖屏 1080×1920）。

## 现象
1. 角色移动时整体"抽搐"，而不是走步动作。
2. 修掉抽搐后出现"帧分离 / 影分身"——主体后方叠有半透明残影。

## 根因
1. **抽搐**：走动时把待机呼吸帧按 `fps = 9` 循环切换。`assets/image/model_<id>_0..9.png` 这 10 帧本身只是待机呼吸帧（帧间差仅 1–2px），高速循环 = 抖动。
2. **影分身**：Renderer.lua 为"减轻贴图平移观感"加入过"速度拖尾"，用 `world.trail`（最多 6 个历史位置）叠加半透明残影；残影与主体分离，看起来就是"帧分离 / 影分身"。

## 修复
- 帧选择策略（`local fi` / `fps`）：
  - 攻击（`world.swingTimer > 0`）：`fps = 16` 切帧，表现挥砍。
  - 站立（`not world.walking`）：`fps = 6.5` 慢速呼吸循环。
  - 走动（`world.walking`）：**锁单帧**（`fi = 1`，不切帧）；走动感改由程序化动画承担。
- 走动感来源：`walkBob` 上下踏步起伏 + `walkTilt` 侧摆 + 冲刺纵向拉伸（`atkStretch`）。
- 步频由 `sin(walkPhase * 2)`（约 3.9Hz，偏快发飘）改为 `sin(walkPhase)`（约 2 步/秒，自然步频）。
- 彻底删除"速度拖尾"绘制段（`if walking then ... world.trail ... end`）；`world.trail` 缓冲（上限 6）保留，但不再用于英雄绘制。
- 站立呼吸帧只在站立时慢速循环。

## 走动相位来源（参考）
- `world.walkPhase = world.walkPhase + moved * 3.8`（走动时）；
- 站立时 `world.walkPhase = world.walkPhase + dt * 1.2`；
- `world.walking = moved > 0.001`。

## 验证状态（截至本 checkpoint）
- 代码改动已落盘（`Renderer.lua` 两次 update 成功）。
- 预览窗口校验被运行中的预览阻塞（validate 报 `An active or unverified preview blocks validation`），改用刷新窗口方式加载新代码。
- 刷新成功（`reload_id 1`，新进程 `16540`），日志显示进入世界：`[Main] 创建新档：免充值账号（VIP15），1 级正常起步`、`=== 《暗黑神王》启动 ===`、`Lv.1 见习者 战力=131 地图=新手村 VIP=0`。
- **未确认**：最终"走动不再抽搐 / 无影分身"的视觉结果在 checkpoint 结束前尚未看到（助手正准备再次刷新后截图验证）。

## 其他发现（未完成）
- 每次刷新预览都新建档并走登录向导，因为 `save_darkgod.json` 的 player 无 `name` 字段；助手尝试给存档加角色名并复制到预览源（`D:\workbuddy\_taptap_src\.maker-preview\source`）以避免每次登录，但 Python 执行异常（exit 49）未完成。`Player.New` 默认 `name = ""`。
- 预览 `prepare` 警告：增强引用 50 个路径未匹配资源（截断），以及若干格式化字符串/图片路径告警，属既有资源映射提示，不影响本次修复。

## 要点（可复用）
- 2D 精灵的"待机呼吸帧"不适合在移动时高速循环；移动期应锁单帧，用平滑位移/倾斜/节奏表现走动感。
- 用"残影/拖尾"模拟速度感在小尺寸英雄精灵上易被看成"影分身"，需权衡或直接去掉。
