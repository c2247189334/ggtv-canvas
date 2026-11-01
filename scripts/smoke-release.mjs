// 整合包冒烟测试：把 release/ 里的 zip 解到系统临时目录，不装依赖、用假火山起小服务，确认 health 和页面能打开。
// 自动检查（.github/workflows/check.yml）在 npm run pack 之后跑它；本机也能跑：npm run smoke。
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './command.mjs';
import { unzipTo } from './zip.mjs';

const PORT = 5297;

async function open(url, seconds) {
  for (let i = 0; i < seconds; i++) {
    try { const response = await fetch(url); if (response.ok) return response; } catch { /* 还没起来，接着等 */ }
    await new Promise(done => setTimeout(done, 1000));
  }
  throw Error(`${seconds} 秒内打不开 ${url}`);
}

export async function smokeRelease(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const release = join(root, 'release');
  const zips = readdirSync(release).filter(file => file.endsWith('-win.zip'));
  if (zips.length !== 1) throw Error(`release/ 里应正好有 1 个整合包，现在有 ${zips.length} 个`);
  const temp = mkdtempSync(join(tmpdir(), 'ggtv-smoke-'));
  try {
    unzipTo(join(release, zips[0]), temp);
    const app = join(temp, zips[0].replace(/\.zip$/, ''));
    const server = spawn(process.execPath, ['server/start.mjs', '--fake', `--port=${PORT}`], { cwd: app, stdio: 'inherit' });
    const exited = new Promise(done => server.once('exit', done));
    try {
      await open(`http://127.0.0.1:${PORT}/api/health`, 30);
      const page = await (await open(`http://127.0.0.1:${PORT}/`, 5)).text();
      if (!page.includes('<div id="root">')) throw Error('首页不是打包好的页面');
      return zips[0];
    } finally {
      server.kill(); await exited;
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  smokeRelease().then(zip => console.log(`冒烟测试通过：${zip} 解压后不装依赖，假火山模式 health 和页面都能打开。`))
    .catch(error => { console.error(`冒烟测试失败：${error.message}`); process.exitCode = 1; });
}
