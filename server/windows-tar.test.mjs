import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tempDir } from './testKit.mjs';

const missingMessage = '找不到 Windows 自带的 tar.exe，需要 Windows 10 1803 或更新版本';
function put(root, file, text = '') {
  mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text);
}

test('系统tar使用SystemRoot绝对路径，未设置时回退C:\\Windows；不搜索PATH', async () => {
  const { windowsTar } = await import('../scripts/command.mjs');
  const root = tempDir(), checked = [];
  const expected = join(root, 'System32/tar.exe');
  assert.equal(windowsTar({ env: { SystemRoot: root, PATH: 'git/usr/bin' }, exists: file => { checked.push(file); return true; } }), expected);
  assert.deepEqual(checked, [expected]);
  assert.equal(windowsTar({ env: {}, exists: () => true }), 'C:\\Windows\\System32\\tar.exe');
  assert.throws(() => windowsTar({ env: { SystemRoot: root }, exists: () => false }), { message: missingMessage });
});

test('深度解压uv和VDA都使用系统tar；缺失时不下载且保留明确错误', async () => {
  const { ensureUv, ensureSource } = await import('../scripts/depth-runtime.mjs');
  const { VDA_COMMIT } = await import('../scripts/depth-download.mjs');
  for (const found of [false, true]) {
    const root = tempDir(), system = tempDir(), calls = [], downloads = [], tar = join(system, 'System32/tar.exe');
    if (found) put(system, 'System32/tar.exe');
    const context = { env: { ...process.env, SystemRoot: system }, log: () => {},
      downloadFile: async (resource, file) => { downloads.push(file); put(dirname(file), file.split(/[\\/]/).at(-1), 'zip'); },
      exec: async (command, args) => {
        calls.push([command, args]);
        if (command === 'uv') throw Error('not on PATH');
        if (command.endsWith('System32\\tar.exe') || command === 'tar.exe') {
          assert.equal(command, tar);
          if (args[0] === '-tf') return { stdout: `Video-Depth-Anything-${VDA_COMMIT}/video_depth_anything/video_depth.py\n` };
          if (args[0] === '-tvf') return { stdout: '-rw-r--r-- video_depth.py\n' };
          const out = args[args.indexOf('-C') + 1];
          put(out, args[1].includes('uv-0.13.6') ? 'uv.exe' : `Video-Depth-Anything-${VDA_COMMIT}/video_depth_anything/video_depth.py`);
        }
        return { stdout: '' };
      } };
    if (found) {
      await ensureUv(root, context); await ensureSource(root, context);
      assert.deepEqual(calls.filter(([cmd]) => cmd === tar).map(([, args]) => args[0]), ['-xf', '-tf', '-tvf', '-xf']);
    } else {
      await assert.rejects(ensureUv(root, context), { message: missingMessage });
      await assert.rejects(ensureSource(root, context), { message: missingMessage });
      assert.deepEqual(downloads, []);
    }
  }
});
