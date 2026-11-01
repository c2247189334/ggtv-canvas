import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeSeedance } from './fakeSeedance.mjs';

const input = { model: 'doubao-seedance-2-0-mini-260615', mode: 'reference', prompt: '动起来', resolution: '480p', ratio: '16:9', duration: 5, audio: true };

test('假客户端照收改写reference任务类型', async () => {
  const c = createFakeSeedance({ delayMs: 0 });
  const result = await c.submit({ ...input, model: 'doubao-seedance-2-5-260628', taskType: 'reference' });
  assert.equal(result.ok, true);
  await c.query(result.taskId); await c.query(result.taskId);
  assert.equal((await c.query(result.taskId)).status, 'succeeded');
});

test('假任务先排队再运行，过delay成功，给公式token和fixture视频', async () => {
  let time = 100;
  const c = createFakeSeedance({ delayMs: 100, now: () => time });
  const result = await c.submit({ ...input, refVideoSeconds: 3 });
  assert.equal(result.ok, true);
  assert.equal((await c.query(result.taskId)).status, 'queued');
  assert.equal((await c.query(result.taskId)).status, 'running');
  time += 100;
  const done = await c.query(result.taskId);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.usage.completion_tokens, 80352);
  assert.equal((await c.download(done.content.video_url)).length, 2935);
  assert.match(await c.uploadVideo({ buffer: Buffer.from('x') }), /^https:\/\//);
});

test('四种提示词各自触发拒收、被拦、提交不明和任务失败', async () => {
  const c = createFakeSeedance({ delayMs: 0 });
  assert.equal((await c.submit({ ...input, prompt: '假失败' })).outcome, 'rejected');
  const blocked = await c.submit({ ...input, prompt: '假被拦' });
  assert.deepEqual(blocked.blocked, [1]);
  assert.match(blocked.message, /没扣钱/);
  assert.equal((await c.submit({ ...input, prompt: '假超时' })).outcome, 'uncertain');
  const result = await c.submit({ ...input, prompt: '假任务失败' });
  await c.query(result.taskId);
  assert.equal((await c.query(result.taskId)).status, 'running');
  assert.equal((await c.query(result.taskId)).status, 'failed');
});

test('delay已过也必须经过queued、running，然后succeeded', async () => {
  const c = createFakeSeedance({ delayMs: 0 });
  const result = await c.submit(input);
  assert.equal((await c.query(result.taskId)).status, 'queued');
  assert.equal((await c.query(result.taskId)).status, 'running');
  assert.equal((await c.query(result.taskId)).status, 'succeeded');
});

test('假客户端接受2.5纯声音参考，声音不增加视频token', async () => {
  const c = createFakeSeedance({ delayMs: 0 });
  const result = await c.submit({ ...input, model: 'doubao-seedance-2-5-260628', prompt: '按@音频1动起来', images: [], videos: [],
    audios: [{ kind: 'audio', contentType: 'audio/wav', buffer: Buffer.from('wav'), duration: 3 }] });
  assert.equal(result.ok, true);
  await c.query(result.taskId);
  await c.query(result.taskId);
  const finished = await c.query(result.taskId);
  assert.equal(finished.status, 'succeeded');
  assert.equal(finished.usage.completion_tokens, 48037.5);
});
