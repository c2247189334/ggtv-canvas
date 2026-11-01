import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVideoQueue } from './videoQueue.mjs';
import { createQueue, nextToStart } from './queue.mjs';
import { createJobStore } from './store/jobs.mjs';
import { createSpendLog } from './store/spend.mjs';
import { createUploadStore } from './store/uploads.mjs';
import { createWorkStore } from './store/works.mjs';
import { solidPng } from './png.mjs';
import { tempDir, waitFor } from './testKit.mjs';

const video = readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url));
const input = (extra = {}) => ({ kind: 'video', model: 'doubao-seedance-2-0-mini-260615',
  mode: 'reference', prompt: '一只猫', ratio: '16:9', resolution: '480p', duration: 5,
  audio: true, refs: [], priceYuan: 1.15506, ...extra });
const terminal = (t, id) => () => ['succeeded', 'failed', 'uncertain'].includes(t.jobs.read(id).status);

test('reference任务类型落盘，重启恢复仍送到假客户端；普通单不添字段', async () => {
  const requests = [];
  const t = setup({ submit: async request => { requests.push(request); return { ok: true, taskId: 'saved-task' }; } });
  const job = t.jobs.create(input({ model: 'doubao-seedance-2-5-260628', taskType: 'reference' }));
  t.jobs.patch(job.id, { status: 'running', phase: 'uploading' });
  const reopened = createJobStore(t.root);
  assert.equal(reopened.read(job.id).taskType, 'reference');
  const recovered = createVideoQueue({ ...t, jobs: reopened, client: t.client, pollMs: 1 });
  recovered.recover(); recovered.pump();
  await waitFor(terminal(t, job.id));
  assert.equal(requests[0].taskType, 'reference');
  const plain = t.queue.submit(input());
  await waitFor(terminal(t, plain.id));
  assert.equal(Object.hasOwn(requests[1], 'taskType'), false);
});
function setup(overrides = {}, options = {}) {
  const root = tempDir();
  const stores = { jobs: createJobStore(root), spend: createSpendLog(root),
    uploads: createUploadStore(root), works: createWorkStore(root) };
  const calls = { submit: 0, query: 0, download: 0 };
  const client = {
    submit: async () => { calls.submit++; return { ok: true, taskId: 'task-1' }; },
    query: async () => { calls.query++; return { status: 'succeeded', content: { video_url: 'https://fake/video' }, usage: { completion_tokens: 50220 } }; },
    download: async () => { calls.download++; return video; }, ...overrides
  };
  const errors = [];
  const queue = createVideoQueue({ ...stores, client, pollMs: 1,
    logError: (tag, error) => errors.push({ tag, error }), ...options });
  return { ...stores, root, client, queue, calls, errors };
}

test('视频成功：提交前落盘，任务号立即落盘，实收和作品元数据正确', async () => {
  let t;
  t = setup({ submit: async () => {
    const job = t.jobs.list()[0];
    assert.equal(job.phase, 'submitting');
    assert.ok(job.submitStartedAt);
    return { ok: true, taskId: 'task-durable' };
  }, query: async (taskId) => {
    assert.equal(taskId, 'task-durable');
    assert.equal(t.jobs.list()[0].taskId, taskId);
    return { status: 'succeeded', content: { video_url: 'https://fake/video' }, usage: { completion_tokens: 100000 } };
  }});
  const job = t.queue.submit(input());
  await waitFor(terminal(t, job.id));
  const done = t.jobs.read(job.id);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.costEstimated, false);
  assert.equal(done.yuan, 2.3);
  assert.equal(t.spend.totalOn(), 2.3);
  const work = t.works.list()[0];
  assert.equal(work.kind, 'video');
  assert.equal(work.taskId, 'task-durable');
  assert.equal(work.duration, 2);
  assert.equal(work.width, 320);
  assert.equal(work.height, 180);
  assert.equal(work.mode, 'reference');
  assert.equal(work.resolution, '480p');
  assert.equal(work.ratio, '16:9');
  assert.deepEqual(done.works, [work.id]);
});

test('没给token记估价；明确拒绝/没发出/不明均只提交一次', async () => {
  const estimated = setup({ query: async () => ({ status: 'succeeded', content: { video_url: 'https://fake/video' } }) });
  const first = estimated.queue.submit(input());
  await waitFor(terminal(estimated, first.id));
  assert.equal(estimated.jobs.read(first.id).costEstimated, true);
  assert.equal(estimated.jobs.read(first.id).yuan, 1.15506);
  for (const outcome of ['rejected', 'notSent', 'uncertain']) {
    let calls = 0;
    const t = setup({ submit: async () => { calls++; return { ok: false, outcome, code: 'TEST', message: '原因', blocked: [1, 3] }; } });
    const image = t.uploads.save(solidPng(4, 4, [1, 2, 3]));
    const job = t.queue.submit(input({ refs: Array.from({ length: 3 }, () => ({ type: 'upload', id: image.id, kind: 'image' })) }));
    await waitFor(terminal(t, job.id));
    t.queue.pump();
    assert.equal(calls, 1);
    const done = t.jobs.read(job.id);
    assert.equal(done.status, outcome === 'uncertain' ? 'uncertain' : 'failed');
    assert.match(done.error, outcome === 'uncertain' ? /没有自动重发.*控制台/ : /没扣钱|没花钱/);
    assert.deepEqual(done.blocked, [1, 3]);
    assert.equal(t.spend.totalOn(), 0);
  }
});

test('只读查询和下片失败可重试，永不再提交', async () => {
  let queries = 0, downloads = 0;
  const t = setup({ query: async () => {
    queries++;
    if (queries === 1) throw new Error('temporary query failure');
    return { status: queries === 2 ? 'running' : 'succeeded', content: { video_url: 'https://fake/video' } };
  }, download: async () => { downloads++; if (downloads === 1) throw new Error('temporary download failure'); return video; } });
  const job = t.queue.submit(input());
  await waitFor(terminal(t, job.id));
  assert.equal(t.jobs.read(job.id).status, 'succeeded');
  assert.equal(t.calls.submit, 1);
  assert.equal(downloads, 2);
  assert.equal(t.errors.length, 2);
});

test('任务失败、过期、两种取消均说明不收费', async () => {
  for (const status of ['failed', 'expired', 'cancelled', 'canceled']) {
    const t = setup({ query: async () => ({ status, error: { code: 'Blocked', message: '审核未通过' } }) });
    const job = t.queue.submit(input());
    await waitFor(terminal(t, job.id));
    assert.equal(t.jobs.read(job.id).status, 'failed');
    assert.match(t.jobs.read(job.id).error, /Blocked.*审核未通过.*失败不收费/);
    assert.equal(t.spend.totalOn(), 0);
  }
});

test('视频出好超过24小时下片仍失败：说明已扣费链接过期', async () => {
  const t = setup({ download: async () => { throw new Error('download failed'); } }, { now: () => new Date('2026-10-23T12:00:00Z') });
  const job = t.jobs.create(input({ taskId: 'old-task', completedAt: '2026-10-22T11:00:00Z' }));
  t.queue.pump();
  await waitFor(terminal(t, job.id));
  assert.equal(t.calls.submit, 0);
  assert.match(t.jobs.read(job.id).error, /已扣费.*24 小时.*过期/);
});

test('重启：有任务号只查；提交过没号标不明；只上传过退回排队', async () => {
  const t = setup();
  const waiting = t.jobs.create(input({ taskId: 'known-task', submitStartedAt: '2026-10-22T00:00:00Z' }));
  const uncertain = t.jobs.create(input({ submitStartedAt: '2026-10-22T00:00:00Z' }));
  const uploading = t.jobs.create(input());
  for (const [job, phase] of [[waiting, 'waiting'], [uncertain, 'submitting'], [uploading, 'uploading']]) t.jobs.patch(job.id, { status: 'running', phase });
  assert.equal(t.queue.recover(), 3);
  assert.equal(t.jobs.read(waiting.id).status, 'queued');
  assert.equal(t.jobs.read(uncertain.id).status, 'uncertain');
  assert.equal(t.jobs.read(uploading.id).status, 'queued');
  t.queue.pump();
  await waitFor(() => terminal(t, waiting.id)() && terminal(t, uploading.id)());
  assert.equal(t.calls.submit, 1);
  assert.equal(t.works.list().length, 2);
});

test('出图挑单和重启收拾跳过视频；视频不碰老出图单', async () => {
  assert.deepEqual(nextToStart([{ id: 'v', kind: 'video', status: 'queued' }, { id: 'i', status: 'queued' }], [], 3), ['i']);
  const t = setup();
  const v = t.jobs.create(input());
  const i = t.jobs.create({ prompt: 'old image' });
  t.jobs.patch(v.id, { status: 'running', phase: 'uploading' });
  t.jobs.patch(i.id, { status: 'running' });
  const imageQueue = createQueue({ ...t, generate: async () => { throw new Error('must not run'); } });
  assert.equal(imageQueue.recover(), 1);
  assert.equal(t.jobs.read(v.id).status, 'running');
  assert.equal(t.queue.recover(), 1);
  assert.equal(t.jobs.read(i.id).status, 'uncertain');
});

test('上传参考视频也占并发位：最多3单', async () => {
  const releases = [];
  let active = 0, peak = 0, submissions = 0;
  const t = setup({ submit: async (request) => {
    submissions++;
    assert.equal(request.videos.length, 1);
    return { ok: true, taskId: `task-${submissions}` };
  } }, { concurrency: 20, uploadVideo: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => releases.push(resolve));
    active--;
    return 'https://fake/ref';
  } });
  const up = t.uploads.save(video);
  const ids = Array.from({ length: 5 }, () => t.queue.submit(input({ refs: [{ type: 'upload', id: up.id, kind: 'video' }] })).id);
  await waitFor(() => releases.length === 3);
  assert.equal(peak, 3);
  for (let n = 0; n < 100 && !ids.every(id => terminal(t, id)()); n++) {
    releases.shift()?.();
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.ok(ids.every(id => terminal(t, id)()));
  assert.equal(peak, 3);
  assert.equal(submissions, 5);
});

test('带真人asset编号的图不读字节，混排被拦编号映射回原参考', async () => {
  let seen;
  const t = setup({ submit: async (request) => {
    seen = request;
    return { ok: false, outcome: 'rejected', code: 'InputImageSensitiveContentDetected.PrivacyInformation', blocked: [1, 2] };
  } }, { uploadVideo: async () => 'https://fake/ref' });
  const v = t.uploads.save(video);
  const i = t.uploads.save(solidPng(4, 4, [1, 2, 3]));
  const original = t.uploads.read;
  t.uploads.read = id => { assert.notEqual(id, i.id); return original(id); };
  const job = t.queue.submit(input({ refs: [
    { type: 'upload', id: v.id, kind: 'video' },
    { type: 'upload', id: i.id, kind: 'image', asset: 'real-person-123' }
  ] }));
  await waitFor(terminal(t, job.id));
  assert.deepEqual(seen.images, [{ asset: 'real-person-123' }]);
  assert.equal(seen.refVideoSeconds, 2);
  assert.deepEqual(t.jobs.read(job.id).blocked, [2, 1]);
  assert.match(t.jobs.read(job.id).error, /参考 2、参考 1.*没扣钱/);
});

test('传TOS失败或参考丢失：没提交，不花钱', async () => {
  for (const missing of [false, true]) {
    const t = setup({}, { uploadVideo: async () => { throw new Error('TOS failure'); } });
    const asset = t.uploads.save(video);
    if (missing) t.uploads.remove(asset.id);
    const job = t.queue.submit(input({ refs: [{ type: 'upload', id: asset.id, kind: 'video' }] }));
    await waitFor(terminal(t, job.id));
    assert.equal(t.jobs.read(job.id).status, 'failed');
    assert.match(t.jobs.read(job.id).error, /没发出去.*没花钱/);
    assert.equal(t.calls.submit, 0);
  }
});

test('TOS配置中途缺失：准确指出变量，未提交没花钱', async () => {
  const t = setup({}, { uploadVideo: async () => {
    throw Object.assign(new Error('安全人话'), { code: 'TOS_BUCKET_MISSING' });
  } });
  const asset = t.uploads.save(video);
  const job = t.queue.submit(input({ refs: [{ type: 'upload', id: asset.id, kind: 'video' }] }));
  await waitFor(terminal(t, job.id));
  assert.match(t.jobs.read(job.id).error, /没填 TOS_BUCKET.*没花钱/);
  assert.equal(t.calls.submit, 0);
});

test('首次查询已成功：updated_at或ISO完成时间决定链接期限', async () => {
  for (const time of [{ updated_at: Date.parse('2026-10-22T11:00:00Z') / 1000 }, { finished_at: '2026-10-22T11:00:00Z' }]) {
    const t = setup({ query: async () => ({ ...time, status: 'succeeded', content: { video_url: 'https://fake/video' } }) }, {
      now: () => new Date('2026-10-23T12:00:00Z')
    });
    const job = t.queue.submit(input());
    await waitFor(terminal(t, job.id));
    assert.equal(t.jobs.read(job.id).status, 'failed');
    assert.match(t.jobs.read(job.id).error, /已扣费.*过期/);
    assert.equal(t.calls.download, 0);
  }
});

test('火山失败原话以句号结尾时不叠加句号', async () => {
  for (const message of ['审核未通过', '审核未通过。']) {
    const t = setup({ query: async () => ({ status: 'failed', error: { code: 'Blocked', message } }) });
    const job = t.queue.submit(input());
    await waitFor(terminal(t, job.id));
    assert.equal(t.jobs.read(job.id).error, '火山生成失败（Blocked）：审核未通过。按火山规则失败不收费。');
  }
});

test('成功、失败、提交不明与重启不明都会清空生成阶段', async () => {
  for (const outcome of ['succeeded', 'failed', 'uncertain']) {
    const t = setup(outcome === 'succeeded' ? {} : outcome === 'failed'
      ? { query: async () => ({ status: 'failed' }) }
      : { submit: async () => ({ ok: false, outcome: 'uncertain' }) });
    const job = t.queue.submit(input());
    await waitFor(terminal(t, job.id));
    assert.equal(t.jobs.read(job.id).status, outcome);
    assert.equal(t.jobs.read(job.id).phase, null);
  }
  const t = setup();
  const job = t.jobs.create(input({ submitStartedAt: '2026-10-22T00:00:00Z', phase: 'submitting' }));
  t.jobs.patch(job.id, { status: 'running' });
  t.queue.recover();
  assert.equal(t.jobs.read(job.id).status, 'uncertain');
  assert.equal(t.jobs.read(job.id).phase, null);
});
