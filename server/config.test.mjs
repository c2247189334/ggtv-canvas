import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { argValue, keyFilled, readEnvFile, runtimeOptions, tosFilled, depthHealth } from './config.mjs';
import * as config from './config.mjs';

const root = join(tmpdir(), 'canvas-root');

test('白模体检只报填写和找到状态，目录检查两个必要文件；本机地址不等于就绪', async () => {
  assert.equal(typeof config.meshHealth, 'function');
  const offline = async () => { throw Error('fetch failed'); };
  const plain = await config.meshHealth({}, { exists: () => false, fetch: offline });
  assert.deepEqual(plain.mesh, { ready: false, url: { filled: false, found: true }, directory: { filled: false, found: false } });
  const env = { COMFYUI_URL: 'http://localhost:8288', COMFYUI_DIR: 'private-dir' }, checked = [];
  const health = await config.meshHealth(env, { exists: path => { checked.push(path); return true; }, fetch: offline });
  assert.deepEqual(health.mesh, { ready: true, url: { filled: true, found: true }, directory: { filled: true, found: true } });
  assert.ok(checked.some(path => path.endsWith(join('python_embeded', 'python.exe'))));
  assert.ok(checked.some(path => path.endsWith(join('ComfyUI', 'main.py'))));
  assert.ok(!JSON.stringify(health).includes('private-dir')); assert.ok(!JSON.stringify(health).includes('8288'));
  assert.equal((await config.meshHealth(env, { exists: path => !path.endsWith('main.py'), fetch: offline })).mesh.directory.found, false);
  for (const url of ['http://other.test:8188', 'https://localhost.attacker.test', 'file:///localhost', 'http://user:pass@localhost', 'bad']) {
    const invalid = await config.meshHealth({ COMFYUI_URL: url }, { fetch: () => assert.fail('不许探测外站') });
    assert.equal(invalid.mesh.url.found, false, url);
    assert.equal(invalid.mesh.ready, false, url);
  }
  for (const url of ['http://127.0.0.1:8188', 'http://[::1]:8188']) {
    assert.equal((await config.meshHealth({ COMFYUI_URL: url }, { fetch: offline })).mesh.url.found, true, url);
  }
  const fake = await config.meshHealth({ COMFYUI_DIR: 'missing' }, { fake: true, exists: () => false, fetch: () => assert.fail('假模式不探测') });
  assert.equal(fake.mesh.directory.found, true); assert.equal(fake.mesh.ready, true);
});

test('白模本机探活识别ComfyUI，拒绝重定向与其他服务；卡住最多等800毫秒', async () => {
  const run = fetch => config.meshHealth({}, { exists: () => false, fetch });
  let calls = 0;
  const online = await run(async (url, options) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:8188/system_stats');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ system: { comfyui_version: 'test' }, devices: [] }));
  });
  assert.equal(calls, 1); assert.equal(online.mesh.ready, true);
  for (const reply of [new Response('{}'), new Response('not json'), new Response(null, { status: 302 })]) {
    assert.equal((await run(async () => reply)).mesh.ready, false);
  }
  for (const fetch of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    const started = Date.now();
    const stalled = await run(fetch);
    assert.equal(stalled.mesh.ready, false);
    assert.ok(Date.now() - started < 800, '连同响应体在内，体检不能等满800毫秒');
  }
});

test('深度体检只报填写和存在状态，可选包没填不算就绪；不泄露路径', () => {
  const env = { DEPTH_PYTHON: 'private-python', DEPTH_MODEL_DIR: 'private-model', DEPTH_EXTRA_PACKAGES: '请填可选目录' };
  const health = depthHealth(env, { exists: path => !path.includes('ffprobe'), path: 'tools' });
  assert.deepEqual(health.depth.python, { filled: true, found: true });
  assert.deepEqual(health.depth.modelDir, { filled: true, found: true });
  assert.deepEqual(health.depth.extraPackages, { filled: false, found: false });
  assert.equal(health.ffmpegFound, true);
  assert.equal(health.ffprobeFound, false);
  assert.ok(!JSON.stringify(health).includes('private'));
  assert.deepEqual(depthHealth({}, { exists: () => false, path: '' }).depth.python, { filled: false, found: false });
});

test('TOS只报配置填没填，三项缺一项或模板值都算没填', () => {
  const env = { TOS_BUCKET: 'test-bucket', TOS_ACCESS_KEY_ID: 'test-ak', TOS_SECRET_ACCESS_KEY: 'test-sk' };
  assert.equal(tosFilled(env), true);
  assert.equal(tosFilled({}), false);
  for (const name of Object.keys(env)) {
    assert.equal(tosFilled({ ...env, [name]: '' }), false);
    assert.equal(tosFilled({ ...env, [name]: '请填写' }), false);
  }
});

test('默认端口 5290、数据放 数据/、不是假火山', () => {
  const o = runtimeOptions([], {}, root);
  assert.equal(o.port, 5290);
  assert.equal(o.dataRoot, join(root, '数据'));
  assert.equal(o.fake, false);
  assert.equal(o.distDir, join(root, 'dist'));
  assert.equal(o.logDir, join(root, '日志'));
});

test('假火山模式不碰真数据：没指定 --data 就落到 .fake-data', () => {
  const o = runtimeOptions(['--fake'], {}, root);
  assert.equal(o.fake, true);
  assert.equal(o.dataRoot, join(root, '.fake-data'));
});

test('--data 和 --port 能覆盖', () => {
  const o = runtimeOptions(['--fake', '--data=x', '--port=5291'], {}, root);
  assert.equal(o.dataRoot, join(root, 'x'));
  assert.equal(o.port, 5291);
});

test('端口填得离谱就退回 5290', () => {
  assert.equal(runtimeOptions(['--port=abc'], {}, root).port, 5290);
  assert.equal(runtimeOptions(['--port=70000'], {}, root).port, 5290);
});

test('argValue 只认 --name=value', () => {
  assert.equal(argValue(['--a=1', '--b'], 'a'), '1');
  assert.equal(argValue(['--b'], 'b'), undefined);
});

test('Key：空的、「请」开头的都算没填', () => {
  assert.equal(keyFilled({}), false);
  assert.equal(keyFilled({ ARK_API_KEY: '  ' }), false);
  assert.equal(keyFilled({ ARK_API_KEY: '请填写' }), false);
  assert.equal(keyFilled({ ARK_API_KEY: 'abc' }), true);
});

test('readEnvFile：没有文件返回空对象，带 BOM 也读得出', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canvas-env-'));
  try {
    assert.deepEqual(readEnvFile(dir), {});
    writeFileSync(join(dir, '.env.local'), '﻿ARK_API_KEY=abc\n');
    assert.equal(readEnvFile(dir).ARK_API_KEY, 'abc');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
