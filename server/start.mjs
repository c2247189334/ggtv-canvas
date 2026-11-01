// 小服务入口。一键启动.bat 跑的就是它：node server/start.mjs
// 只绑 127.0.0.1，不对局域网 / 公网开放。加 --fake 是假火山（不花钱，数据落 .fake-data/），
// --fake-delay=8000 让假火山每张等 8 秒（验收「生成中途关掉小服务」用）。
import { createServer } from 'node:http';
import { createApp } from './app.mjs';
import { pruneUploads, pruneRewrites } from './cleanup.mjs';
import { argValue, keyFilled, readEnvFile, runtimeOptions } from './config.mjs';
import { createFakeArk } from './fakeArk.mjs';
import { createLogger } from './log.mjs';
import { concurrencyOf } from './queue.mjs';
import { defaultArkFetch, generateOne } from './seedream.mjs';
import { createSeedance } from './seedance.mjs';
import { createFakeSeedance } from './fakeSeedance.mjs';
import { createTos } from './tos.mjs';
import { transport } from './net.mjs';
import { installShutdown } from './depth/executor.mjs';

const options = runtimeOptions();
const logError = createLogger(options.logDir);

// Node 默认：没人接的异常 = 进程直接退出，黑窗口一关连报错都看不到。记进日志，服务接着跑。
process.on('uncaughtException', (err) => logError('没接住的异常（服务继续运行）', err));
process.on('unhandledRejection', (err) => logError('没接住的 Promise 拒绝（服务继续运行）', err));

const readEnv = () => readEnvFile();
const fakeDelay = Number(argValue(process.argv.slice(2), 'fake-delay') ?? 1500);
const fakeDelayMs = Number.isFinite(fakeDelay) && fakeDelay >= 0 ? fakeDelay : 1500;
const generate = options.fake
  ? createFakeArk({ delayMs: fakeDelayMs })
  : (request) => generateOne(request, { env: readEnv(), fetch: defaultArkFetch(), log: console.error });

// 每单重读配置；网络只走net.mjs，TOS桶变更时也使用当前白名单。
const fakeVideo = options.fake ? createFakeSeedance({ delayMs: fakeDelayMs }) : null;
const videoClient = fakeVideo ?? {
  submit: request => createSeedance({ env: readEnv(), fetch: transport(readEnv()).fetch }).submit(request),
  query: taskId => createSeedance({ env: readEnv(), fetch: transport(readEnv()).fetch }).query(taskId),
  download: url => createSeedance({ env: readEnv(), fetch: transport(readEnv()).fetch }).download(url)
};
const uploadVideo = fakeVideo?.uploadVideo ?? (asset => {
  const env = readEnv();
  return createTos({ env, fetch: transport(env).fetch }).uploadVideo(asset);
});
const app = createApp({ ...options, fakeDelayMs, readEnv, generate, videoClient, uploadVideo, logError, log: console.log, concurrency: concurrencyOf(readEnv()) });
installShutdown(() => { app.depthQueue.stop(); app.stopVideoRewrite(); });

const fixed = app.queue.recover();
if (fixed) console.log(`  上次退出时有 ${fixed} 单正在生成，已标「结果不明」，没有自动重发（怕重复花钱）。`);
const videoFixed = app.videoQueue.recover();
const depthFixed = app.depthQueue.recover();
if (depthFixed) console.log(`  ${depthFixed} 单深度或白模视频没算完，已标失败，没有自动重跑。`);
if (videoFixed) console.log(`  收拾了 ${videoFixed} 单视频：有任务号的继续查，提交过没任务号的标结果不明，其余重新排队。`);
const pruned = pruneUploads(app.stores);
const rewritePruned = pruneRewrites({ dataRoot: options.dataRoot });
if (rewritePruned.skipped) console.log('  改写中间目录不是普通文件夹，已跳过清理，请检查本地文件。');
if (pruned.skipped) console.log('  有画布存档读不出来，这次没清理传的图（怕删掉还在用的）。');
else if (pruned.removed) console.log(`  清掉了 ${pruned.removed} 张已经没有画布在用的传的图。`);
app.queue.pump();
app.videoQueue.pump();
app.depthQueue.pump();

const server = createServer(app.handler);
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  [X] 端口 ${options.port} 被占用了。可能已经开着一个，先双击 停止.bat 再试。\n`);
  } else {
    logError('小服务启动失败', err);
  }
  process.exit(1);
});
server.listen(options.port, '127.0.0.1', () => {
  console.log('');
  console.log(options.fake ? '  GG TV 已启动（假火山模式：出的是纯色假图，不花钱）' : '  GG TV 已启动');
  console.log(`  浏览器打开：http://127.0.0.1:${options.port}`);
  if (!options.fake && !keyFilled(readEnv())) console.log('  ⚠ .env.local 里还没填 ARK_API_KEY，出图用不了（填好不用重启）。');
  console.log('  关掉这个窗口就停止服务。');
  console.log('');
});
