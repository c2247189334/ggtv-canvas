import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { runAgentProcess } from './agentProcess.mjs';
import { tempDir } from './testKit.mjs';

const launch = seen => (cli, args, options) => {
  seen.push(readdirSync(options.cwd));
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  setImmediate(() => { child.stdout.emit('data', 'ok'); child.emit('close'); });
  return child;
};
const run = (tmpRoot, files, seen = []) => runAgentProcess({ name: 'Claude', command: 'claude', cli: 'claude.exe', args: [], files, tmpRoot, env: {},
  launch: launch(seen), limit: 1000 });

test('给 agent 的文件只能写进这次的临时目录：文件名带路径就拒绝，不启动、不留东西', async () => {
  const root = tempDir(), tmpRoot = join(root, 'tmp');
  for (const name of ['..\\..\\escape.txt', '../../escape.txt', 'sub/inner.txt', '..', '']) {
    const seen = [];
    await assert.rejects(run(tmpRoot, [{ name, buffer: Buffer.from('x') }], seen), /文件名不对/, name);
    assert.equal(seen.length, 0, '没启动 agent');
  }
  assert.equal(existsSync(join(root, 'escape.txt')), false);
  assert.deepEqual(readdirSync(tmpRoot), [], '临时目录用完删掉');
});

test('正常文件名照旧写进临时目录再启动', async () => {
  const seen = [];
  const output = await run(join(tempDir(), 'tmp'), [{ name: '背景2_原片4.0s.jpg', buffer: Buffer.from('x') }, { name: '底稿.txt', buffer: Buffer.from('y') }], seen);
  assert.equal(output.stdout, 'ok'); assert.deepEqual(seen[0].sort(), ['底稿.txt', '背景2_原片4.0s.jpg'].sort());
});
