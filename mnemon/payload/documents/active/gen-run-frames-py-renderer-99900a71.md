---
id: "99900a71-bfc4-4eb2-9701-5169fc47dd9f"
title: "暗黑神王：跑动序列帧的实现方案（程序化 gen_run_frames.py + Renderer 帧选择接入）"
description: "记录用 tools/gen_run_frames.py 程序化生成 32 张跑动帧并接入 Renderer.lua 的做法、验证结果与真腿动画的后续付费路径"
status: "active"
created_at: "2026-11-04T01:18:13.149Z"
updated_at: "2026-11-04T01:18:13.149Z"
content_hash: "c5dee8be88c6ac3040fbe0bd2925fa4f07b63608a9d4ab3e391acfc15745c37d"
source_paths:
  - "tools/gen_run_frames.py"
  - "scripts/Game/Renderer.lua"
  - "assets/image"
  - "screenshots/run_cycle_1108.png"
  - "screenshots/run_vs_idle.png"
session_ids:
  - "5ffb793c-f991-46f9-86b5-43b382b1f9ac"
memory_body_ids:
  []
---

# 暗黑神王：跑动序列帧的实现方案（程序化形变帧）

> 承接 `361586f1-f829-433e-89f3-2f4cefb06017`（资产限制结论：现有角色只有 10 帧待机呼吸图，无跑动帧）与 `7b4338fd-295c-44b5-abc0-16ab0bceba15`（走动抽搐/影分身修复）。本文记录限制被真正解决的一次落地：为 4 个角色模型各生成 8 张跑动帧并接入渲染。

## 适用环境
- 项目：TapTap Maker 游戏《暗黑神王》，本地预览源 `D:\workbuddy\_taptap_src`（工作目录 `D:\workbuddy\TapTap游戏开发`）。
- 改动文件：`scripts/Game/Renderer.lua`（英雄帧选择与纹理缓存）；新脚本 `tools/gen_run_frames.py`；新资产 `assets/image/model_<id>_run_0..7.png`。
- 角色模型 id：1102 / 1107 / 1108 / 1111（源帧 220×220 PNG，带 `.meta`）。

## 为什么只能用程序化形变
- 角色是**长袍造型，腿部被袍子遮住**（横向宽度分析：y=83 起袍身宽 28→74，y=139 之后仅剩 27→4px 的下摆），源图腿部姿态画死，无法靠裁切/拼接得到真正交替的腿。
- 因此跑动感只能由整体几何变换表达：身体前倾 + 腾空/着地弹跳 + squash/stretch + 下半身（袍摆）左右甩动。

## 生成做法（可复用）
`tools/gen_run_frames.py` 对每个模型输出 8 帧 `model_<id>_run_0..7.png` 到 `assets/image`（本次共 32 张，另有对应 `.meta` 使预览资源包达 64 个文件）。帧参数化：
- 前倾约 7°；质心垂直波动 ~20px（腾空/着地节奏，run_0 cy≈86.5 → run_2 cy≈66.4 → run_4 cy≈86.6 循环）；
- 着地压扁 / 腾空拉长（bbox 高 75→83→75、宽 96→89→94 随帧变化）；
- 下半身袍摆左右交替甩动，作为"迈步"的视觉替代。

## 量化验证（判据，下次可直接复用）
- **相邻帧像素差异 3.2–4.7%**，而原待机呼吸帧之间仅 0.x%（bbox 差 1–2px）——这就是"看得见动画"与"抽搐"的分水岭。
- 跑动帧 vs 待机帧差异 6.3–8.6%，证明新帧与呼吸帧明显区分。
- 结论：帧间差异（而非代码摆动幅度）才是判断序列帧是否可用的指标；分析脚本用 PIL 逐帧 diff + bbox/质心统计即可。

## Renderer.lua 接入要点
帧选择与缓存（约 724–774 行区域）：
- 双缓存表：`R.heroFrames[modelId]`（待机，路径后缀 `_`）与 `R.runFrames[modelId]`（跑动，后缀 `_run_`），互不混用；统一 `loadFrame(store, suffix, idx)` 懒加载 + 失败写 `{id=0}` 负缓存，避免每帧重复 `nvgCreateImage`。
- `useRun = walking or (world.swingTimer or 0) > 0`；跑动 `fps = 11`、攻击 `fps = 14`，均 `% 8 + 1`；站立沿用原 10 帧 `% 10 + 1`、`fps = 6.5`。
- 攻击复用跑动帧：前倾 + 冲刺拉伸读起来像挥砍突进，无需单独攻击帧。
- 回退：跑动帧缺失（`id == 0`）时锁单帧，并叠加 `bob += sin(walkPhase) * r * 0.08`、`walkTilt = sin(walkPhase) * 0.04`，保证不是纯平移滑行。
- ⚠️ 编辑陷阱：此区块曾出现"新逻辑 + 旧 `local cached` 块并存"导致重复定义，必须整段重写而非追加替换；文件未被读取过直接编辑会被拒（`file has not been read`）。

## 校验与预览事实
- 本地预览 validate：`result=PASS`，`lua: 0 res: 0 engine: 0`，frames 60，missing 资源 `[]`。
- 校验输出 JSON 需按整文件读取：`python - <<` 里假设 `/tmp/vres.json` 在 Windows 不存在（FileNotFoundError）；直接把 stdout 交给 `json.load` 会因多段输出报 `Extra data: line 2 column 1`，要先截取单个 JSON 对象。
- 刷新（reload）对已停止的会话返回 `ok: False state: stopped pid: None`；本次以 `restart` 拉起新进程（pid 4200）后才生效——注意 AGENTS 策略：stopped/unverified 会话不应自动复活，需按当前意图确认。
- 证据图：`screenshots/run_cycle_1108.png`（8 帧跑动条带）、`screenshots/run_vs_idle.png`（待机 vs 跑动对比）。

## 仍未解决 / 下一步（需用户授权）
- 这是**程序化形变帧，不是重绘的跑动图**：腿本身没有真正交替迈步。要真腿动画，唯一路径是 Maker 画布「序列帧动画」内置模板（preset id `7e1cb6ad-732f-4dc3-a951-000000000001`）按角色参考图 AI 重绘。
- 该通道 `generation=maker` 且**付费消耗积分**，需要浏览器端 canvas 页面连接：本次 `pages: []`，创建页面报 `缺少或无效的 pageId` / `缺少或无效的 canvasId`，且所有 canvas 操作必须显式传 `--target-dir <项目绝对路径>`；Console 运行正常（`http://127.0.0.1:62115`，version 0.0.39，pid 2160）。→ 需用户打开/连接画布页面并确认付费后才能推进。
- 排队的后续工作：UI 冰蓝哥特化改造（用户尚未确认优先级）。

## 可复用要点
- 角色缺动作帧时，先用像素 diff 量化证明"现有帧不含动作信息"，再决定生成还是换素材；不要靠代码摆动冒充动作，会被直接识破。
- 无腿可画（袍服/固定姿态）时，"前倾 + 弹跳 + squash/stretch + 下摆甩动"是小尺寸 2D 精灵最经济的奔跑读法。
- 新增帧序列务必独立命名与独立缓存表，并保留负缓存 + 回退路径，避免资源缺失导致渲染崩溃。
