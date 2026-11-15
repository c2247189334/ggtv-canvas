// 「我上传的」：上传记进清单、同内容只存一份、清单带画布使用情况、删除连文件一起删。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assetRoutes } from './assets.mjs';
import { createHandler, createRouter } from '../http.mjs';
import { createUploadStore } from '../store/uploads.mjs';
import { createUploadRecords } from '../store/uploadRecords.mjs';
import { createCanvasStore } from '../store/canvases.mjs';
import { createWorkStore } from '../store/works.mjs';
import { solidPng } from '../png.mjs';
import { call, listen, tempDir } from '../testKit.mjs';

async function boot(t) {
  const root = tempDir();
  const stores = { uploads: createUploadStore(root), uploadRecords: createUploadRecords(root),
    canvases: createCanvasStore(root), works: createWorkStore(root) };
  const router = createRouter();
  assetRoutes(router, stores);
  const s = await listen(createHandler({ router, distDir: tempDir(), allowedPorts: [], logError: () => {} }));
  t.after(s.close);
  return { ...s, root, ...stores };
}
const video = () => readFileSync(new URL('../fixtures/fake-video.mp4', import.meta.url));
const upload = (s, body, type, name) => call(s.port, { method: 'POST', path: '/api/uploads', body,
  headers: { 'Content-Type': type, ...(name === undefined ? {} : { 'X-Upload-Name': encodeURIComponent(name) }) } });
const media = (root) => readdirSync(join(root, '上传'));

test('同一视频传两次：只留一个文件一条记录，回同一编号，挪到最前面', async (t) => {
  const s = await boot(t);
  const first = await upload(s, video(), 'video/mp4', '跳舞.mp4');
  const picture = await upload(s, solidPng(4, 4, [1, 2, 3]), 'image/png', '猫.png');
  const again = await upload(s, video(), 'video/mp4', '跳舞 副本.mp4');
  assert.equal(first.status, 200);
  assert.deepEqual(again.json, first.json);
  assert.equal(media(s.root).length, 2);
  const list = await call(s.port, { path: '/api/uploads/list' });
  assert.deepEqual(list.json.items.map(item => [item.id, item.name, item.kind]),
    [[first.json.id, '跳舞.mp4', 'video'], [picture.json.id, '猫.png', 'image']]);
  assert.equal(list.json.items[0].duration, 2);
  assert.equal(list.json.items[0].sha256, undefined);
  assert.equal(list.json.bytes, video().length + solidPng(4, 4, [1, 2, 3]).length);
});

test('文件名：中文、带路径、超长、没给都处理对', async (t) => {
  const s = await boot(t);
  const names = [['C:\\Users\\我\\桌面\\猫 猫.png', '猫 猫.png'], ['a/b/../狗.png', '狗.png'], ['长'.repeat(300) + '.png', '长'.repeat(200)], [undefined, '未命名']];
  for (const [index, [raw]] of names.entries()) await upload(s, solidPng(2, 2, [index, 0, 0]), 'image/png', raw);
  const list = await call(s.port, { path: '/api/uploads/list' });
  assert.deepEqual(list.json.items.map(item => item.name).sort(), names.map(([, name]) => name).sort());
});

test('清单标出哪些画布在用；删除连文件和记录一起删，再删回 404', async (t) => {
  const s = await boot(t);
  const up = (await upload(s, solidPng(3, 3, [9, 9, 9]), 'image/png', '在用.png')).json;
  const idle = (await upload(s, solidPng(3, 3, [8, 8, 8]), 'image/png', '闲着.png')).json;
  const canvas = s.canvases.create('画布');
  s.canvases.save(canvas.id, { ...canvas, baseVersion: canvas.version, nodes: [{ id: 'n', data: { results: [{ type: 'upload', id: up.id }] } }], edges: [] });
  const list = await call(s.port, { path: '/api/uploads/list' });
  assert.deepEqual(Object.fromEntries(list.json.items.map(item => [item.id, item.canvases])), { [up.id]: [canvas.id], [idle.id]: [] });
  assert.equal((await call(s.port, { method: 'DELETE', path: `/api/uploads?id=${up.id}` })).status, 200);
  assert.equal(s.uploads.path(up.id), null);
  assert.deepEqual(s.uploadRecords.ids(), [idle.id]);
  assert.equal((await call(s.port, { method: 'DELETE', path: `/api/uploads?id=${up.id}` })).status, 404);
});

test('不在清单里的上传素材（截图、片段）删不了；文件丢了的记录不出现，再传同内容记成新的', async (t) => {
  const s = await boot(t);
  const shot = s.uploads.save(solidPng(2, 2, [5, 5, 5]));
  assert.equal((await call(s.port, { method: 'DELETE', path: `/api/uploads?id=${shot.id}` })).status, 404);
  assert.ok(s.uploads.path(shot.id));
  const up = (await upload(s, solidPng(2, 2, [6, 6, 6]), 'image/png', '丢了.png')).json;
  s.uploads.remove(up.id);
  assert.deepEqual((await call(s.port, { path: '/api/uploads/list' })).json.items, []);
  const again = (await upload(s, solidPng(2, 2, [6, 6, 6]), 'image/png', '丢了.png')).json;
  assert.notEqual(again.id, up.id);
  assert.deepEqual(s.uploadRecords.ids(), [again.id]);
});

test('清单读坏了：上传说清楚没记上、不留文件；清单接口报原话', async (t) => {
  const s = await boot(t);
  await upload(s, solidPng(2, 2, [1, 1, 1]), 'image/png', '好.png');
  writeFileSync(join(s.root, '上传记录.json'), '{坏');
  const bad = await upload(s, solidPng(2, 2, [2, 2, 2]), 'image/png', '坏.png');
  assert.equal(bad.status, 500);
  assert.match(bad.json.error, /清单读不出来/);
  assert.equal(media(s.root).length, 1);
  assert.match((await call(s.port, { path: '/api/uploads/list' })).json.error, /清单读不出来/);
});
