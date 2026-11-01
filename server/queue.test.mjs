import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobStore } from './store/jobs.mjs';
import { createSpendLog } from './store/spend.mjs';
import { createUploadStore } from './store/uploads.mjs';
import { createWorkStore } from './store/works.mjs';
import { concurrencyOf, createQueue, nextToStart } from './queue.mjs';
import { solidPng } from './png.mjs';
import { tempDir, waitFor } from './testKit.mjs';

const FLASH = 'doubao-seedream-5-0-flash-260915';

function setup(generate, concurrency = 3) {
  const root = tempDir();
  const stores = {
    jobs: createJobStore(root),
    works: createWorkStore(root),
    uploads: createUploadStore(root),
    spend: createSpendLog(root)
  };
  const errors = [];
  const queue = createQueue({ ...stores, generate, concurrency, logError: (tag, err) => errors.push({ tag, err }) });
  return { ...stores, queue, errors };
}

function input(overrides = {}) {
  return {
    canvasId: '11111111-1111-4111-8111-111111111111',
    cardId: 'card-1',
    model: FLASH,
    prompt: '一只猫',
    size: '1024x1024',
    count: 1,
    refs: [],
    priceYuan: 0.12,
    ...overrides
  };
}

const okImage = async () => ({ ok: true, image: solidPng(4, 4, [1, 2, 3]) });
const finished = (jobs, id) => () => ['succeeded', 'failed', 'uncertain'].includes(jobs.read(id)?.status);

test('一单两张：都进作品库、记两笔花费、状态成功', async () => {
  const t = setup(okImage);
  const job = t.queue.submit(input({ count: 2 }));
  await waitFor(finished(t.jobs, job.id));
  const done = t.jobs.read(job.id);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.works.length, 2);
  assert.equal(done.error, null);
  assert.equal(t.works.list().length, 2);
  assert.equal(t.works.list()[0].canvasId, input().canvasId);
  assert.equal(t.spend.totalOn(new Date()), 0.24);
});

test('同时最多跑 3 单，其余排队', async () => {
  let inFlight = 0;
  let peak = 0;
  const releases = [];
  const gated = () =>
    new Promise((resolve) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      releases.push(() => {
        inFlight -= 1;
        resolve({ ok: true, image: solidPng(2, 2, [0, 0, 0]) });
      });
    });
  const t = setup(gated, 3);
  const ids = Array.from({ length: 5 }, () => t.queue.submit(input()).id);
  await waitFor(() => releases.length === 3);
  assert.equal(peak, 3);
  for (let i = 0; i < 500 && ids.some((id) => !finished(t.jobs, id)()); i += 1) {
    releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(ids.every((id) => finished(t.jobs, id)()));
  assert.equal(peak, 3);
});

test('火山第一张就拒：标失败、不重发、不记花费', async () => {
  let calls = 0;
  const t = setup(async () => {
    calls += 1;
    return { ok: false, status: 400, message: '内容不合规' };
  });
  const job = t.queue.submit(input({ count: 3 }));
  await waitFor(finished(t.jobs, job.id));
  const done = t.jobs.read(job.id);
  assert.equal(done.status, 'failed');
  assert.match(done.error, /内容不合规/);
  assert.equal(calls, 1);
  assert.equal(t.spend.totalOn(new Date()), 0);
});

test('三张里第二张被拒：已出的那张留着，第三张不再发', async () => {
  let calls = 0;
  const t = setup(async () => {
    calls += 1;
    return calls === 2 ? { ok: false, status: 400, message: '被拒' } : { ok: true, image: solidPng(2, 2, [9, 9, 9]) };
  });
  const job = t.queue.submit(input({ count: 3 }));
  await waitFor(finished(t.jobs, job.id));
  const done = t.jobs.read(job.id);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.works.length, 1);
  assert.match(done.error, /1\/3/);
  assert.equal(calls, 2);
});

test('超时：标失败、说明可能已扣费、不重发', async () => {
  let calls = 0;
  const t = setup(async () => {
    calls += 1;
    throw new Error('EDIT_TIMEOUT');
  });
  const job = t.queue.submit(input());
  await waitFor(finished(t.jobs, job.id));
  const done = t.jobs.read(job.id);
  assert.equal(done.status, 'failed');
  assert.match(done.error, /没有自动重发/);
  assert.equal(calls, 1);
});

test('参考图被删了：不发火山，标失败', async () => {
  let calls = 0;
  const t = setup(async () => {
    calls += 1;
    return okImage();
  });
  const job = t.queue.submit(input({ refs: [{ type: 'upload', id: '22222222-2222-4222-8222-222222222222' }] }));
  await waitFor(finished(t.jobs, job.id));
  assert.equal(t.jobs.read(job.id).errorCode, 'REF_MISSING');
  assert.equal(calls, 0);
});

test('参考图原样交给出图函数', async () => {
  let seen = null;
  const t = setup(async (request) => {
    seen = request;
    return okImage();
  });
  const png = solidPng(3, 3, [5, 5, 5]);
  const { id } = t.uploads.save(png);
  const job = t.queue.submit(input({ refs: [{ type: 'upload', id }] }));
  await waitFor(finished(t.jobs, job.id));
  assert.equal(seen.images.length, 1);
  assert.deepEqual(seen.images[0].buffer, png);
  assert.equal(seen.images[0].contentType, 'image/png');
  assert.equal(seen.prompt, '一只猫');
});

test('重启收拾残局：正在跑的标「结果不明」不重发，排队的照常跑', async () => {
  let calls = 0;
  const t = setup(async () => {
    calls += 1;
    return okImage();
  });
  // 模拟上次进程：一单发到一半被关，一单还在排队（直接写硬盘，不经过 submit，免得立刻开跑）
  const halfway = t.jobs.create(input());
  t.jobs.patch(halfway.id, { status: 'running' });
  const waiting = t.jobs.create(input());
  assert.equal(t.queue.recover(), 1);
  assert.equal(t.jobs.read(halfway.id).status, 'uncertain');
  assert.match(t.jobs.read(halfway.id).error, /结果不明/);
  t.queue.pump();
  await waitFor(finished(t.jobs, waiting.id));
  assert.equal(t.jobs.read(waiting.id).status, 'succeeded');
  assert.equal(calls, 1);
});

test('并发数：没填用 3，填得离谱夹回 1~6', () => {
  assert.equal(concurrencyOf({}), 3);
  assert.equal(concurrencyOf({ IMAGE_CONCURRENCY: '2' }), 2);
  assert.equal(concurrencyOf({ IMAGE_CONCURRENCY: '100' }), 6);
  assert.equal(concurrencyOf({ IMAGE_CONCURRENCY: '0' }), 1);
  assert.equal(concurrencyOf({ IMAGE_CONCURRENCY: 'abc' }), 3);
});

test('先来的先跑，空位填满为止', () => {
  const jobs = [
    { id: 'b', status: 'queued', createdAt: '2026-10-20T00:00:02Z' },
    { id: 'a', status: 'queued', createdAt: '2026-10-20T00:00:01Z' },
    { id: 'c', status: 'running', createdAt: '2026-10-20T00:00:00Z' }
  ];
  assert.deepEqual(nextToStart(jobs, ['c'], 2), ['a']);
  assert.deepEqual(nextToStart(jobs, [], 3), ['a', 'b']);
  assert.deepEqual(nextToStart(jobs, ['x', 'y', 'z'], 3), []);
});
