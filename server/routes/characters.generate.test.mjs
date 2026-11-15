import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterSetup } from './characterTestKit.mjs';
import { createFakeArk } from '../fakeArk.mjs';
import { waitFor } from '../testKit.mjs';
import { characterImageJob } from '../characterPolicy.mjs';
import { newId } from '../store/files.mjs';

const finished = (s, id) => waitFor(() => ['succeeded', 'failed', 'uncertain'].includes(s.app.stores.jobs.read(id)?.status));

test('生成先落人物和单子，假出图入作品与账单，GET收成单张设定图且反复读取不重发', async () => {
  let s, calls = 0, persisted;
  const fake = createFakeArk({ delayMs: 20 });
  s = characterSetup({ generate: async input => {
    calls++; const job = s.app.stores.jobs.list()[0];
    persisted = { job, character: s.app.stores.characters.read(job.characterId), input };
    return fake(input);
  } });
  const description = '一位穿蓝衣服的成年人物';
  const submitted = await s.call('POST', '/api/characters/generate', { description });
  assert.equal(submitted.status, 200); assert.equal(submitted.json.status, 'generating');
  assert.equal(submitted.json.name, [...description].slice(0, 8).join(''));
  const c = submitted.json, job = s.app.stores.jobs.read(c.jobId);
  assert.equal(persisted.character.id, c.id); assert.equal(persisted.job.status, 'running');
  assert.deepEqual(persisted.input.images, []);
  for (const [key, value] of Object.entries(characterImageJob(c.id, description))) assert.deepEqual(job[key], value);
  await finished(s, c.jobId);
  const list = (await s.call('GET', '/api/characters')).json;
  assert.equal(list[0].status, 'ready'); assert.equal(list[0].images.length, 1);
  assert.equal(list[0].images[0].label, '设定图'); assert.deepEqual(list[0].images[0].video, { status: 'trusted', days: 30 });
  const work = s.app.stores.works.list()[0];
  assert.equal(work.id, list[0].images[0].ref.id); assert.equal(work.canvasId, null);
  assert.equal(s.app.stores.spend.totalOn(), job.priceYuan);
  await s.call('GET', '/api/characters'); assert.equal(calls, 1); assert.deepEqual(s.errors, []);
});

test('缺Key和非法描述在交单前拦住，未建人物和任务且明确没发出去', async () => {
  let calls = 0;
  const s = characterSetup({ fake: false, readEnv: () => ({}), generate: async () => { calls++; throw Error('不得调用'); } });
  const denied = await s.call('POST', '/api/characters/generate', { description: '人物' });
  assert.equal(denied.status, 400); assert.match(denied.json.error, /没发出去/);
  const fake = characterSetup();
  for (const description of ['', ' ', null, 'x'.repeat(501)]) {
    assert.equal((await fake.call('POST', '/api/characters/generate', { description })).status, 400);
  }
  assert.equal(calls, 0); assert.deepEqual(s.app.stores.jobs.list(), []); assert.deepEqual(s.app.stores.characters.list(), []);
  assert.deepEqual(fake.app.stores.jobs.list(), []);
});

test('假失败照抄单子错误且不重发，只允许失败人物手动重试', async () => {
  let calls = 0; const fake = createFakeArk({ delayMs: 5 });
  const s = characterSetup({ generate: input => { calls++; return fake(input); } });
  const first = (await s.call('POST', '/api/characters/generate', { description: '假失败人物' })).json;
  assert.equal((await s.call('POST', '/api/characters/generate', { id: first.id, description: '重试' })).status, 400);
  await finished(s, first.jobId);
  const failed = (await s.call('GET', '/api/characters')).json[0];
  assert.equal(failed.status, 'failed'); assert.equal(failed.error, s.app.stores.jobs.read(first.jobId).error);
  assert.match(failed.error, /假火山/); assert.equal(s.app.stores.spend.totalOn(), 0);
  await s.call('GET', '/api/characters'); assert.equal(calls, 1);
  const retry = await s.call('POST', '/api/characters/generate', { id: first.id, description: '换一种描述' });
  assert.equal(retry.status, 200); assert.equal(retry.json.id, first.id);
  assert.equal(retry.json.name, first.name); assert.equal(retry.json.error, undefined);
  assert.notEqual(retry.json.jobId, first.jobId); await finished(s, retry.json.jobId);
  assert.equal((await s.call('GET', '/api/characters')).json[0].status, 'ready'); assert.equal(calls, 2);
  assert.equal((await s.call('POST', '/api/characters/generate', { id: first.id, description: '再试' })).status, 400);
  assert.equal((await s.call('POST', '/api/characters/generate', { id: newId(), description: '人物' })).status, 404);
  assert.equal((await s.call('POST', '/api/characters/generate', { id: '../bad', description: '人物' })).status, 400);
  assert.deepEqual(s.errors, []);
});

test('重启把未回单标不明，GET照抄不明原话、缺单失败，不重发', async () => {
  const s = characterSetup(), job = s.app.stores.jobs.create(characterImageJob('person', '人物'));
  s.app.stores.jobs.patch(job.id, { status: 'running' });
  const c = s.app.stores.characters.create({ name: '人物', description: '人物', images: [], status: 'generating', jobId: job.id });
  let calls = 0;
  const reopened = characterSetup({ dataRoot: s.root, generate: async () => { calls++; throw Error('不得重发'); } });
  assert.equal(reopened.app.queue.recover(), 1);
  const result = (await reopened.call('GET', '/api/characters')).json.find(row => row.id === c.id);
  assert.equal(result.status, 'failed'); assert.equal(result.error, reopened.app.stores.jobs.read(job.id).error);
  assert.match(result.error, /结果不明/); assert.equal(calls, 0);
  const missing = reopened.app.stores.characters.create({ name: '缺单', description: '', images: [], status: 'generating', jobId: newId() });
  const list = (await reopened.call('GET', '/api/characters')).json;
  assert.equal(list.find(row => row.id === missing.id).status, 'failed');
  assert.match(list.find(row => row.id === missing.id).error, /记录找不到/);
});

test('人物生成也共享最多三单，排队任务在磁盘并最终全部收齐', async () => {
  let active = 0, peak = 0; const fake = createFakeArk({ delayMs: 30 });
  const s = characterSetup({ generate: async input => {
    active++; peak = Math.max(peak, active);
    try { return await fake(input); } finally { active--; }
  } });
  const rows = [];
  for (let index = 0; index < 4; index++) rows.push((await s.call('POST', '/api/characters/generate', { description: `人物${index}` })).json);
  assert.equal(s.app.stores.jobs.list().length, 4);
  assert.equal(s.app.stores.jobs.read(rows[3].jobId).status, 'queued');
  for (const row of rows) await finished(s, row.jobId);
  assert.equal(peak, 3); assert.equal((await s.call('GET', '/api/characters')).json.filter(c => c.status === 'ready').length, 4);
  assert.equal(s.app.stores.spend.totalOn(), 0.48); assert.deepEqual(s.errors, []);
});
