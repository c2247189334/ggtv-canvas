# 给 AI 助手的安装说明（GG TV / ggtv-canvas，Windows）

这份说明是写给 **帮用户安装的 AI 助手**（Claude Code、Codex、Cursor 等）看的。用户多半是不看命令行的新手：照下面的步骤做，不要自己发挥；每做完一步用一两句大白话告诉用户。

人自己装请看 [安装说明](安装说明.md)。

## 先看这六条规矩

1. **不要碰密钥。** 不要向用户要火山 Key 或 TOS 密钥，不要让用户把它们贴进聊天，不要替用户填。密钥由用户本人在页面右上角「设置」里填（里面有「怎么拿 Key」的步骤）。
2. **装依赖只用 `npm ci`。** 不要运行 `npm install`、`npm update`、`npm audit fix`，不要改 `package.json` 和 `package-lock.json`。
3. **不要替用户常驻启动。** 不要在你的终端里用 `npm start`、`npm run dev` 把服务挂着就结束：你的会话一关服务就没了。装完让用户自己双击 `一键启动.bat`。
4. **不用跑测试。** `npm test`、`npm run typecheck`、`npm run pack` 是给开发者的，要好几分钟，和安装无关。检查装没装好只用 `npm run doctor`。
5. **选装的别主动装。** 深度、白模要 NVIDIA 显卡和十几 GB 下载，用户没明说要就不装，只告诉用户有这两样、想装看安装说明。
6. **只支持 Windows。** 不是 Windows 就停下来告诉用户。

装 Node.js、ffmpeg 这类系统软件前先问用户一句，同意了再装。

## 步骤

### 1. 准备 Node.js

```powershell
node --version
```

要 **22.12 或以上**（20.19 以上的 20.x 也行）。没装或太旧，征得用户同意后：

```powershell
winget install OpenJS.NodeJS.LTS
```

装完 **当前终端认不到**是正常的。不用让用户新开窗口：在当前 PowerShell 里运行下面这句，把系统里最新的 PATH（找程序的路径清单）读进来，再查一次版本：

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
node --version
```

- 这句只对它所在的那个 PowerShell 进程有效。很多 AI 助手每跑一条命令都是新开的进程，或者用的不是 PowerShell（比如 Git Bash）：那就把这句放在后面每条命令的最前面，写在同一条命令里跑，例如 `powershell -NoProfile -Command "<上面那句>; npm ci"`。
- 刷新后还是认不到：停下来，请用户把你（AI 助手）所在的终端或软件整个关掉重开，再接着做。
- 没有 `winget`（提示找不到这个命令）：请用户到 <https://nodejs.org> 下载 LTS 安装包，一路点「下一步」装好，再照上面刷新。

### 2. 拿到代码

让用户选一个普通的、可写的文件夹，比如 `D:\GGTV`（别放在压缩包里、别放系统目录；路径里有中文可以，尽量别带空格），然后：

```powershell
git clone https://github.com/c2247189334/ggtv-canvas.git
cd ggtv-canvas
npm ci
```

`npm ci` 结尾要是提示 `N vulnerabilities`，那是开发工具里的，不影响使用：不用处理，也不要运行 `npm audit fix`；用户问起就照这句话解释。

电脑上没有 git：不用专门装 git，到 <https://github.com/c2247189334/ggtv-canvas/releases/latest> 下载 `ggtv-canvas-版本号-win.zip`（不是 Source code），完整解压。整合包里页面已经打包好，**不用** `npm ci`，下面的 `npm run doctor` 换成 `node scripts/doctor.mjs`。

### 3. 体检

```powershell
npm run doctor
```

它只读不改，会列出能不能启动、每个功能还缺什么、怎么补：

- `[缺]` 而且「怎么办」是装软件的（比如 ffmpeg）：问用户要不要现在装。ffmpeg 可以晚点装，不影响打开画布、出图、出视频。
- 「怎么办」写着 **由用户本人** 的（火山 Key、TOS、登录 AI 助手）：只转告用户，不要代办。
- `[选装]`、`[可晚点]`：告诉用户有这回事就行。
- 端口 5290 那一行：写着「GG TV 已经开着」，说明这台电脑上已经有一份在运行（可能是用户以前装在别的文件夹的）。不要去关它，也 **不要运行 `停止.bat`**：它按端口找进程，会把用户正在用的那一份关掉。把情况告诉用户：同一台电脑一次只能开一份，想用新装的这份，先自己关掉正开着那份的黑窗口，再双击新文件夹里的 `一键启动.bat`。写着「被别的程序占着」就把这一条原样告诉用户，不要自己去结束进程。

装 ffmpeg（用户同意后）：

```powershell
winget install Gyan.FFmpeg
```

装完同样照第 1 步那句刷新当前终端的 PATH，再跑一次 `npm run doctor` 确认找到了。用户已经开着的 GG TV 要关掉黑窗口、重新双击 `一键启动.bat` 才认得到。

### 4. 交给用户

结论是「可以启动」就到此为止，照下面的话告诉用户（按实际情况改）：

> 装好了。以后用的时候，打开 `<文件夹路径>`，双击 **一键启动.bat**，浏览器会自己打开画布。
> 第一次打开，右上角「设置」会自己展开：在里面填你自己的火山 Key（不知道怎么拿就点开「怎么拿 Key」），点保存，不用重启。Key 不要发给我，也不要发给别人。
> 用完关掉那个黑窗口，或者双击 **停止.bat**。
> 现在还没备齐的：<照体检结果列，一条一句>。

顺便告诉用户双击后怎样算正常：黑窗口会依次显示 `[1/4]` 到 `[4/4]` 四步检查，最后出现「GG TV 已启动」，浏览器自己打开；哪一步不行会停下来显示 `[X]` 和原因，窗口不会自己关，把那几行原样发给你就行。

用户愿意的话，可以帮用户给 `一键启动.bat` 在桌面建一个快捷方式。

## 视频改写要用的「本机 AI 助手」

视频改写、拆解、帮我改写是让用户电脑上的 Claude 或 Codex 看视频和写提示词，用的是用户自己账号的额度。只出图、出视频用不到。

- 用谁是自动的：电脑上 Claude 装好并登录了就用 Claude，否则 Codex 装好并登录了就用 Codex。你（AI 助手）自己就是 Claude Code 或 Codex 的话，多半已经满足，不用再配。
- 找的是 `claude.exe`（Claude Code 的安装版，或 Claude 桌面版自带的那份）和 `codex.exe`。**只认 `.exe`**，用 `npm install -g` 装出来的 `claude.cmd`、`codex.cmd` 启动不了。
- 登录要用户本人来：在终端运行一次 `claude`（或 `codex login`），按提示登录。
- 想指定用哪个：告诉用户在页面右上角「设置」的「本机 AI 助手用谁」里点选，点了立刻生效。不用改 `.env.local`。
- 装好或登录后再跑一次 `npm run doctor` 确认。用户已经开着 GG TV 的话，让他在「设置」里点「重新检查」；还认不到再关掉黑窗口、重新双击 `一键启动.bat`。

## 以后升级

```powershell
git pull
npm ci
```

`数据/`（用户的作品）和 `.env.local`（用户的密钥）不要删、不要覆盖、不要提交。

## 出问题时

- 把黑窗口里的原始报错原样告诉用户，不要猜。常见问题在 [安装说明](安装说明.md) 最后一节。
- 项目里的 `.bat` 文件是 GBK 编码，按 UTF-8 读出来是乱码，这是正常的：不用读它们，照本说明做就行。
- 不要为了「让它能跑」去改项目代码、关掉检查或换依赖版本；解决不了就停下来，让用户到 <https://github.com/c2247189334/ggtv-canvas/issues> 反馈。
