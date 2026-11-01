# 更新记录 / Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号按 [语义化版本](https://semver.org/lang/zh-CN/)。
Format follows Keep a Changelog; versions follow Semantic Versioning.

## [Unreleased]

### 改动 / Changed

- 在源码包（GitHub「Download ZIP」）里双击 `一键启动.bat`，提示先指去 Releases 下载整合包；开发者命令改成和 README 一致的 `npm ci`。Double-clicking `一键启动.bat` in a source download now points to the Releases bundle first; the developer hint uses `npm ci`, matching the README.

## [0.1.0] - 2026-11-01

首个公开预览版。只在一台 Windows 11 + RTX 5080（16 GB 显存）上完整测过。
First public preview. Fully tested on one Windows 11 + RTX 5080 (16 GB) machine only.

### 新增 / Added

- 无限画布：多张画布，图片卡、视频卡自由摆放，连线即引用。Infinite canvas with multiple boards; image and video cards; connect cards to use one as a reference.
- 出图 / 改图：Seedream 5.0 Flash / Lite。Image generation and editing with Seedream 5.0.
- 出视频：Seedance 2.0 Mini / Fast / 2.0 / 2.5，图片、视频、声音都能当参考，交单前显示预估费用。Video generation with Seedance; image, video and audio references; cost estimate before submitting.
- 作品库：生成结果自动入库，可拖回画布。Library that collects every result and lets you drag it back onto the canvas.
- 视频小工具：提取原声、片段截取、「帮我改写」润色提示词。Video utilities: extract soundtrack, trim clip, prompt rewrite by Doubao.
- 动作参考（选装，本机显卡）：深度图（Video-Depth-Anything Small）、白模（ComfyUI + SAM 3D Body）。Optional local motion references: depth map and body mesh.
- 视频改写：豆包分析原片、分段写提示词，换人、换衣、换背景后生成并自动配回原声。Video rewrite: analyse a clip, swap character / outfit / background, keep the motion, re-attach the original soundtrack.
- Windows 整合包：`一键启动.bat` / `停止.bat`，深度一键安装 `安装深度.bat`，白模体检 `检查白模环境.bat`。Windows release bundle with one-click start / stop, a depth installer and a mesh environment check.
- GitHub 自动检查：类型检查、测试、打包、整合包冒烟测试。CI on a fresh Windows runner: type check, tests, pack, smoke test.

[Unreleased]: https://github.com/c2247189334/ggtv-canvas/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/c2247189334/ggtv-canvas/releases/tag/v0.1.0
