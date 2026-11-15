// 11-11 体检：视频单拿到任务号后，硬盘写不进去（Windows 上文件被杀毒 / 备份占着）不能把单子标成终态——钱已花，片还能取。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVideoQueue } from './videoQueue.mjs';
import { createJobStore } from './store/jobs.mjs';
import { createSpendLog } from './store/spend.mjs';
import { createUploadStore } from './store/uploads.mjs';
import { createWorkStore } from './store/works.mjs';
import { tempDir, waitFor } from './testKit.mjs';

const video = readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url));
const input = { kind: 'video', model: 'doubao-seedance-2-0-mini-260615', mode: 'reference', prompt: '一只猫', ratio: '16:9',
  resolution: '480p', duration: 5, audio: true, refs: [], priceYuan: 1.15506 };
const busy = () => Object.assign(Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });

/** failPatch(changes) 返回 true 的那次写盘抛错（只抛一次）；failAdd 为 true 时第一次存作品抛错。 */
function setup({ failPatch = () => false, failAdd = false, statuses = ['succeeded'] } = {}) {
  const root = tempDir();
  const real = { jobs: createJobStore(root), spend: createSpendLog(root), uploads: createUploadStore(root), works: createWorkStore(root) };
  const calls = { submit: 0, query: 0, download: 0, failed: 0 };
  let patchFailed = false, addFailed = false;
  const jobs = { ...real.jobs, patch(id, changes) {
    if (!patchFailed && failPatch(changes)) { patchFailed = true; calls.failed++; throw busy(); }
    return real.jobs.patch(id, changes);
  } };
  const works = { ...real.works, addVideo(buffer, meta) {
    if (failAdd && !addFailed) { addFailed = true; calls.failed++; throw Object.assign(Error('ENOSPC'), { code: 'ENOSPC' }); }
    return real.works.addVideo(buffer, meta);
  } };
  const client = {
    submit: async () => { calls.submit++; return { ok: true, taskId: 'task-kept' }; },
    query: async () => { const status = statuses[Math.min(calls.query++, statuses.length - 1)];
      return { status, content: { video_url: 'https://fake/video' }, usage: { completion_tokens: 100000 } }; },
    download: async () => { calls.download++; return video; }
  };
  const queue = createVideoQueue({ ...real, jobs, works, client, pollMs: 1 });
  return { ...real, queue, calls };
}
const settled = (t, id) => () => ['succeeded', 'failed', 'uncertain'].includes(t.jobs.read(id).status);

test('等片时写进度失败一次：不标结果不明，接着查，片照收、只记一次账', async () => {
  const t = setup({ statuses: ['running', 'running', 'succeeded'], failPatch: changes => changes.phase === 'waiting' && !changes.status && !('submitStartedAt' in changes) && t?.calls.query > 0 });
  const job = t.queue.submit(input);
  await waitFor(settled(t, job.id));
  const done = t.jobs.read(job.id);
  assert.equal(t.calls.failed, 1);
  assert.equal(done.status, 'succeeded');
  assert.equal(t.calls.submit, 1);
  assert.equal(t.works.list().length, 1);
  assert.equal(t.spend.totalOn(), 2.3);
});

test('任务号落盘那一下失败：任务号不丢，继续查到出片，任务号最后补进硬盘', async () => {
  const t = setup({ statuses: ['running', 'succeeded'], failPatch: changes => changes.taskId === 'task-kept' });
  const job = t.queue.submit(input);
  await waitFor(settled(t, job.id));
  const done = t.jobs.read(job.id);
  assert.equal(t.calls.failed, 1);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.taskId, 'task-kept');
  assert.equal(t.calls.submit, 1);
  assert.equal(t.works.list()[0].taskId, 'task-kept');
});

test('片已进作品库、已记账，收尾写盘失败：等一轮再收尾，不重下成两份、不记两次账', async () => {
  const t = setup({ failPatch: changes => changes.status === 'succeeded' });
  const job = t.queue.submit(input);
  await waitFor(settled(t, job.id));
  const done = t.jobs.read(job.id);
  assert.equal(t.calls.failed, 1);
  assert.equal(done.status, 'succeeded');
  assert.equal(t.works.list().length, 1);
  assert.deepEqual(done.works, [t.works.list()[0].id]);
  assert.equal(done.yuan, 2.3);
  assert.equal(t.calls.download, 1);
  assert.equal(t.spend.totalOn(), 2.3);
  assert.equal(t.calls.submit, 1);
});

test('存作品失败（比如盘满）：不标结果不明，下一轮重新下片再存，只记一次账', async () => {
  const t = setup({ failAdd: true });
  const job = t.queue.submit(input);
  await waitFor(settled(t, job.id));
  assert.equal(t.calls.failed, 1);
  assert.equal(t.jobs.read(job.id).status, 'succeeded');
  assert.equal(t.works.list().length, 1);
  assert.equal(t.calls.download, 2);
  assert.equal(t.spend.totalOn(), 2.3);
  assert.equal(t.calls.submit, 1);
});

test('还没提交就出意外的单照旧标失败，不发单', async () => {
  const t = setup({ failPatch: changes => changes.phase === 'submitting' });
  const job = t.queue.submit(input);
  await waitFor(settled(t, job.id));
  assert.equal(t.jobs.read(job.id).status, 'failed');
  assert.equal(t.calls.submit, 0);
});

// 11-14 体检：还没发出去的单，硬盘一直写不进时不能在同一拍里无限重挑（整个小服务会卡死）；隔一轮再试。
test('没发出去的单硬盘写不进时不原地打转：隔一轮再试，写得进了照常交单且只交一次', async () => {
  const root = tempDir();
  const real = { jobs: createJobStore(root), spend: createSpendLog(root), uploads: createUploadStore(root), works: createWorkStore(root) };
  let fails = 300, tries = 0, submits = 0;
  const jobs = { ...real.jobs, patch(id, changes) {
    tries += 1;
    if (fails > 0) { fails -= 1; throw busy(); }
    return real.jobs.patch(id, changes);
  } };
  const client = { submit: async () => { submits += 1; return { ok: true, taskId: 'task-late' }; },
    query: async () => ({ status: 'succeeded', content: { video_url: 'https://fake/video' }, usage: { completion_tokens: 100000 } }),
    download: async () => video };
  const queue = createVideoQueue({ ...real, jobs, client, pollMs: 20 });
  const job = real.jobs.create({ ...input });
  queue.pump();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(tries <= 4, `一拍之内只该试一轮，实际写了 ${tries} 次`);
  assert.equal(submits, 0, '状态没写进硬盘就不能交单');
  fails = 0;
  await waitFor(() => real.jobs.read(job.id).status === 'succeeded');
  assert.equal(submits, 1);
});
