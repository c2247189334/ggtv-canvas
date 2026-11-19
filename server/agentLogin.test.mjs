import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAgentLogin, LOGIN_ENGINES, loginWindowCommand } from './agentLogin.mjs';

// 11-19 用户定：没登录的助手在设置里点「登录」，弹出官方登录窗口；用户电脑上的 codex / claude 多半不在 PATH 里，终端敲不出来。
// 正式用的是 PowerShell Start-Process 开新窗口（detached 开出来的窗口打不了字，见 agentLogin.mjs 开头）；这里换成假的启动器，不真开窗口。
const fakeChild = ({ fail, exitCode } = {}) => {
  const child = new EventEmitter();
  child.unref = () => { child.unrefed = true; };
  queueMicrotask(() => { if (fail) child.emit('error', Error(fail)); else if (exitCode !== undefined) child.emit('exit', exitCode); });
  return child;
};
const found = { claude: 'C:/u/.local/bin/claude.exe', codex: 'C:/u/AppData/Local/OpenAI/Codex/bin/abc/codex.exe' };
// 找程序时用的是系统的路径拼法（Windows 是反斜杠），比较前统一成正斜杠；Codex 还要先看见 bin 那层文件夹。
const seen = new Set([...Object.values(found), 'C:/u/AppData/Local/OpenAI/Codex/bin']);
const findOptions = { exists: file => seen.has(file.replace(/\\/g, '/')), readdir: () => ['abc'], mtime: () => 1, path: '', localAppData: 'C:/u/AppData/Local', userHome: 'C:/u', platform: 'win32' };
const base = { findOptions, cwd: 'C:/u', platform: 'win32', earlyExitMs: 5, processEnv: { SystemRoot: 'C:\\Windows', PATH: 'x' } };
const slash = text => text.replace(/\\/g, '/');

test('交给 PowerShell 的那一句：新窗口开程序 + 参数，等它关掉；单引号写两遍，不会被拆开', () => {
  assert.equal(loginWindowCommand('C:/u/codex.exe', ['login'], 'C:/u'),
    "$p = Start-Process -FilePath 'C:/u/codex.exe' -ArgumentList 'login' -WorkingDirectory 'C:/u' -PassThru; $p.WaitForExit()");
  assert.equal(loginWindowCommand("C:/Users/O'Brien/claude.exe", ['auth', 'login'], "C:/Users/O'Brien"),
    "$p = Start-Process -FilePath 'C:/Users/O''Brien/claude.exe' -ArgumentList 'auth','login' -WorkingDirectory 'C:/Users/O''Brien' -PassThru; $p.WaitForExit()");
});

test('按找到的完整路径开官方登录命令：Claude 是 auth login、Codex 是 login；PowerShell 自己藏起来', async () => {
  const calls = [];
  const open = createAgentLogin({ ...base, processEnv: { ...base.processEnv, ANTHROPIC_API_KEY: 'sk-secret', CLAUDECODE: '1' },
    launch: (cli, args, options) => { calls.push({ cli, args, options }); return fakeChild(); } });
  assert.deepEqual(await open('codex', {}), { opened: true });
  assert.deepEqual(await open('claude', {}), { opened: true });
  assert.deepEqual(calls.map(call => slash(call.cli)), ['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe']);
  const commands = calls.map(call => slash(call.args.at(-1)));
  assert.match(commands[0], new RegExp(`-FilePath '${found.codex}' -ArgumentList 'login' `));
  assert.match(commands[1], new RegExp(`-FilePath '${found.claude}' -ArgumentList 'auth','login' `));
  for (const { args, options } of calls) {
    assert.deepEqual(args.slice(0, -1), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']);
    assert.deepEqual([options.windowsHide, options.stdio], [true, 'ignore']);
  }
  // Claude 的登录窗口里去掉 API Key 和会话变量：只走用户自己的官方登录。
  assert.deepEqual(calls[1].options.env, { SystemRoot: 'C:\\Windows', PATH: 'x' });
  assert.deepEqual(LOGIN_ENGINES, ['claude', 'codex']);
});

test('同一个助手的登录窗口还开着就不再开第二个；窗口关了能再开', async () => {
  const children = [];
  const open = createAgentLogin({ ...base, launch: () => { const child = fakeChild(); children.push(child); return child; } });
  await open('codex', {});
  assert.deepEqual(await open('codex', {}), { opened: true, already: true });
  assert.equal(children.length, 1); assert.equal(children[0].unrefed, true);
  children[0].emit('exit', 0);
  assert.deepEqual(await open('codex', {}), { opened: true });
  assert.equal(children.length, 2);
});

test('不认识的助手、没装、不是 Windows、窗口开不起来：都说人话；失败过的不算开着', async () => {
  const none = createAgentLogin({ ...base, findOptions: { ...findOptions, exists: () => false, localAppData: '' }, launch: () => fakeChild() });
  for (const engine of ['gemini', '', 7, undefined, 'codex login']) await assert.rejects(none(engine, {}), /只能登录 Claude 或 Codex/);
  await assert.rejects(none('codex', {}), /没找到本机的 Codex，先装好 Codex 再来登录/);
  await assert.rejects(createAgentLogin({ ...base, platform: 'darwin', launch: () => fakeChild() })('codex', {}), /只在 Windows 上能用：请在终端运行 codex login/);
  await assert.rejects(createAgentLogin({ ...base, launch: () => fakeChild({ fail: 'spawn ENOENT' }) })('claude', {}), /打开 Claude 登录窗口失败：spawn ENOENT/);
  await assert.rejects(createAgentLogin({ ...base, launch: () => { throw Error('EINVAL'); } })('claude', {}), /打开 Claude 登录窗口失败：EINVAL/);
  let tries = 0;
  const flaky = createAgentLogin({ ...base, launch: () => (++tries === 1 ? fakeChild({ exitCode: 1 }) : fakeChild()) });
  await assert.rejects(flaky('codex', {}), /打开 Codex 登录窗口失败（PowerShell 退出码 1）/);
  assert.deepEqual(await flaky('codex', {}), { opened: true });
  // 登录很快就做完、PowerShell 正常退出（退出码 0）也算开成了。
  assert.deepEqual(await createAgentLogin({ ...base, launch: () => fakeChild({ exitCode: 0 }) })('codex', {}), { opened: true });
});
