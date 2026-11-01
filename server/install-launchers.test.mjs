import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempDir } from './testKit.mjs';

const bytes = () => readFileSync(new URL('../一键启动.bat', import.meta.url));
function runSection(from, to, setup, env = process.env) {
  const raw = bytes(), start = raw.indexOf(Buffer.from(from)), end = raw.indexOf(Buffer.from(to));
  assert.ok(start >= 0 && end > start, `缺少分支标记 ${from}`);
  const cwd = tempDir('launcher-release-'); setup(cwd);
  writeFileSync(join(cwd, 'branch.cmd'), Buffer.concat([Buffer.from('@echo off\r\nchcp 936 >nul\r\n'),
    raw.subarray(start, end), Buffer.from('\r\nexit /b 0\r\n')]));
  const result = spawnSync('cmd.exe', ['/d', '/c', '.\\branch.cmd'], { cwd, env, input: '', windowsHide: true, timeout: 5000 });
  return { code: result.status, output: new TextDecoder('gbk').decode(result.stdout) };
}

test('启动依赖分支识别源码、整合包、缺少页面三种情况，整合包不执行打包；缺页面先指去 Releases 下整合包', () => {
  for (const [kind, code] of [['source', 0], ['bundle', 0], ['missing', 1]]) {
    const result = runSection('rem RELEASE_CHECK_BEGIN', 'rem RELEASE_CHECK_END', cwd => {
      if (kind === 'source') { mkdirSync(join(cwd, 'node_modules/.bin'), { recursive: true }); writeFileSync(join(cwd, 'node_modules/.bin/vite.cmd'), ''); }
      if (kind === 'bundle') { mkdirSync(join(cwd, 'dist')); writeFileSync(join(cwd, 'dist/index.html'), 'page'); }
    });
    assert.equal(result.code, code);
    if (kind === 'bundle') assert.match(result.output, /整合包：页面已打包好/);
    if (kind === 'missing') {
      // 新手点 GitHub「Download ZIP」拿到的是源码包：先说清去哪下整合包，开发者命令和 README 一样用 npm ci。
      assert.match(result.output, /https:\/\/github\.com\/c2247189334\/ggtv-canvas\/releases/);
      assert.match(result.output, /npm ci/);
    }
  }
});

test('启动前缺少 ffmpeg 或 ffprobe 任一项都停下，不执行安装', () => {
  for (const absent of ['ffmpeg', 'ffprobe']) {
    const cwd = tempDir();
    // where.exe 仍用系统工具，通过假工具文件控制 PATH 搜索结果。
    writeFileSync(join(cwd, `${absent === 'ffmpeg' ? 'ffprobe' : 'ffmpeg'}.exe`), '');
    const result = runSection('rem MEDIA_CHECK_BEGIN', 'rem MEDIA_CHECK_END', () => {},
      { ...process.env, PATH: `${cwd};${process.env.SystemRoot}\\System32` });
    assert.equal(result.code, 1); assert.match(result.output, /winget install Gyan.FFmpeg/);
    assert.match(result.output, new RegExp(absent));
  }
});

test('所有交付 bat 均为 GBK CRLF，安装/体检外壳沿用 Node 门槛并保留退出码', () => {
  const launcher = new TextDecoder('gbk', { fatal: true }).decode(bytes());
  const gate = launcher.match(/^node -e .*$/m)[0];
  for (const name of ['一键启动.bat', '停止.bat', '安装深度.bat', '检查白模环境.bat']) {
    const raw = readFileSync(new URL(`../${name}`, import.meta.url));
    const content = new TextDecoder('gbk', { fatal: true }).decode(raw);
    assert.match(content, /^@echo off\r\nchcp 936 >nul\r\n/);
    assert.doesNotMatch(content, /(?<!\r)\n|\r(?!\n)/);
    if (name.includes('深度') || name.includes('白模')) {
      assert.ok(content.includes(gate)); assert.match(content, /%\*/);
      assert.match(content, /set "RESULT=%ERRORLEVEL%"/); assert.match(content, /exit \/b %RESULT%/);
      assert.match(content, /pause/);
    }
  }
});

test('Git 不改 bat 换行：.gitattributes 把 bat 标成 -text，别人拉源码也拿到 CRLF', () => {
  const rules = readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8');
  assert.match(rules, /^\*\.bat -text$/m);
});
