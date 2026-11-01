# 安全问题 / Security

## 怎么报告

发现安全漏洞（比如密钥会泄露、别的网站能调本机小服务、安装脚本能被篡改），请**不要**开公开 issue，用 GitHub 的 [私密报告](../../security/advisories/new)（仓库 Security 标签页 → Report a vulnerability）。说明复现步骤和影响范围，报告里不要带你自己的密钥。

这是个人维护的项目，没有专门的安全团队。一般几天内会回复，修好后在更新记录里致谢（你愿意的话）。

## 哪些版本收报告

只维护最新发布的版本。预览版（0.x）升级时请整包换新，保留自己的 `.env.local` 和 `数据/`。

## 项目本身怎么保护你

- 小服务只绑 `127.0.0.1`，局域网和外网都访问不到；会检查来源，拒绝其他网站发来的请求。
- 密钥只放 `.env.local`，已被 `.gitignore` 排除；日志里的密钥会打码；`COMFYUI_URL` 只接受本机地址。
- 深度安装脚本固定依赖版本、钉住源码提交并核对权重文件的 sha256；下载、缓存和环境只落在项目的 `runtime/` 里。
- 整合包按白名单打包，带私人文件就拒绝打包；你下载到的 zip 里没有密钥、数据和日志。

## 你自己要注意的

- 不要把 `.env.local` 发给别人、贴进 issue 或提交到 Git。
- 火山方舟密钥按量扣费，怀疑泄露就去火山控制台重置。
- 只从本仓库的 Releases 下载整合包，并核对文件大小。

## English

Please report vulnerabilities privately through GitHub's [private vulnerability reporting](../../security/advisories/new) rather than a public issue, with reproduction steps and without your own keys. This is a single-maintainer project; only the latest release is supported. The local server binds `127.0.0.1` only and rejects cross-site requests; keys stay in the git-ignored `.env.local` and are masked in logs; the depth installer pins versions and verifies checksums; the release bundle is built from an allow-list and never contains keys, data or logs. Keep your `.env.local` private and reset your Ark key if you suspect it leaked.
