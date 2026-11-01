import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

// 不从 PATH 找 tar，避免 Git 自带的 GNU tar 抢先处理 Windows 路径和 zip。
export function windowsTar({ env = process.env, exists = existsSync } = {}) {
  const file = join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  if (!exists(file)) throw Error('找不到 Windows 自带的 tar.exe，需要 Windows 10 1803 或更新版本');
  return file;
}

// 所有外部命令的唯一入口；调用方可注入 exec，测试不执行下载和安装。
export function execute(command, args, { cwd, env = process.env, inherit = false } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout?.on('data', chunk => { stdout = (stdout + chunk).slice(-64000); });
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
    child.once('error', error => reject(Object.assign(Error(`无法运行 ${command.split(/[\\/]/).at(-1)}（${error.code}）`), { code: error.code })));
    child.once('close', code => code === 0 ? resolveResult({ stdout }) :
      reject(Object.assign(Error(`外部程序退出码：${code}${errorTail(stderr)}`), { code })));
  });
}

// 失败时只带报错最后 5 行，网址里的账号密码（代理凭据）换成 ***，不然用户看不出为什么失败（11-01 真装 uv 只报退出码 2）。
function errorTail(stderr) {
  const lines = stderr.replace(/\/\/[^/@\s]+@/g, '//***@').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.length ? `；原文：\n${lines.slice(-5).join('\n')}` : '';
}

export function isMain(url) {
  return Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url));
}
