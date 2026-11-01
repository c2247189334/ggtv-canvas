import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const COMFY_START_MS = 3 * 60 * 1000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// 和 depth/executor.mjs 相同：Windows 按 PID 关整棵树，POSIX 关进程组。
function killProcessTree(child) {
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    if (result.error || result.status !== 0) child.kill();
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

/** 只持有本服务自己起的进程；不接管地址上原先已有的 ComfyUI。 */
export function createComfyProcess({ launch = spawn, killTree = killProcessTree, exists = existsSync,
  sleep = pause, now = Date.now, startTimeoutMs = COMFY_START_MS } = {}) {
  let owned = null, stopped = false;
  async function ensure(client, dir = '') {
    if (stopped) throw Error('小服务正在退出。');
    try { await client.stats(); return; }
    catch (error) {
      if (!dir) throw Error(`连不上 ComfyUI，先打开它或在 .env.local 填 COMFYUI_DIR，再点一次\n${error.message}`);
    }
    if (!exists(join(dir, 'python_embeded', 'python.exe')) || !exists(join(dir, 'ComfyUI', 'main.py'))) {
      throw Error('COMFYUI_DIR 找不到 python_embeded/python.exe 或 ComfyUI/main.py，请检查便携版文件夹。');
    }
    let output = '', failure = '';
    if (!owned) {
      try {
        owned = launch(join(dir, 'python_embeded', 'python.exe'), ['-s', join('ComfyUI', 'main.py'),
          '--windows-standalone-build', '--listen', '127.0.0.1', '--port', client.base.port || (client.base.protocol === 'https:' ? '443' : '80'),
          '--disable-auto-launch'], { cwd: dir, windowsHide: true, detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
      } catch (error) { throw Error(`ComfyUI 启动失败：${error.message}`); }
      const child = owned;
      const append = chunk => { output = (output + chunk).slice(-16384); };
      child.stdout?.on('data', append); child.stderr?.on('data', append);
      child.once('error', error => { failure = error.message; if (owned === child) owned = null; });
      child.once('close', (code, signal) => { failure = `退出码 ${code ?? signal}`; if (owned === child) owned = null; });
    }
    const end = now() + startTimeoutMs;
    let last = '';
    while (now() < end && !stopped) {
      if (failure) throw Error(`ComfyUI 启动失败：${failure}\n${tail(output)}`);
      try { await client.stats(); return; }
      catch (error) { last = error.message; }
      await sleep(Math.min(1000, Math.max(0, end - now())));
    }
    if (owned) { killTree(owned); owned = null; }
    throw Error(`${stopped ? '小服务正在退出' : 'ComfyUI 启动超时'}：${last}\n${tail(output)}`);
  }
  function stop() {
    stopped = true;
    if (owned) { killTree(owned); owned = null; }
  }
  return { ensure, stop };
}

const tail = output => output.trim().split(/\r?\n/).slice(-6).join('\n');
