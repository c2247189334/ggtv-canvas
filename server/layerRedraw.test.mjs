// 11-16 图层重绘：交单 → 出一张透明图层存成作品（带 redrawOf）→ 单子带 from / work → 记一张的钱。
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';
import { createFakeLayers, createFakeRedraw } from './fakeLayers.mjs';
import { createJobStore } from './store/jobs.mjs';
import { pngSize, solidPng } from './png.mjs';
import { call, listen, tempDir, waitFor } from './testKit.mjs';

const json = { 'Content-Type': 'application/json' };
const CANVAS = '01234567-89ab-cdef-0123-456789abcdef';
const open = [];
afterEach(async () => { while (open.length) await open.pop()(); });

async function boot({ fake = true, redrawLayer = createFakeRedraw({ delayMs: 5 }), dataRoot = tempDir() } = {}) {
  const app = createApp({ dataRoot, distDir: tempDir(), port: 5290, fake, readEnv: () => ({}), splitLayers: createFakeLayers({ delayMs: 5 }),
    redrawLayer, logError: () => {}, log: () => {} });
  const server = await listen(app.handler);
  open.push(server.close);
  return { app, dataRoot, port: server.port };
}
const post = (port, path, data) => call(port, { method: 'POST', path, headers: json, body: JSON.stringify(data) });
const job = async (port, id) => (await call(port, { path: `/api/jobs?ids=${id}` })).json[0];
const finished = async (port, id) => { await waitFor(async () => !['queued', 'running'].includes((await job(port, id)).status)); return job(port, id); };
const health = async port => (await call(port, { path: '/api/health' })).json.todayYuan;

/** 先假拆一次，拿到一个真的图层作品。 */
async function layerOf(port) {
  const up = (await call(port, { method: 'POST', path: '/api/uploads', headers: { 'Content-Type': 'image/png' }, body: solidPng(600, 600, [9, 9, 9]) })).json.id;
  const r = await post(port, '/api/layer-jobs', { canvasId: CANVAS, cardId: 'card-1', source: { type: 'upload', id: up } });
  const view = await finished(port, r.json.id);
  return { up, base: view.layers.base, layer: view.layers.items[0].work };
}
const redraw = (port, layer, extra = {}) => post(port, '/api/layer-redraws', { canvasId: CANVAS, cardId: 'card-1', layer, text: '改成金色', name: '标', ...extra });

test('图层重绘整条（假火山）：出一张透明图层，作品带 redrawOf，记 0.12 元', async () => {
  const s = await boot();
  const { layer } = await layerOf(s.port);
  const before = await health(s.port);
  const r = await redraw(s.port, layer);
  assert.equal(r.status, 200);
  const view = await finished(s.port, r.json.id);
  assert.equal(view.kind, 'layer-redraw');
  assert.equal(view.status, 'succeeded');
  assert.equal(view.redraw.from, layer);
  assert.deepEqual(view.works, [view.redraw.work]);
  const file = await call(s.port, { path: `/api/works/file?id=${view.redraw.work}` });
  assert.equal(file.buffer[25], 6, '重绘出来的也是 RGBA（带透明）');
  assert.deepEqual(pngSize(file.buffer), { width: 360, height: 300 });
  const made = (await call(s.port, { path: '/api/works' })).json.find(work => work.id === view.redraw.work);
  assert.equal(made.layer.role, 'layer');
  assert.equal(made.layer.redrawOf, layer);
  assert.equal(made.layer.name, '标');
  assert.equal(Math.round((await health(s.port) - before) * 100) / 100, 0.12);
  const saved = createJobStore(s.dataRoot).read(r.json.id);
  assert.equal(saved.prompt, '改成金色');
  assert.equal(saved.size, '360x300');
});

test('真请求：Flash、透明底 PNG、带上图层原图和尺寸', async () => {
  const seen = [];
  const s = await boot({ redrawLayer: async request => { seen.push(request); return { ok: true, image: solidPng(10, 10, [1, 1, 1]) }; } });
  const { layer } = await layerOf(s.port);
  await finished(s.port, (await redraw(s.port, layer)).json.id);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].prompt, '改成金色');
  assert.equal(seen[0].size, '360x300');
  assert.equal(seen[0].images.length, 1);
  assert.equal(seen[0].images[0].contentType, 'image/png');
});

test('花钱前拦下：没写字、不是图层（底图 / 上传图）、图层不在、真模式没填 Key', async () => {
  const s = await boot();
  const { up, base, layer } = await layerOf(s.port);
  assert.match((await redraw(s.port, layer, { text: '  ' })).json.error, /先写一句/);
  assert.match((await redraw(s.port, layer, { text: '字'.repeat(501) })).json.error, /描述太长了/);
  assert.match((await redraw(s.port, base)).json.error, /只能重绘图层分离拆出来的图层/);
  assert.match((await redraw(s.port, up)).json.error, /找不到了/);
  assert.match((await redraw(s.port, 'ffffffff-ffff-4fff-8fff-ffffffffffff')).json.error, /找不到了/);
  const real = await boot({ fake: false, redrawLayer: async () => { throw new Error('不该发'); } });
  const r = await redraw(real.port, layer);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /ARK_API_KEY/);
});

test('失败：被拒不记账；超时标结果不明、不重发；重启时正在重绘的标结果不明', async () => {
  const s = await boot();
  const { layer } = await layerOf(s.port);
  const before = await health(s.port);
  const rejected = await finished(s.port, (await redraw(s.port, layer, { text: '假失败' })).json.id);
  assert.equal(rejected.status, 'failed');
  assert.match(rejected.error, /火山没接（400）/);
  const timeout = await finished(s.port, (await redraw(s.port, layer, { text: '假超时' })).json.id);
  assert.equal(timeout.status, 'uncertain');
  assert.equal(await health(s.port), before);

  const dataRoot = tempDir(), store = createJobStore(dataRoot);
  const stuck = store.create({ kind: 'layer-redraw', canvasId: CANVAS, cardId: 'card-1', from: layer, prompt: 'x', priceYuan: 0.12 });
  store.patch(stuck.id, { status: 'running' });
  const again = await boot({ dataRoot, redrawLayer: async () => { throw new Error('不该重发'); } });
  assert.equal(again.app.layerQueue.recover(), 1);
  assert.equal(store.read(stuck.id).status, 'uncertain');
});
