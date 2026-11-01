import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { localMediaRoutes } from './localMedia.mjs';
import { newId } from '../store/files.mjs';

// 10-31 用户：深度 / 白模要能停，删生成中的卡也走这个接口。
test('停止接口：单号不对 400，已结束或找不到 404，排队 / 在跑分别回 stopped / stopping', async () => {
  const routes = new Map(), asked = [], id = newId(), running = newId();
  localMediaRoutes({ add: (method, path, fn) => routes.set(`${method} ${path}`, fn) }, { media: {},
    depthQueue: { cancel: value => { asked.push(value); return value === id ? 'stopped' : value === running ? 'stopping' : null; } } });
  const handler = routes.get('POST /api/local-jobs/stop'); assert.equal(typeof handler, 'function');
  const invoke = body => new Promise((resolve, reject) => handler({ req: Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),
    { headers: { 'content-type': 'application/json' } }), res: { writeHead: code => { resolve.code = code; },
    end: value => resolve({ code: resolve.code, body: JSON.parse(value) }) } }).catch(reject));
  await assert.rejects(invoke({ id: '../x' }), error => error.status === 400);
  await assert.rejects(invoke({ id: newId() }), error => error.status === 404 && /已经结束/.test(error.message));
  assert.deepEqual(await invoke({ id }), { code: 200, body: { status: 'stopped' } });
  assert.deepEqual(await invoke({ id: running }), { code: 200, body: { status: 'stopping' } });
  assert.equal(asked.length, 3);
});
