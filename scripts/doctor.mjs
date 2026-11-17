// 体检：npm run doctor（整合包里是 node scripts/doctor.mjs）。
// 一次列出这台电脑能不能启动、每个功能还缺什么、怎么补。给新手和帮新手装的 AI 助手看（11-17 用户定）。
// 只读：不装任何东西、不改任何文件；只报「填没填 / 找没找到」，不打印密钥和本机路径。
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5290;

/** 和 一键启动.bat 同一个门槛：20.19 以上的 20.x，或 22.12 以上。 */
export function nodeOk(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22;
}

const FFMPEG_FIX = '在终端运行 winget install Gyan.FFmpeg（同时带 ffprobe）；装完要新开一个终端窗口、重新启动 GG TV 才认得到';

/**
 * 把查到的情况写成给人看的清单。facts 里只有真假和名字，没有任何配置值。
 * 返回 lines（逐行文字）、canStart（能不能启动）、todo（还没备齐的功能数，不含选装）。
 */
export function doctorReport(facts) {
  const lines = ['GG TV 体检（只读：不安装、不修改任何东西）', ''];
  let todo = 0;
  const item = (ok, name, good, bad, fix, tag = '缺') => {
    lines.push(`  [${ok ? 'OK' : tag}] ${name}：${ok ? good : bad}`);
    if (!ok && fix) lines.push(`        怎么办：${fix}`);
    if (!ok && tag === '缺') todo++;
  };
  const pageOk = facts.hasDeps || facts.hasDist;

  lines.push('一、能不能启动');
  item(facts.nodeOk, 'Node.js', `${facts.nodeVersion}`, `${facts.nodeVersion} 版本太旧`,
    '装 Node.js 22.12 或以上（winget install OpenJS.NodeJS.LTS，或到 https://nodejs.org 下载）；装完新开一个终端窗口');
  item(pageOk, '页面', facts.hasDeps ? '依赖已装，启动时自动打包' : '已打包好（整合包）', '没有装依赖，也没有打包好的页面',
    '在项目文件夹运行 npm ci（只照 package-lock.json 装，不改版本）');
  item(facts.portFree || facts.ggtvRunning, `端口 ${PORT}`, facts.portFree ? '空着' : `GG TV 已经开着，直接打开 http://127.0.0.1:${PORT} 就行；想重开先双击 停止.bat`,
    '被别的程序占着（不是 GG TV）', '先关掉占着它的那个程序再启动。不确定是什么程序就把这一条原样告诉用户，不要自己去结束进程', '注意');

  lines.push('', '二、出图、出视频（火山方舟，按量计费，从用户自己的火山账号扣）');
  item(facts.keyReady, '火山 Key', '已填', '还没填',
    '启动后由用户本人在页面右上角「设置」里填（里面有「怎么拿 Key」）。AI 助手不要向用户要 Key，也不要替用户填');
  item(facts.tosReady, 'TOS 三项', '已填', '还没填（只有「拿视频当参考出片」才要，别的用不到）', '同上，由用户本人在「设置」里填', '可晚点');

  lines.push('', '三、本机处理视频：片段截取、视频截图、提取原声、视频改写');
  item(facts.ffmpegFound && facts.ffprobeFound, 'ffmpeg / ffprobe', '都找到了',
    `没找到 ${[facts.ffmpegFound ? '' : 'ffmpeg', facts.ffprobeFound ? '' : 'ffprobe'].filter(Boolean).join('、')}`, FFMPEG_FIX);

  lines.push('', '四、本机 AI 助手：视频改写、拆解、帮我改写（用用户自己的 Claude / Codex 账号额度，不花火山的钱）');
  item(facts.agentReady, facts.agentName || '本机 AI 助手', `已就绪${facts.agentModel ? `，模型 ${facts.agentModel}` : ''}`, facts.agentProblem || '没配好',
    '装好后由用户本人登录一次；只认 .exe，用 npm 全局装出来的 .cmd 启动不了。只出图、出视频用不到它');

  lines.push('', '五、选装（不装不影响别的功能）');
  item(facts.depthReady, '深度动作捕捉', '已装好', '没装', '要 NVIDIA 显卡和约 15 GB 硬盘；双击 安装深度.bat，步骤见 docs/安装说明.md', '选装');
  item(facts.meshReady, '白模动作捕捉', '已就绪', '没装', '要 ComfyUI 便携版和 4 个模型；步骤见 docs/安装说明.md，双击 检查白模环境.bat 体检', '选装');

  const canStart = facts.nodeOk && pageOk;
  lines.push('', canStart
    ? `结论：可以启动。双击 一键启动.bat，浏览器会打开 http://127.0.0.1:${PORT}；用完关掉黑窗口或双击 停止.bat。${todo ? `还有 ${todo} 项功能没备齐，见上面标 [缺] 的。` : '各项功能都备齐了。'}`
    : '结论：还不能启动，先补「一、能不能启动」里标 [缺] 的。');
  return { lines, canStart, todo };
}

/** 端口被占时问一句：占着它的是不是 GG TV 自己（看体检接口回的样子）。连不上、回的不像就算不是。 */
async function isGgtv(port) {
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })).json();
    return health?.ok === true && typeof health.keyReady === 'boolean';
  } catch { return false; }
}

function portFree(port) {
  return new Promise(done => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
  });
}

/** 查这台电脑的实际情况。Node 太旧时别的模块可能载入不了，所以先只报版本。 */
export async function collectFacts(projectRoot = root, { port = PORT, probe = isGgtv } = {}) {
  const base = { nodeVersion: `v${process.versions.node}`, nodeOk: nodeOk(),
    hasDeps: existsSync(join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')),
    hasDist: existsSync(join(projectRoot, 'dist', 'index.html')), portFree: await portFree(port) };
  base.ggtvRunning = !base.portFree && await probe(port);
  if (!base.nodeOk) return base;
  const { depthHealth, keyFilled, meshHealth, readEnvFile, tosFilled } = await import('../server/config.mjs');
  const { agentHealth } = await import('../server/agent.mjs');
  const env = readEnvFile(projectRoot);
  const local = depthHealth(env), { depth } = local, { mesh } = await meshHealth(env);
  const { agentName, agentReady, agentModel, agentProblem } = agentHealth(env);
  return { ...base, keyReady: keyFilled(env), tosReady: tosFilled(env), ffmpegFound: local.ffmpegFound, ffprobeFound: local.ffprobeFound,
    agentName, agentReady, agentModel, agentProblem,
    depthReady: depth.python.found && depth.modelDir.found && (!depth.extraPackages.filled || depth.extraPackages.found),
    meshReady: mesh.ready };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = doctorReport(await collectFacts());
    console.log(report.lines.join('\n'));
    process.exitCode = report.canStart ? 0 : 1;
  } catch {
    console.error('体检没跑完：请确认是在 GG TV 的项目文件夹里运行，文件没有缺。');
    process.exitCode = 1;
  }
}
