// 设置面板「登录 Claude / 登录 Codex」（11-19 用户定）：点了就开一个新黑窗口，跑官方自己的登录命令（claude auth login / codex login），
// 它会自己打开浏览器里的官方登录页。用户电脑上这两个程序多半不在 PATH 里（桌面版自带的那份），叫人去终端敲命令敲不出来，所以由小服务按找到的完整路径开。
// 本程序只负责把窗口打开：不读、不存、不转交任何登录信息（11-14 官方条款）；登好了没有，靠 health 里「登录过没有」看出来。
// 11-19 实测：Node 的 detached + stdio ignore 开出来的程序没有能打字的窗口（timeout.exe 11 毫秒就报错退出），登录时要粘贴的码收不到；
// 改成让 PowerShell 的 Start-Process 开，新窗口能正常打字。PowerShell 自己藏起来，等登录窗口关了才退出，用来知道「窗口还开着」。
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { childEnv, findClaudeCli } from './claude.mjs';
import { findCodexCli } from './codex.mjs';

const LOGINS = {
  claude: { name: 'Claude', find: findClaudeCli, args: ['auth', 'login'], env: childEnv },
  codex: { name: 'Codex', find: findCodexCli, args: ['login'], env: base => ({ ...base }) },
};
export const LOGIN_ENGINES = Object.freeze(Object.keys(LOGINS));
/** PowerShell 一启动就失败（比如程序打不开）通常 2 秒内退出；过了这段还没退就当窗口开起来了。 */
export const EARLY_EXIT_MS = 2000;

const quote = text => `'${String(text).replace(/'/g, "''")}'`;
/** 交给 PowerShell 的那一句：在新窗口里开 cli + args，等它关掉再退出。路径只来自本机找到的程序，不含用户输入；单引号按 PowerShell 规矩写两遍。 */
export function loginWindowCommand(cli, args, cwd) {
  return `$p = Start-Process -FilePath ${quote(cli)} -ArgumentList ${args.map(quote).join(',')} -WorkingDirectory ${quote(cwd)} -PassThru; $p.WaitForExit()`;
}

/**
 * 返回 open(engine, env)：打开这个助手的官方登录窗口，成了回 { opened: true }；同一个助手的窗口还开着就不再开第二个，回 { opened: true, already: true }。
 * 不认识的助手、没装、窗口开不起来都抛人话。launch / processEnv / findOptions / platform 给测试换掉，正式启动用真的。
 */
export function createAgentLogin({ launch = spawn, processEnv = process.env, findOptions, cwd = homedir(), platform = process.platform, earlyExitMs = EARLY_EXIT_MS } = {}) {
  const running = new Map();
  const powershell = join(processEnv.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return async function open(engine, env) {
    if (typeof engine !== 'string' || !Object.hasOwn(LOGINS, engine)) throw Error('只能登录 Claude 或 Codex。');
    const { name, find, args, env: envOf } = LOGINS[engine];
    if (running.has(engine)) return { opened: true, already: true };
    const cli = find(env, findOptions);
    if (!cli) throw Error(`没找到本机的 ${name}，先装好 ${name} 再来登录。`);
    if (platform !== 'win32') throw Error(`这个按钮只在 Windows 上能用：请在终端运行 ${name === 'Claude' ? 'claude auth login' : 'codex login'}。`);
    let child;
    try {
      child = launch(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', loginWindowCommand(cli, args, cwd)],
        { windowsHide: true, stdio: 'ignore', env: envOf(processEnv) });
    } catch (error) { throw Error(`打开 ${name} 登录窗口失败：${error.message}`); }
    running.set(engine, child);
    // 退出和出错都只 resolve，不 reject：过了开头那 2 秒才出的错没人等，reject 了会变成「没接住的 Promise」。
    const forget = () => { if (running.get(engine) === child) running.delete(engine); };
    const settled = new Promise(resolve => {
      child.once('exit', code => { forget(); resolve({ code }); });
      child.once('error', error => { forget(); resolve({ error }); });
    });
    let timer;
    const early = await Promise.race([settled, new Promise(resolve => { timer = setTimeout(() => resolve(null), earlyExitMs); })]);
    clearTimeout(timer);
    if (early?.error) throw Error(`打开 ${name} 登录窗口失败：${early.error.message}`);
    if (early && early.code !== 0) throw Error(`打开 ${name} 登录窗口失败（PowerShell 退出码 ${early.code}）。关掉黑窗口重新双击「一键启动.bat」再试。`);
    child.unref?.();
    return { opened: true };
  };
}
