import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { createComfyProcess } from './process.mjs';

const childProcess = () => Object.assign(new EventEmitter(), { pid: 99, stdout: new EventEmitter(), stderr: new EventEmitter() });
test('ComfyUI已通直接复用，不起进程，退出不关用户的ComfyUI', async () => {
  const killed = [];
  const process = createComfyProcess({ launch: () => assert.fail('不应启动'), killTree: child => killed.push(child.pid) });
  await process.ensure({ stats: async () => ({}) }); process.stop();
  assert.deepEqual(killed, []);
});
test('没填目录且连不上使用设计原话；目录不完整不启动', async () => {
  const process = createComfyProcess({ exists: () => false, launch: () => assert.fail('不应启动') });
  const client = { stats: async () => { throw Error('offline'); } };
  await assert.rejects(process.ensure(client), /连不上 ComfyUI，先打开它或在 .env.local 填 COMFYUI_DIR，再点一次/);
  await assert.rejects(process.ensure(client, 'portable'), /COMFYUI_DIR.*python_embeded.*main.py/);
});
test('自动启动隐藏便携Python，参数和cwd固定，等stats通了才返回，只关自己的进程树', async () => {
  const launched = [], killed = [], child = childProcess(); let calls = 0, time = 0;
  const client = { base: new URL('http://localhost:8190'), stats: async () => {
    if (++calls < 3) throw Error('warming up'); return {};
  } };
  const process = createComfyProcess({ exists: () => true, now: () => time, sleep: async ms => { time += ms; },
    launch: (...args) => { launched.push(args); return child; }, killTree: c => killed.push(c.pid) });
  await process.ensure(client, 'portable');
  assert.equal(calls, 3); assert.equal(launched.length, 1);
  const [command, args, options] = launched[0];
  assert.equal(command, join('portable', 'python_embeded', 'python.exe'));
  assert.deepEqual(args, ['-s', join('ComfyUI', 'main.py'), '--windows-standalone-build', '--listen', '127.0.0.1', '--port', '8190', '--disable-auto-launch']);
  assert.equal(options.cwd, 'portable'); assert.equal(options.windowsHide, true);
  await process.ensure(client, 'portable'); assert.equal(launched.length, 1);
  process.stop(); process.stop(); assert.deepEqual(killed, [99]);
  await assert.rejects(process.ensure(client, 'portable'), /小服务正在退出/);
});
test('启动超时包含最后六行输出并关掉失败的自有进程；进程报错也保留原文', async () => {
  const killed = [], child = childProcess(); let time = 0;
  const process = createComfyProcess({ exists: () => true, startTimeoutMs: 4000, now: () => time,
    sleep: async ms => { time += ms; child.stderr.emit('data', 'old\na\nb\nc\nd\ne\nlast failure\n'); },
    launch: () => child, killTree: c => killed.push(c.pid) });
  const client = { base: new URL('http://127.0.0.1:8188'), stats: async () => { throw Error('offline'); } };
  await assert.rejects(process.ensure(client, 'portable'), error => {
    assert.match(error.message, /ComfyUI 启动超时/); assert.match(error.message, /last failure/);
    assert.doesNotMatch(error.message, /old/); return true;
  });
  assert.deepEqual(killed, [99]);
  const bad = childProcess();
  const failed = createComfyProcess({ exists: () => true, launch: () => bad,
    sleep: async () => bad.emit('error', Error('permission denied')), killTree: () => {} });
  await assert.rejects(failed.ensure(client, 'portable'), /ComfyUI 启动失败.*permission denied/);
});
