import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVideoQueue } from './videoQueue.mjs';
import { createJobStore } from './store/jobs.mjs';
import { createSpendLog } from './store/spend.mjs';
import { createUploadStore } from './store/uploads.mjs';
import { createWorkStore } from './store/works.mjs';
import { tempDir, waitFor } from './testKit.mjs';

const silent = readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url));
const withSound = readFileSync(new URL('./fixtures/audio-video.mp4', import.meta.url));
const input = (extra = {}) => ({ kind: 'video', model: 'doubao-seedance-2-5-260628', mode: 'reference', prompt: '一只猫',
  ratio: '16:9', resolution: '480p', duration: 5, audio: false, refs: [], priceYuan: 2, taskType: 'reference', ...extra });

function setup(soundtrack) {
  const root = tempDir();
  const stores = { jobs: createJobStore(root), spend: createSpendLog(root), uploads: createUploadStore(root), works: createWorkStore(root) };
  const calls = { submit: 0, download: 0 };
  const client = {
    submit: async () => { calls.submit++; return { ok: true, taskId: 'task-1' }; },
    query: async () => ({ status: 'succeeded', content: { video_url: 'https://fake/video' }, usage: { completion_tokens: 50220 } }),
    download: async () => { calls.download++; return silent; }
  };
  const errors = [];
  const queue = createVideoQueue({ ...stores, client, pollMs: 1, soundtrack, logError: (tag, error) => errors.push({ tag, error }) });
  const source = stores.works.addVideo(withSound, {});
  return { ...stores, queue, calls, errors, source };
}
const finished = (t, id) => () => ['succeeded', 'failed', 'uncertain'].includes(t.jobs.read(id).status);

test('配回原声：拿原视频路径配声，作品存配好声音的那条，单子没有错误', async () => {
  const seen = [];
  const t = setup(async (buffer, path) => { seen.push({ buffer, path }); return withSound; });
  const job = t.queue.submit(input({ soundtrack: { type: 'work', id: t.source.id } }));
  await waitFor(finished(t, job.id));
  const done = t.jobs.read(job.id);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.error ?? null, null);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].buffer.equals(silent));
  assert.equal(seen[0].path, t.works.path(t.source.id));
  const work = t.works.read(done.works[0]);
  assert.ok(work.buffer.equals(withSound));
  assert.equal(t.works.metadata(done.works[0]).hasAudio, true);
});

test('没带配声来源的单子不配声，作品就是火山原片', async () => {
  let called = 0;
  const t = setup(async () => { called++; return withSound; });
  const job = t.queue.submit(input({ audio: true }));
  await waitFor(finished(t, job.id));
  assert.equal(called, 0);
  assert.ok(t.works.read(t.jobs.read(job.id).works[0]).buffer.equals(silent));
});

test('配声失败：照存无声成片、单子算成功并写明原因，不重下不重发', async () => {
  const t = setup(async () => { throw Error('ffmpeg 崩了 C:\\本机路径'); });
  const job = t.queue.submit(input({ soundtrack: { type: 'work', id: t.source.id } }));
  await waitFor(finished(t, job.id));
  const done = t.jobs.read(job.id);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.works.length, 1);
  assert.match(done.error, /配回原声失败/);
  assert.doesNotMatch(done.error, /本机路径/);
  assert.ok(t.works.read(done.works[0]).buffer.equals(silent));
  assert.deepEqual([t.calls.submit, t.calls.download], [1, 1]);
  assert.ok(Math.abs(t.spend.totalOn() - done.yuan) < 0.01, '花费照记');
  assert.equal(t.errors.length, 1);
});

test('原视频被删了：不调用配声，照存无声成片并说明找不到原视频', async () => {
  let called = 0;
  const t = setup(async () => { called++; return withSound; });
  t.works.remove(t.source.id);
  const job = t.queue.submit(input({ soundtrack: { type: 'work', id: t.source.id } }));
  await waitFor(finished(t, job.id));
  const done = t.jobs.read(job.id);
  assert.equal(called, 0);
  assert.equal(done.status, 'succeeded');
  assert.match(done.error, /找不到原视频/);
});
