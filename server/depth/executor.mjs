// 追踪本项目启动的子进程，关闭时结束整个进程树（包含 Python 的 ffmpeg）。
import { spawn, spawnSync } from 'node:child_process';

/** 用户点了停止：带 canceled 标记，排队那边据此写「已停止」而不是失败原因。 */
export const stoppedError = () => Object.assign(Error('已停止'), { canceled: true });

export function createExecutor({ launch = spawn, killTree } = {}) {
  const children = new Set();
  const kill = killTree ?? (child => {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      if (result.error || result.status !== 0) child.kill();
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  });
  let stopped = false;
  /** signal：用户点停止时只结束这一单的进程树，别的进程照跑。 */
  function run(command, args, { signal } = {}) {
    if (stopped) return Promise.reject(Error('小服务正在退出。'));
    if (signal?.aborted) return Promise.reject(stoppedError());
    return new Promise((resolve, reject) => {
      const child = launch(command, args, { windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
      children.add(child);
      const abort = () => kill(child);
      signal?.addEventListener('abort', abort, { once: true });
      let stderr = '', stdout = '';
      child.stdout?.on('data', chunk => { stdout = (stdout + chunk).slice(-16384); });
      child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-16384); });
      child.once('error', error => { children.delete(child); reject(error); });
      child.once('close', (code, exitSignal) => {
        children.delete(child); signal?.removeEventListener('abort', abort);
        if (signal?.aborted) reject(stoppedError());
        else if (code === 0) resolve({ stdout, stderr });
        else reject(Error(`${command} 退出码 ${code ?? exitSignal}\n${stderr.trim()}`));
      });
    });
  }
  function stop() {
    stopped = true;
    for (const child of children) kill(child);
  }
  return { run, stop };
}

export function installShutdown(stop, events = process) {
  let closed = false;
  const close = () => { if (!closed) { closed = true; stop(); } };
  const signal = () => { close(); events.exit(0); };
  events.once('exit', close);
  events.once('SIGINT', signal);
  events.once('SIGTERM', signal);
  events.once('SIGHUP', signal);
  return close;
}
