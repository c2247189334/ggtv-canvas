import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';
import { createFakeArk } from './fakeArk.mjs';
import { solidPng } from './png.mjs';
import { call, listen, tempDir, waitFor } from './testKit.mjs';

const FLASH = 'doubao-seedream-5-0-flash-260915';
const json = { 'Content-Type': 'application/json' };

async function boot({ fake = true, env = {}, generate = createFakeArk({ delayMs: 5 }) } = {}) {
  const app = createApp({ dataRoot: tempDir(), distDir: tempDir(), port: 5290, fake, readEnv: () => env, generate, logError: () => {}, log: () => {} });
  return { app, ...(await listen(app.handler)) };
}

const post = (port, path, data) => call(port, { method: 'POST', path, headers: json, body: JSON.stringify(data) });
const uploadPng = (port, png) => call(port, { method: 'POST', path: '/api/uploads', headers: { 'Content-Type': 'image/png' }, body: png });

test('health：报假火山、Key 填没填、今天花了多少', async () => {
  const s = await boot();
  const r = await call(s.port, { path: '/api/health' });
  assert.deepEqual(r.json, { ok: true, fake: true, keyReady: false, tosReady: false, todayYuan: 0, uncertainToday: 0,
    depth: { python: {filled:false,found:false}, modelDir: {filled:false,found:false}, extraPackages: {filled:false,found:false} },
    mesh: { ready: true, url: { filled: false, found: true }, directory: { filled: false, found: true } },
    ffmpegFound:r.json.ffmpegFound,ffprobeFound:r.json.ffprobeFound });
  assert.equal(typeof r.json.ffmpegFound,'boolean');assert.equal(typeof r.json.ffprobeFound,'boolean');
  await s.close();
});

test('画布：建、列、存、读、删', async () => {
  const s = await boot();
  const created = (await post(s.port, '/api/canvases', { name: '画布 1' })).json;
  assert.equal(created.name, '画布 1');
  assert.deepEqual((await call(s.port, { path: '/api/canvases' })).json.map((c) => c.id), [created.id]);
  const body = JSON.stringify({ ...created, baseVersion: created.version, name: '改过的名字', nodes: [{ id: 'card-1', x: 0, y: 0, data: {} }] });
  assert.equal((await call(s.port, { method: 'PUT', path: `/api/canvas?id=${created.id}`, headers: json, body })).status, 200);
  const read = (await call(s.port, { path: `/api/canvas?id=${created.id}` })).json;
  assert.equal(read.name, '改过的名字');
  assert.equal(read.nodes.length, 1);
  assert.equal((await call(s.port, { method: 'DELETE', path: `/api/canvas?id=${created.id}` })).status, 200);
  assert.equal((await call(s.port, { path: `/api/canvas?id=${created.id}` })).status, 404);
  assert.equal((await call(s.port, { method: 'PUT', path: `/api/canvas?id=${created.id}`, headers: json, body })).status, 404);
  await s.close();
});

test('上传：图片存下能读回；不是图片、类型不对都拒收', async () => {
  const s = await boot();
  const png = solidPng(4, 4, [10, 20, 30]);
  const up = await uploadPng(s.port, png);
  assert.equal(up.status, 200);
  assert.deepEqual((await call(s.port, { path: `/api/uploads/file?id=${up.json.id}` })).buffer, png);
  assert.equal((await uploadPng(s.port, Buffer.from('hello'))).status, 415);
  const wrongType = await call(s.port, { method: 'POST', path: '/api/uploads', headers: { 'Content-Type': 'text/plain' }, body: png });
  assert.equal(wrongType.status, 415);
  await s.close();
});

test('出图整条：交单 → 查进度 → 作品库有图 → 能下载 → 删掉后读不到；花费记上', async () => {
  const s = await boot();
  const canvas = (await post(s.port, '/api/canvases', { name: 'c' })).json;
  const up = (await uploadPng(s.port, solidPng(8, 8, [1, 1, 1]))).json;
  const submitted = await post(s.port, '/api/jobs', {
    canvasId: canvas.id, cardId: 'card-1', model: FLASH, prompt: '只有 1 张图，就是图1。\n\n换成蓝色', size: '1024x1024', count: 1,
    refs: [{ type: 'upload', id: up.id }]
  });
  assert.equal(submitted.status, 200);
  let view;
  await waitFor(async () => {
    view = (await call(s.port, { path: `/api/jobs?ids=${submitted.json.id}` })).json[0];
    return view.status === 'succeeded';
  });
  assert.equal(view.works.length, 1);
  assert.equal(view.error, null);
  const works = (await call(s.port, { path: '/api/works' })).json;
  assert.equal(works[0].id, view.works[0]);
  assert.equal(works[0].canvasId, canvas.id);
  const file = await call(s.port, { path: `/api/works/file?id=${works[0].id}&download=1` });
  assert.equal(file.status, 200);
  assert.match(String(file.headers['content-disposition']), /attachment/);
  assert.equal((await call(s.port, { path: '/api/health' })).json.todayYuan, 0.12);
  assert.equal((await call(s.port, { method: 'DELETE', path: `/api/works?id=${works[0].id}` })).status, 200);
  assert.equal((await call(s.port, { path: `/api/works/file?id=${works[0].id}` })).status, 404);
  await s.close();
});

test('不是假火山、Key 没填：拒收，出图函数一次都不调', async () => {
  let called = false;
  const s = await boot({ fake: false, env: {}, generate: async () => { called = true; return { ok: false, status: 500, message: 'x' }; } });
  const canvas = (await post(s.port, '/api/canvases', { name: 'c' })).json;
  const r = await post(s.port, '/api/jobs', { canvasId: canvas.id, cardId: 'card-1', model: FLASH, prompt: 'x', size: '1024x1024', count: 1, refs: [] });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /ARK_API_KEY/);
  assert.equal(called, false);
  await s.close();
});

test('参考图不在：拒收（400），不排队', async () => {
  const s = await boot();
  const canvas = (await post(s.port, '/api/canvases', { name: 'c' })).json;
  const r = await post(s.port, '/api/jobs', {
    canvasId: canvas.id, cardId: 'card-1', model: FLASH, prompt: 'x', count: 1,
    refs: [{ type: 'work', id: '22222222-2222-4222-8222-222222222222' }]
  });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /找不到/);
  await s.close();
});

test('查进度：找不到的单子回 missing，不报错', async () => {
  const s = await boot();
  const r = await call(s.port, { path: '/api/jobs?ids=33333333-3333-4333-8333-333333333333' });
  assert.equal(r.json[0].status, 'missing');
  await s.close();
});
