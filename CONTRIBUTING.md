# 参与贡献 / Contributing

谢谢你愿意帮忙。报问题、提想法、改代码都欢迎。
Thanks for helping out. Bug reports, ideas and pull requests are all welcome. English summary at the end.

## 报问题

- 用 [问题模板](../../issues/new/choose)，写清你做了哪几步、想看到什么、实际看到了什么。
- 贴黑窗口最后显示的内容和 `日志/` 里当天的记录，**先删掉密钥、账号和个人路径**，不要贴 `.env.local`。
- 说明你的系统、显卡和显存。项目目前只在 Windows 11 + RTX 5080 16 GB 上完整测过，别的配置的反馈尤其有用。

## 提想法

先开一个 issue 说清想解决什么问题，再动手写代码；大改动（新模型、新流程、改画布交互）先讨论，免得白做。

## 改代码

从源码跑起来：

```bash
git clone https://github.com/c2247189334/ggtv-canvas.git
cd ggtv-canvas
npm ci
npm run dev     # 页面，端口 5280
npm start       # 小服务，端口 5290；或 npm run fake 用假火山、不花钱
```

提交前请确认：

1. `npm run typecheck` 0 错，`npm test` 全过（要装 ffmpeg）。改了打包相关的再跑 `npm run pack` 和 `npm run smoke`。
2. 新功能带测试；修 Bug 先写一条能复现的红测试，再改绿。不要删断言、跳过测试或硬编码成功来让检查通过。
3. 单个代码文件尽量不超过 300 行，超了先拆。
4. 代码里不写本机路径、密钥和账号；配置一律走 `.env.local`（见 `.env.example`）。
5. 页面文案是中文；代码文件名、变量名用英文。
6. 小服务（`server/`）只用 Node 自带模块，不加第三方运行依赖；装、升、降任何依赖都先在 issue 里说明原因。
7. 一个 PR 只做一件事，标题和描述写清改了什么、怎么验证的。

调用真火山接口会从你自己的账号扣费，测试时请用 `npm run fake`。

## 行为准则

互相尊重，就事论事。请勿用他人肖像生成未经本人同意的内容，也不要把这类内容带进 issue 和 PR。

## English summary

- Open an issue before large changes. Use the issue template for bugs; include console output and logs with keys, accounts and personal paths removed.
- Run from source with `npm ci`, `npm run dev` (web, 5280) and `npm start` (server, 5290) or `npm run fake` (free fake mode).
- Before a PR: `npm run typecheck` and `npm test` must pass; add tests for new behaviour; keep files under ~300 lines; no local paths or secrets in code; UI text is Chinese, identifiers are English; `server/` uses Node built-ins only; one topic per PR.
- Be respectful. Do not generate content from another person's likeness without their consent.
