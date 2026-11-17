import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';
import { createFakeLayers } from './fakeLayers.mjs';
import { createLayerQueue } from './layerQueue.mjs';
import { createJobStore } from './store/jobs.mjs';
import { pngSize, solidPng } from './png.mjs';
import { call, listen, tempDir, waitFor } from './testKit.mjs';

const json = { 'Content-Type': 'application/json' };
const CANVAS = '01234567-89ab-cdef-0123-456789abcdef';
const open = [];
// 断言失败时也关掉小服务，不然整个测试进程等着不退。
afterEach(async () => { while (open.length) await open.pop()(); });

async function boot({ fake = true, env = {}, splitLayers = createFakeLayers({ delayMs: 5 }), dataRoot = tempDir() } = {}) {
  const app = createApp({ dataRoot, distDir: tempDir(), port: 5290, fake, readEnv: () => env, splitLayers, logError: () => {}, log: () => {} });
  const server = await listen(app.handler);
  open.push(server.close);
  return { app, dataRoot, port: server.port };
}
const post = (port, path, data) => call(port, { method: 'POST', path, headers: json, body: JSON.stringify(data) });
const upload = async (port, png) => (await call(port, { method: 'POST', path: '/api/uploads', headers: { 'Content-Type': 'image/png' }, body: png })).json.id;
const job = async (port, id) => (await call(port, { path: `/api/jobs?ids=${id}` })).json[0];
const finished = async (port, id) => { await waitFor(async () => !['queued', 'running'].includes((await job(port, id)).status)); return job(port, id); };
const split = (port, id, extra = {}) => post(port, '/api/layer-jobs', { canvasId: CANVAS, cardId: 'card-1', source: { type: 'upload', id }, ...extra });

test('图层分离整条（假火山）：交单 → 底图 + 两层进作品库（带 layer 标记）→ 单子带位置 → 记账 3 张', async () => {
  const s = await boot();
  const id = await upload(s.port, solidPng(600, 600, [200, 200, 200]));
  const r = await split(s.port, id, { text: '拆出圆', boxes: [[100, 100, 400, 400]] });
  assert.equal(r.status, 200);
  const view = await finished(s.port, r.json.id);
  assert.equal(view.kind, 'layers');
  assert.equal(view.status, 'succeeded');
  assert.equal(view.layers.width, 600);
  assert.equal(view.layers.items.length, 2);
  assert.deepEqual(view.layers.items[0].box, [60, 60, 240, 210]);
  assert.deepEqual(view.works, [view.layers.base, ...view.layers.items.map(item => item.work)]);
  const layerFile = await call(s.port, { path: `/api/works/file?id=${view.layers.items[0].work}` });
  assert.equal(layerFile.buffer[25], 6, '图层是 RGBA（带透明）');
  assert.deepEqual(pngSize(layerFile.buffer), { width: 360, height: 300 });
  const works = (await call(s.port, { path: '/api/works' })).json;
  assert.deepEqual(works.map(work => work.layer?.role).sort(), ['base', 'layer', 'layer']);
  assert.equal((await call(s.port, { path: '/api/health' })).json.todayYuan, 0.36);
  const saved = createJobStore(s.dataRoot).read(r.json.id);
  assert.equal(saved.prompt, '将图片进行精确图层分离，需分离的区域坐标为<bbox>100 100 400 400</bbox>。拆出圆');
  assert.equal(saved.maxYuan, 2.04);
});

test('花钱前拦下：图太小、框不对、描述太长、原图不在、真模式没填 Key', async () => {
  const s = await boot();
  const tiny = await upload(s.port, solidPng(100, 100, [1, 1, 1]));
  assert.match((await split(s.port, tiny)).json.error, /图太小了（100×100）/);
  const ok = await upload(s.port, solidPng(600, 600, [1, 1, 1]));
  assert.match((await split(s.port, ok, { boxes: [[400, 100, 300, 200]] })).json.error, /框选的位置不对/);
  assert.match((await split(s.port, ok, { boxes: [[0, 0, 1001, 10]] })).json.error, /框选的位置不对/);
  assert.match((await split(s.port, ok, { text: '字'.repeat(501) })).json.error, /描述太长了/);
  assert.match((await split(s.port, 'ffffffff-ffff-4fff-8fff-ffffffffffff')).json.error, /找不到了/);
  assert.equal((await call(s.port, { path: '/api/health' })).json.todayYuan, 0);
  const real = await boot({ fake: false, splitLayers: async () => { throw new Error('不该发'); } });
  const id = await upload(real.port, solidPng(600, 600, [1, 1, 1]));
  const r = await split(real.port, id);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /ARK_API_KEY/);
});

test('WebP 不收（页面会先转成 PNG 再交）', async () => {
  const s = await boot();
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);
  const up = await call(s.port, { method: 'POST', path: '/api/uploads', headers: { 'Content-Type': 'image/webp' }, body: webp });
  assert.equal(up.status, 200);
  assert.match((await split(s.port, up.json.id)).json.error, /只收 PNG 或 JPG/);
});

test('失败：被拒不记账；扣了费没下到记账、不重发', async () => {
  const s = await boot();
  const id = await upload(s.port, solidPng(600, 600, [1, 1, 1]));
  const rejected = await finished(s.port, (await split(s.port, id, { text: '假失败' })).json.id);
  assert.equal(rejected.status, 'failed');
  assert.match(rejected.error, /火山没接（400）/);
  assert.equal((await call(s.port, { path: '/api/health' })).json.todayYuan, 0);
  const lost = await finished(s.port, (await split(s.port, id, { text: '假下载失败' })).json.id);
  assert.equal(lost.status, 'failed');
  assert.equal(lost.errorCode, 'DOWNLOAD_FAILED');
  assert.match(lost.error, /已经拆好并扣费（3 张）/);
  assert.equal((await call(s.port, { path: '/api/health' })).json.todayYuan, 0.36);
});

test('超时、回话断了标「结果不明」；重启时正在拆的也标结果不明，不重发', async () => {
  let calls = 0;
  const s = await boot({ splitLayers: async () => { calls += 1; throw new Error('EDIT_INTERRUPTED'); } });
  const id = await upload(s.port, solidPng(600, 600, [1, 1, 1]));
  const view = await finished(s.port, (await split(s.port, id)).json.id);
  assert.equal(view.status, 'uncertain');
  assert.equal(calls, 1);

  const dataRoot = tempDir();
  const store = createJobStore(dataRoot);
  const stuck = store.create({ kind: 'layers', canvasId: CANVAS, cardId: 'card-1', source: { type: 'upload', id }, prompt: '', priceYuan: 0.12 });
  store.patch(stuck.id, { status: 'running' });
  const again = await boot({ dataRoot, splitLayers: async () => { throw new Error('不该重发'); } });
  assert.equal(again.app.layerQueue.recover(), 1);
  assert.equal(store.read(stuck.id).status, 'uncertain');
  assert.equal(again.app.queue.recover(), 0, '出图排队不碰图层单');
});

// 11-17 审查：图层排队照抄出图排队时漏了这一条。状态写不进硬盘时以前会在同一拍里无限重挑这一单，整个小服务卡死。
test('硬盘写不进时图层排队不原地打转：隔一会儿再试，写得进了照常往下走，期间不发火山', async () => {
  const root = tempDir();
  const real = createJobStore(root);
  let fails = 300, tries = 0, sent = 0;
  const jobs = { ...real, patch(id, changes) {
    tries += 1;
    if (fails > 0) { fails -= 1; throw Object.assign(Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); }
    return real.patch(id, changes);
  } };
  const queue = createLayerQueue({ jobs, works: { read: () => null }, uploads: { read: () => null }, spend: { add() {} },
    split: async () => { sent += 1; return { ok: false, message: '不该走到这里' }; }, retryMs: 20, logError: () => {} });
  const job = queue.submit({ canvasId: CANVAS, cardId: 'card-1', source: { type: 'upload', id: CANVAS }, prompt: '', priceYuan: 0.12 });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(tries <= 4, `一拍之内只该试一轮，实际写了 ${tries} 次`);
  assert.equal(real.read(job.id).status, 'queued');
  fails = 0;
  await waitFor(() => real.read(job.id).status !== 'queued');
  assert.equal(real.read(job.id).errorCode, 'REF_MISSING', '写得进了照常跑：这单的原图不存在，标失败');
  assert.equal(sent, 0);
});
