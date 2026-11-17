# 更新记录 / Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号按 [语义化版本](https://semver.org/lang/zh-CN/)。
Format follows Keep a Changelog; versions follow Semantic Versioning.

## [未发布] / Unreleased

这一节的内容在源码里已经有了，0.1.1 的整合包里还没有。Everything in this section is in the source tree but not yet in the 0.1.1 bundle.

### 新增 / Added

- 使用教程：`docs/使用教程.md`，带截图，讲怎么出第一张图、一步步走视频改写、容易漏掉的规矩和常见提示。Usage guide (`docs/使用教程.md`, Chinese, with screenshots): the first image, a full video rewrite walkthrough, easy-to-miss rules and common messages.
- 图层分离：图片卡工具条点「图层分离」，把图拆成底图和几个透明图层；图层能拖动、缩放、旋转、翻转、调上下层，能加进别的图拆出来的图层，摆好后合并成一张新图。拆分按出图计费，摆放和合并在本机完成、不花钱。Layer split: split an image into a base plus transparent layers from the image card toolbar; move, scale, rotate, flip and reorder layers, add layers split from another image, then merge into a new image. Splitting is billed as image generation; arranging and merging run locally at no cost.
- 图层重绘：在图层编辑里选中一层、写一句话，只重画这一层（透明底）。Layer redraw: pick one layer, describe the change, and only that layer is redrawn on a transparent background.
- 视频改写的衣服卡和道具、遮挡物这类东西的卡也能选「不出图，用文字」（之前只有背景卡能用）：卡上写一句大白话，生成提示词时由本机 agent 对照原片写进去；人物卡仍然必须有图。Outfit cards and prop / occluder cards in video rewrite can now use "text instead of an image" (previously background cards only): write a plain sentence and the local agent works it into the prompt against the source clip. Person cards still need an image.

### 改动 / Changed

- 去掉提示词面板左上角的「＋参考」按钮和点选参考模式：加参考改为从别的卡拖线到目标卡左边的小圆点，或点卡旁边的 ＋。Removed the "+ Reference" button and its pick mode from the prompt panel: add a reference by dragging a line from another card onto the target card's left dot, or with the + beside a card.

## [0.1.1] - 2026-11-15

### 新增 / Added

- 作品库加「我上传的」：从电脑传的图片和视频留在清单里，同一个文件只存一份，能拖回画布，也能删。Library gains "My uploads": images and videos uploaded from your computer stay listed, identical files are stored once, and items can be dragged back onto the canvas or deleted.
- 视频改写的背景卡可选「不出图，用文字」：在卡上写一句话说这段场景要什么样，生成提示词时由本机 agent 结合原片写进去。Background cards in video rewrite can use "text instead of an image": describe the scene in a sentence and the local agent writes it into the prompt against the source clip.
- 人物库和成组：作品库加「人物」页，图片可「存为人物」反复用；画布上的卡可以打组 / 解组（Ctrl+G）。Character library and groups: a "Characters" page in the library, "Save as character" on images, and group / ungroup on the canvas (Ctrl+G).
- 拆解（无人物）：只拍商品和手脚、不露脸的视频，写一句要换什么，自动铺好商品组和新视频卡，原视频直接当参考视频。Product remake (no person): for clips showing only a product with hands or feet, say what to swap and the product group and a new video card are laid out with the source clip as the reference video.
- 视频截图：视频卡工具条可截当前帧 / 首帧 / 尾帧，截出来是一张连着来源的图片卡。Frame capture: grab the current, first or last frame of a video card as an image card linked to its source.
- 视频改写输入框加「衣服和原片保持一致」，默认勾上：没写要换的衣服自动从原片截图、抽成不带脸的衣服图、连进视频卡，提示词按时间写谁穿哪张；隔一段穿回的同一套只抽一张，分屏视频只截这个人那半边。Video rewrite gains "Keep outfits from the original", on by default: outfits you did not ask to change are captured from the clip, turned into face-free outfit images and wired into the video card automatically; repeated outfits reuse one image and split-screen clips crop to that person's half.
- 视频改写支持原片换地方和两个人：拆解分场景，每个场景一张背景卡，提示词按段写场景，谁穿哪件分开写；Seedance 2.5 的参考上限放宽到官方的 30 张图 + 10 段视频。Video rewrite now handles multi-location and two-person clips: analysis splits scenes, each scene gets its own background card, the prompt names the scene per segment and who wears what, and the Seedance 2.5 reference limit follows the official 30 images plus 10 videos.

### 改动 / Changed

- **视频改写、拆解（无人物）和「帮我改写」不再用豆包，改由你电脑上的 Claude Code（或 Claude 桌面版）完成**，用你自己的 Claude 订阅额度、不花火山的钱；要先装好并在终端运行一次 `claude` 用自己的账号登录，没接好时点这些按钮会弹框说明缺什么。只认 `.exe` 版（官方安装方式或桌面版自带的都行），用 npm 装出来的 `.cmd` 启动不了。也可以在 `.env.local` 填 `AGENT_ENGINE=codex`（先在终端跑 `codex login`）改用本机 Codex。只出图、出视频不受影响。Video rewrite, product remake and "rewrite for me" no longer use Doubao; they run through the Claude Code (or Claude desktop app) on your machine with your own subscription, or Codex with `AGENT_ENGINE=codex`. Only the `.exe` builds work; the `.cmd` shim from an npm install cannot be launched. A dialog explains what is missing if it is not set up. Plain image and video generation are unaffected.
- 视频改写铺好卡后，要去掉人物的背景图不再自动出图花钱：截图、建卡、写好提示词照旧自动，等你在卡上点生成，或换成自己的图。After video rewrite lays out the cards, the person-removed background is no longer generated automatically (which cost money); the frame, cards and prompt are still prepared, and you click Generate or drop in your own image.
- 页面不再显示金额（交单前的预估费用也去掉了），费用照常记在本机账本里。Prices are no longer shown in the UI (including the pre-submit estimate); spending is still recorded in the local ledger.
- 许可从 MIT 改为 PolyForm Noncommercial 1.0.0：0.1.0 之后的版本，软件本身未经作者书面授权禁止商业使用，个人生成的图片和视频可以发布和赚钱；已发布的 0.1.0 仍按 MIT。License changed from MIT to PolyForm Noncommercial 1.0.0: after 0.1.0 the software itself may not be used commercially without the author's written permission, while individuals may publish and monetize what they generate; the released 0.1.0 stays MIT.
- 画布左下角加上作者署名和官方仓库链接。Added an author credit linking to the official repository at the bottom left of the canvas.
- 在源码包（GitHub「Download ZIP」）里双击 `一键启动.bat`，提示先指去 Releases 下载整合包；开发者命令改成和 README 一致的 `npm ci`。Double-clicking `一键启动.bat` in a source download now points to the Releases bundle first; the developer hint uses `npm ci`, matching the README.

### 修复 / Fixed

- 付费单不再丢：小服务接了单、页面却没收到单号（回话丢了，或正好切走画布）时，重新打开画布或发送报错后会把这单接回卡片，不用再点一次重复花钱。Paid jobs no longer get orphaned: if the server accepted a job but the page never received its id, the job is re-attached to its card when the canvas reopens or right after the failed send, so you do not pay twice.
- 视频出好了但 24 小时都没下载下来时，这笔钱照样记进花费，错误里写明金额和火山任务号。A video that finished but could not be downloaded within 24 hours is now recorded in the spend log, and the error shows the amount and the Volcengine task id.
- 自动保存：上一次保存失败时，期间又做的改动不再被一起丢掉，会接着存。Autosave no longer drops edits made while a failed save was still in flight; they are saved next.
- 启动时清理旧文件出错（比如文件被别的程序占着），小服务不再起不来。The local server still starts when cleanup at startup fails, for example because another program holds a file.
- 硬盘写不进（满了、只读）时，出图 / 出视频排队不再卡死整个小服务。A full or read-only disk no longer locks up the image and video queues.
- 参考视频传 TOS 失败时按原因说清（密钥、桶名、地区、大小、网络）。Reference video uploads to TOS now say why they failed (keys, bucket, region, size, network).
- 深度报错里的中文不再乱码；透明底 PNG 上传后透明处不再变黑。Chinese text in depth errors is no longer garbled; transparent PNG uploads no longer turn black.
- 看大图、确认框开着时按 Delete / Ctrl+Z 不会再动到后面的卡；页面出错时显示「页面出错了」和刷新按钮，不再整页白屏。Delete and Ctrl+Z no longer affect cards behind an open preview or dialog; a page error now shows a message with a reload button instead of a blank page.

## [0.1.0] - 2026-11-01

首个公开预览版。
First public preview.

### 新增 / Added

- 无限画布：多张画布，图片卡、视频卡自由摆放，连线即引用。Infinite canvas with multiple boards; image and video cards; connect cards to use one as a reference.
- 出图 / 改图：Seedream 5.0 Flash / Lite。Image generation and editing with Seedream 5.0.
- 出视频：Seedance 2.0 Mini / Fast / 2.0 / 2.5，图片、视频、声音都能当参考，交单前显示预估费用。Video generation with Seedance; image, video and audio references; cost estimate before submitting.
- 作品库：生成结果自动入库，可拖回画布。Library that collects every result and lets you drag it back onto the canvas.
- 视频小工具：提取原声、片段截取、「帮我改写」润色提示词。Video utilities: extract soundtrack, trim clip, prompt rewrite.
- 动作参考（选装，本机显卡）：深度图（Video-Depth-Anything Small）、白模（ComfyUI + SAM 3D Body）。Optional local motion references: depth map and body mesh.
- 视频改写：豆包分析原片、分段写提示词，换人、换衣、换背景后生成并自动配回原声。Video rewrite: analyse a clip, swap character / outfit / background, keep the motion, re-attach the original soundtrack.
- Windows 整合包：`一键启动.bat` / `停止.bat`，深度一键安装 `安装深度.bat`，白模体检 `检查白模环境.bat`。Windows release bundle with one-click start / stop, a depth installer and a mesh environment check.
- GitHub 自动检查：类型检查、测试、打包、整合包冒烟测试。CI on a fresh Windows runner: type check, tests, pack, smoke test.

[0.1.1]: https://github.com/c2247189334/ggtv-canvas/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/c2247189334/ggtv-canvas/releases/tag/v0.1.0
