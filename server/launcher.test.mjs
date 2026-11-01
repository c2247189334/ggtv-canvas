import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './testKit.mjs';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';

const bytes = readFileSync(new URL('../一键启动.bat', import.meta.url));
const script = new TextDecoder('gbk', { fatal: true }).decode(bytes);
function gate() {
  const match = script.match(/^node -e "([^"\r\n]+)" >nul 2>nul\r?$/m);
  assert.ok(match, '启动脚本缺少 Node 版本及 parseEnv 检查'); return match[1];
}
test('启动脚本保留GBK及CRLF，不引入UTF-8 BOM或孤立LF', () => {
  assert.equal(bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])), false);
  assert.ok(script.includes('GG TV')); assert.doesNotMatch(script, /(?<!\r)\n/);
});
test('Node门槛与Vite engines一致，并确认util.parseEnv可用', () => {
  const source = gate();
  for (const [version, expected] of [['18.20.0', 1], ['20.18.3', 1], ['20.19.0', 0], ['21.7.0', 1],
    ['22.11.0', 1], ['22.12.0', 0], ['24.16.0', 0]]) {
    let code = 0;
    runInNewContext(source, { process: { versions: { node: version }, exit: n => { code = n; } },
      require: () => ({ parseEnv() {} }) });
    assert.equal(code, expected, version);
  }
  let code = 0;
  runInNewContext(source, { process: { versions: { node: '24.16.0' }, exit: n => { code = n; } }, require: () => ({}) });
  assert.equal(code, 1, '缺少parseEnv也必须拒绝');
});
test('版本不支持的独立bat分支保留窗口、提示当前/所需版本并返回1', () => {
  gate();
  const start = script.indexOf('rem NODE_VERSION_CHECK_BEGIN'), end = script.indexOf('rem NODE_VERSION_CHECK_END');
  assert.ok(start >= 0 && end > start);
  const branch = script.slice(start, end).replace(/^for \/f[^\r\n]+/m, 'set "NODE_CURRENT_VERSION=v20.18.0"')
    .replace(/^node -e [^\r\n]+/m, 'cmd /d /c exit /b 1');
  assert.match(branch, /pause/); assert.match(branch, /exit \/b 1/);
  // 从原GBK文件取片段，替换只涉及ASCII；不运行原启动脚本，也不走依赖/端口/构建分支。
  const sourceStart = bytes.indexOf(Buffer.from('rem NODE_VERSION_CHECK_BEGIN'));
  const sourceEnd = bytes.indexOf(Buffer.from('rem NODE_VERSION_CHECK_END'));
  const replacements = new Map([
    [script.match(/^for \/f[^\r\n]+/m)?.[0], 'set "NODE_CURRENT_VERSION=v20.18.0"'],
    [script.match(/^node -e [^\r\n]+/m)?.[0], 'cmd /d /c exit /b 1']
  ]);
  let raw = bytes.subarray(sourceStart, sourceEnd);
  for (const [from, to] of replacements) {
    assert.ok(from); const at = raw.indexOf(Buffer.from(from, 'ascii')); assert.ok(at >= 0);
    raw = Buffer.concat([raw.subarray(0, at), Buffer.from(to, 'ascii'), raw.subarray(at + from.length)]);
  }
  const folder = tempDir('node-gate-'), file = join(folder, 'branch.cmd');
  writeFileSync(file, Buffer.concat([Buffer.from('@echo off\r\nchcp 936 >nul\r\n'), raw, Buffer.from('exit /b 0\r\n')]));
  const result = spawnSync('cmd.exe', ['/d', '/c', '.\\branch.cmd'], { cwd: folder, input: '', windowsHide: true, timeout: 5000 });
  assert.equal(result.status, 1, result.error?.message);
  const output = new TextDecoder('gbk').decode(result.stdout);
  assert.match(output, /v20\.18\.0/, new TextDecoder('gbk').decode(result.stderr));
  assert.match(output, /20\.19\.0/); assert.match(output, /22\.12\.0/);
});
test('独立bat检查分支在本机Node通过，未进入依赖、构建或服务分支', () => {
  const start = bytes.indexOf(Buffer.from('rem NODE_VERSION_CHECK_BEGIN'));
  const end = bytes.indexOf(Buffer.from('rem NODE_VERSION_CHECK_END'));
  assert.ok(start >= 0 && end > start);
  const folder = tempDir('node-gate-'), file = join(folder, 'supported.cmd');
  writeFileSync(file, Buffer.concat([Buffer.from('@echo off\r\nchcp 936 >nul\r\n'), bytes.subarray(start, end),
    Buffer.from('exit /b 0\r\n')]));
  const result = spawnSync('cmd.exe', ['/d', '/c', '.\\supported.cmd'], { cwd: folder, input: '', windowsHide: true, timeout: 5000 });
  assert.equal(result.status, 0, new TextDecoder('gbk').decode(result.stderr));
  assert.ok(new TextDecoder('gbk').decode(result.stdout).includes(`Node.js ${process.version}  OK`));
});
