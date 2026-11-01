import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import * as assets from './assets.mjs';
import { createHandler, createRouter } from '../http.mjs';
import { createUploadStore } from '../store/uploads.mjs';
import { createWorkStore } from '../store/works.mjs';
import { videoJobRoutes } from './videoJobs.mjs';
import { DEFAULT_VIDEO_SETTINGS } from '../videoModels.mjs';
import { solidPng } from '../png.mjs';
import { call, listen, tempDir, waitFor } from '../testKit.mjs';

async function boot(t, limits) {
  const root = tempDir();
  const uploads = createUploadStore(root);
  const works = createWorkStore(root);
  const router = createRouter();
  assets.assetRoutes(router, { uploads, works }, limits);
  let submitted = 0;
  videoJobRoutes(router, { uploads, works, fake: true, readEnv: () => ({}),
    videoQueue: { submit() { submitted++; return { id: 'job' }; } } });
  const s = await listen(createHandler({ router, distDir: tempDir(), allowedPorts: [], logError: () => {} }));
  t.after(s.close);
  return { ...s, root, uploads, works, submitted: () => submitted };
}
const fixture = () => readFileSync(new URL('../fixtures/fake-video.mp4', import.meta.url));
const upload = (s, body, type) => call(s.port, { method: 'POST', path: '/api/uploads', body, headers: { 'Content-Type': type } });

test('视频上传返回真实元数据，mp4 和 mov 可 Range 读取；坏视频拒收', async (t) => {
  const s = await boot(t);
  for (const mov of [false, true]) {
    const bytes = fixture();
    if (mov) bytes.write('qt  ', 8);
    const up = await upload(s, bytes, mov ? 'video/quicktime' : 'video/mp4');
    assert.equal(up.status, 200);
    assert.deepEqual(up.json, { id: up.json.id, kind: 'video', duration: 2, width: 320, height: 180, fps:24,videoDuration:2,hasAudio:false });
    const part = await call(s.port, { path: `/api/uploads/file?id=${up.json.id}`, headers: { Range: 'bytes=4-7' } });
    assert.equal(part.status, 206);
    assert.equal(part.buffer.toString(), 'ftyp');
    assert.equal(part.headers['content-type'], mov ? 'video/quicktime' : 'video/mp4');
  }
  assert.equal((await upload(s, Buffer.from('bad'), 'video/mp4')).status, 415);
  assert.equal((await upload(s, fixture(), 'text/plain')).status, 415);
});

test('视频作品下载使用 mp4 扩展名且可断点；图片仍为 png', async (t) => {
  const s = await boot(t);
  for (const video of [false, true]) {
    const work = video ? s.works.addVideo(fixture(), {}) : s.works.add(solidPng(2, 2, [0, 0, 0]), {});
    const part = await call(s.port, { path: `/api/works/file?id=${work.id}&download=1`, headers: { Range: 'bytes=0-7' } });
    assert.equal(part.status, 206);
    assert.match(part.headers['content-disposition'], video ? /\.mp4"$/ : /\.png"$/);
    assert.equal(part.buffer.length, 8);
  }
});

test('传的图 / 视频也能下载（卡上工具条「下载」），不带 download 照常显示', async (t) => {
  const s = await boot(t);
  for (const [bytes, type, ext] of [[solidPng(2, 2, [0, 0, 0]), 'image/png', 'png'], [fixture(), 'video/mp4', 'mp4']]) {
    const up = await upload(s, bytes, type);
    const file = await call(s.port, { path: `/api/uploads/file?id=${up.json.id}&download=1` });
    assert.equal(file.status, 200);
    assert.match(file.headers['content-disposition'], new RegExp(`^attachment; filename="upload-${up.json.id.slice(0, 8)}\\.${ext}"$`));
    const shown = await call(s.port, { path: `/api/uploads/file?id=${up.json.id}` });
    assert.equal(shown.headers['content-disposition'], undefined);
  }
});

test('图片仍限制 30MB；不能谎报视频类型绕过图片上限', async (t) => {
  const s = await boot(t);
  assert.equal((await upload(s, Buffer.alloc(30 * 1024 * 1024 + 1), 'image/png')).status, 413);
  const disguised = Buffer.alloc(30 * 1024 * 1024 + 1);
  solidPng(2, 2, [0, 0, 0]).copy(disguised);
  assert.equal((await upload(s, disguised, 'video/mp4')).status, 413);
});

test('视频默认上限严格等于1.5G和900秒', () => {
  assert.equal(assets.MAX_VIDEO_UPLOAD_BYTES, 1610612736);
  assert.equal(assets.MAX_VIDEO_UPLOAD_SECONDS, 900);
});

test('70MB合法视频能上传，不再被60MB拦；元数据带真实bytes', async t => {
  const s = await boot(t);
  const free = Buffer.alloc(70 * 1024 * 1024);
  free.writeUInt32BE(free.length); free.write('free', 4);
  const body = Buffer.concat([fixture(), free]);
  const result = await upload(s, body, 'video/mp4');
  assert.equal(result.status, 200);
  assert.equal(s.uploads.metadata(result.json.id).bytes, body.length);
  assert.deepEqual(readdirSync(join(s.root, '上传')), [`${result.json.id}.mp4`]);
});

test('注入小上限：超大小/超时长回413和原话，坏视频415，都不留临时文件', async t => {
  const message = '请上传小于 1.5G 且时长在 15 分钟以内的视频。';
  for (const [limits, body, status] of [
    [{ maxVideoBytes: 32 }, fixture(), 413],
    [{ maxVideoSeconds: 1 }, fixture(), 413],
    [{}, Buffer.from('bad'), 415]
  ]) {
    const s = await boot(t, limits);
    const result = await upload(s, body, 'video/mp4');
    assert.equal(result.status, status);
    if (status === 413) assert.equal(result.json.error, message);
    assert.deepEqual(existsSync(join(s.root, '上传')) ? readdirSync(join(s.root, '上传')) : [], []);
  }
});

test('超大小即回413，不等请求结束；客户端中断也清part', async t => {
  const s = await boot(t, { maxVideoBytes: 32 });
  const result = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/uploads',
      headers: { 'Content-Type': 'video/mp4' } }, res => {
      let text = ''; res.on('data', data => { text += data; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.write(Buffer.alloc(33));
    // 故意不end：必须在继续上传前就收到413。
  });
  assert.equal(result.status, 413);
  assert.match(result.text, /请上传小于 1.5G/);
  assert.deepEqual(readdirSync(join(s.root, '上传')), []);
  const s2 = await boot(t);
  const req = request({ host: '127.0.0.1', port: s2.port, method: 'POST', path: '/api/uploads',
    headers: { 'Content-Type': 'video/mp4' } });
  const closed = new Promise(resolve => req.on('error', resolve));
  req.write(fixture());
  await waitFor(() => existsSync(join(s2.root, '上传')) && readdirSync(join(s2.root, '上传')).length === 1);
  req.destroy(new Error('测试中断'));
  await closed;
  await waitFor(() => readdirSync(join(s2.root, '上传')).length === 0);
});

test('假模式交单也拒超200MB上传/作品文件，不入队、不读全片', async t => {
  const s = await boot(t);
  const video = readFileSync(new URL('../fixtures/audio-video.mp4', import.meta.url));
  for (const type of ['upload', 'work']) {
    const store = type === 'upload' ? s.uploads : s.works;
    const saved = type === 'upload' ? store.save(video) : store.addVideo(video, {});
    const size = 210 * 1024 * 1024;
    const header = Buffer.alloc(8); header.writeUInt32BE(size - video.length); header.write('free', 4);
    const fd = openSync(store.path(saved.id), 'r+');
    try { writeSync(fd, header, 0, 8, video.length); writeSync(fd, Buffer.alloc(1), 0, 1, size - 1); }
    finally { closeSync(fd); }
    const result = await call(s.port, { method: 'POST', path: '/api/video-jobs', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...DEFAULT_VIDEO_SETTINGS, canvasId: '11111111-1111-4111-8111-111111111111', cardId: 'card', prompt: '天空', refs: [{ type, id: saved.id }] }) });
    assert.equal(result.status, 400);
    assert.match(result.json.error, /@视频1.*210MB.*200MB.*压缩或截短/);
    assert.equal(s.submitted(), 0);
  }
});
