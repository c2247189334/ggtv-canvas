import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './testKit.mjs';

test('安装前拒绝runtime及任意子目录的junction，外部目录保持空，命令不执行安装', async () => {
  const { setupDepth } = await import('../scripts/setup-depth.mjs');
  for (const nested of [false, true]) {
    const root = tempDir(), outside = tempDir(), calls = [];
    if (nested) mkdirSync(join(root, 'runtime'));
    symlinkSync(outside, join(root, nested ? 'runtime/cache' : 'runtime'), 'junction');
    await assert.rejects(setupDepth({ root, log: () => {}, exec: async (command, args) => {
      calls.push(command);
      if (command === 'nvidia-smi') return { stdout: 'CUDA Version: 12.8' };
      throw Error('安装不应执行');
    }}), /链接/);
    assert.deepEqual(readdirSync(outside), []); assert.deepEqual(calls, ['nvidia-smi']);
  }
});

// 11-01 真装：uv 在 runtime/python 里建 cpython-3.11-… → cpython-3.11.18-… 的 junction，环境靠它找 Python；一刀切拒绝会让重跑全失败。
test('runtime 里指向 runtime 内部的链接（uv 建的）放行，指向外部的照样拒绝', async () => {
  const { prepareRuntime } = await import('../scripts/depth-runtime.mjs');
  const root = tempDir(), python = join(root, 'runtime/python');
  mkdirSync(join(python, 'cpython-3.11.18-windows-x86_64-none'), { recursive: true });
  symlinkSync(join(python, 'cpython-3.11.18-windows-x86_64-none'), join(python, 'cpython-3.11-windows-x86_64-none'), 'junction');
  assert.doesNotThrow(() => prepareRuntime(root));
  const outside = tempDir();
  symlinkSync(outside, join(python, 'escape'), 'junction');
  assert.throws(() => prepareRuntime(root), /链接/);
});

test('压缩包路径拒绝绝对路径、上级目录和非预期顶层；拒绝链接条目', async () => {
  const { assertArchive } = await import('../scripts/install-safety.mjs');
  assert.doesNotThrow(() => assertArchive('expected/\nexpected/pkg/file.py\n', '-rw-r--r-- 0 root root file', 'expected'));
  for (const entries of ['../escape', 'expected/../../escape', '/root/escape', 'C:/escape', 'other/file']) {
    assert.throws(() => assertArchive(entries, '-rw-r--r-- file', 'expected'), /压缩包/);
  }
  assert.throws(() => assertArchive('expected/link', 'lrwxrwxrwx link -> outside', 'expected'), /链接/);
  assert.throws(() => assertArchive('', '', 'expected'), /压缩包/);
});

test('发版拒绝release目录链接，不向外部写入；不删除已有文件', async () => {
  const { packRelease } = await import('../scripts/pack-release.mjs');
  const root = tempDir(), outside = tempDir(), calls = [];
  writeFileSync(join(root, 'package.json'), '{"version":"1.0.0"}');
  symlinkSync(outside, join(root, 'release'), 'junction');
  await assert.rejects(packRelease({ root, exec: async command => calls.push(command) }), /链接/);
  assert.deepEqual(calls, []); assert.deepEqual(readdirSync(outside), []);
});
