// 在临时目录里跑一次本机 agent 命令行：写文件 → 启动 → 收输出 → 超时就停 → 删目录。Claude、Codex 共用。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 不开 shell 的 spawn 启动不了 .cmd / .bat 外壳（npm 全局装出来的就是；Node 22 直接抛 spawn EINVAL），找命令行时不认它们。 */
export const startable = file => !/.(cmd|bat)$/i.test(file);

/** 返回 { stdout, stderr }。input 有值时走标准输入。环境变量只进子进程，不写文件、不打印。 */
export async function runAgentProcess({ name, command, cli, args, input, files = [], tmpRoot, env, launch, limit }) {
  const dir = join(tmpRoot, `${command}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  try {
    // 文件名只能是光名字：带路径、盘符冒号的会写到这次的临时目录外面，一律不收。
    if (files.some(file => !file.name || /[\\/:]/.test(file.name) || /^\.+$/.test(file.name))) throw Error(`给 ${name} 的文件名不对，没启动。`);
    for (const file of files) writeFileSync(join(dir, file.name), file.buffer);
    return await new Promise((resolve, reject) => {
      let stdout = '', stderr = '', done = false;
      let child;
      try { child = launch(cli, args, { cwd: dir, windowsHide: true, env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] }); }
      catch (error) { return reject(Error(`启动 ${command} 失败：${error.message}`)); }
      const timer = setTimeout(() => { if (!done) { done = true; child.kill(); reject(Error(`${name} 超过 ${Math.round(limit / 60000)} 分钟没回话，已停止。`)); } }, limit);
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', error => { if (!done) { done = true; clearTimeout(timer); reject(Error(`启动 ${command} 失败：${error.message}`)); } });
      child.once('close', () => { if (!done) { done = true; clearTimeout(timer); resolve({ stdout, stderr }); } });
      if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
