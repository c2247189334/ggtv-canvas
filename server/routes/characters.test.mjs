import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { characterSetup } from './characterTestKit.mjs';
import { solidPng } from '../png.mjs';
import { newId } from '../store/files.mjs';
import { createWorkStore } from '../store/works.mjs';
import { FLASH_MODEL } from '../characterPolicy.mjs';

const png = solidPng(4, 3, [40, 80, 120]);
const unknown = '11111111-1111-4111-8111-111111111111';

test('五接口之保存、列表、修改、删除走app.handler并保留图片引用和素材编号', async () => {
  const s = characterSetup();
  assert.deepEqual(await s.call('GET', '/api/characters'), { status: 200, json: [] });
  const up = s.app.stores.uploads.save(png), work = s.app.stores.works.add(png, { model: FLASH_MODEL });
  const body = { name: '测试人物', description: '成年人物', images: [
    { type: 'work', id: work.id }, { type: 'upload', id: up.id, assetId: 'person.01' }
  ] };
  const denied = await s.call('POST', '/api/characters', body);
  assert.equal(denied.status, 400); assert.match(denied.json.error, /先勾选授权/);
  const made = await s.call('POST', '/api/characters', { ...body, authorized: true });
  assert.equal(made.status, 200); assert.equal(made.json.status, 'ready');
  assert.deepEqual(made.json.images, [
    { ref: body.images[0], label: '图 1', video: { status: 'trusted', days: 30 } },
    { ref: { type: 'upload', id: up.id }, label: '图 2', assetId: 'person.01', video: { status: 'asset' } }
  ]);
  const id = made.json.id;
  const patched = await s.call('PATCH', '/api/characters', { id, name: '新名字', description: '' });
  assert.equal(patched.status, 200); assert.equal(patched.json.name, '新名字'); assert.equal(patched.json.description, '');
  assert.deepEqual((await s.call('GET', '/api/characters')).json.map(c => c.id), [id]);
  assert.equal((await s.call('DELETE', `/api/characters?id=${id}`)).status, 200);
  assert.deepEqual((await s.call('GET', '/api/characters')).json, []);
  assert.ok(s.app.stores.works.path(work.id)); assert.ok(s.app.stores.uploads.path(up.id));
  assert.equal((await s.call('DELETE', `/api/characters?id=${id}`)).status, 404);
  assert.deepEqual(s.errors, []);
});

test('保存严格验证名字描述、1到8张真实图片、授权布尔值和素材编号', async () => {
  const s = characterSetup();
  const upload = s.app.stores.uploads.save(png);
  const video = s.app.stores.uploads.save(readFileSync(new URL('../fixtures/fake-video.mp4', import.meta.url)));
  const valid = { name: '人物', description: '', images: [{ type: 'upload', id: upload.id }], authorized: true };
  const bad = [{ name: '' }, { name: 'x'.repeat(41) }, { name: 1 }, { description: null },
    { description: 'x'.repeat(501) }, { images: [] }, { images: 'bad' }, { images: Array(9).fill(valid.images[0]) },
    { images: [{ type: 'upload', id: unknown }] }, { images: [{ type: 'upload', id: '../bad' }] },
    { images: [{ type: 'video', id: upload.id }] }, { images: [{ type: 'upload', id: video.id }] },
    { images: [{ ...valid.images[0], assetId: 'bad space' }] }, { authorized: 'true' }, { authorized: 1 }];
  for (const change of bad) {
    const result = await s.call('POST', '/api/characters', { ...valid, ...change });
    assert.equal(result.status, 400, JSON.stringify(change)); assert.equal(typeof result.json.error, 'string');
  }
  assert.deepEqual(s.app.stores.characters.list(), []);
  assert.equal(s.app.stores.jobs.list().length, 0);
  assert.deepEqual(s.errors, []);
});

test('修改只接受合法名字描述，未知或坏编号拒绝且不改现有记录', async () => {
  const s = characterSetup(), upload = s.app.stores.uploads.save(png);
  const c = (await s.call('POST', '/api/characters', { name: '原名', images: [{ type: 'upload', id: upload.id }], authorized: true })).json;
  for (const changes of [{ name: '' }, { name: 'x'.repeat(41) }, { description: 1 }, { description: 'x'.repeat(501) }]) {
    assert.equal((await s.call('PATCH', '/api/characters', { id: c.id, ...changes })).status, 400);
  }
  assert.equal((await s.call('PATCH', '/api/characters', { id: unknown, name: 'x' })).status, 404);
  assert.equal((await s.call('PATCH', '/api/characters', { id: '../bad', name: 'x' })).status, 400);
  assert.equal((await s.call('DELETE', '/api/characters?id=../bad')).status, 400);
  assert.equal(s.app.stores.characters.read(c.id).name, '原名'); assert.deepEqual(s.errors, []);
});

test('GET带每图视频状态并过滤已删除文件，缺图人物记录仍保留', async () => {
  const s = characterSetup(), upload = s.app.stores.uploads.save(png);
  const old = createWorkStore(s.root, { now: () => new Date(Date.now() - 31 * 86400000) }).add(png, { model: FLASH_MODEL });
  const edited = s.app.stores.works.add(png, { model: FLASH_MODEL, refs: [{ type: 'upload', id: upload.id }] });
  const generated = s.app.stores.works.add(png, { model: FLASH_MODEL });
  const made = (await s.call('POST', '/api/characters', { name: '状态', authorized: true,
    images: [{ type: 'upload', id: upload.id }, ...[old, edited, generated].map(w => ({ type: 'work', id: w.id }))] })).json;
  assert.deepEqual(made.images.map(i => i.video.status), ['photo', 'expired', 'edited', 'trusted']);
  s.app.stores.works.remove(generated.id); s.app.stores.uploads.remove(upload.id);
  const list = (await s.call('GET', '/api/characters')).json;
  assert.deepEqual(list[0].images.map(i => i.ref.id), [old.id, edited.id]);
  assert.equal(s.app.stores.characters.read(made.id).images.length, 4);
  assert.equal((await s.call('GET', '/api/characters')).status, 200); assert.deepEqual(s.errors, []);
  assert.equal((await s.call('PATCH', '/api/characters', { id: newId(), description: '' })).status, 404);
});

test('旧PNG作品缺kind仍能存为人物，列表和修改持久化后重开可读', async () => {
  const s = characterSetup(), work = s.app.stores.works.add(png, { model: FLASH_MODEL });
  const { kind, ...legacy } = work;
  writeFileSync(join(dirname(s.app.stores.works.path(work.id)), 'work.json'), JSON.stringify(legacy));
  const made = await s.call('POST', '/api/characters', { name: '旧作品', images: [{ type: 'work', id: work.id }] });
  assert.equal(made.status, 200); assert.equal(made.json.images[0].video.status, 'trusted');
  await s.call('PATCH', '/api/characters', { id: made.json.id, description: '重开保留' });
  const reopened = characterSetup({ dataRoot: s.root });
  const list = (await reopened.call('GET', '/api/characters')).json;
  assert.equal(list[0].description, '重开保留'); assert.equal(list[0].images[0].ref.id, work.id);
  assert.deepEqual(reopened.errors, []);
});
