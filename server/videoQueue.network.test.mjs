import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVideoQueue } from './videoQueue.mjs';
import { createJobStore } from './store/jobs.mjs';
import { createSpendLog } from './store/spend.mjs';
import { createUploadStore } from './store/uploads.mjs';
import { createWorkStore } from './store/works.mjs';
import { jobView } from './routes/jobs.mjs';
import { tempDir, waitFor } from './testKit.mjs';

const video = readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url));
const input = { kind: 'video', model: 'doubao-seedance-2-0-mini-260615', mode: 'reference', prompt: '猫',
  ratio: '16:9', resolution: '480p', duration: 5, audio: true, refs: [], priceYuan: 1 };
function stores() {
  const root = tempDir();
  return { jobs: createJobStore(root), spend: createSpendLog(root), uploads: createUploadStore(root), works: createWorkStore(root) };
}

test('查询连续失败一段时间显示中文提醒，保持running和任务号；恢复即清提醒且从不重交', async () => {
  const state = stores(), releases = [];
  let elapsed = 0, submits = 0, queries = 0, restored = false, completed = false;
  const queue = createVideoQueue({ ...state, pollMs: 50, queryWarningAfterMs: 60,
    now: () => new Date(Date.UTC(2026, 9, 31) + elapsed),
    sleep: async ms => { elapsed += ms; await new Promise(resolve => releases.push(resolve)); },
    client: { submit: async () => { submits++; return { ok: true, taskId: 'same-task' }; },
      query: async id => {
        assert.equal(id, 'same-task'); queries++;
        if (!restored) throw Error('PRIVATE_TECHNICAL_QUERY_ERROR');
        return completed ? { status: 'succeeded', content: { video_url: 'https://example.invalid/video' }, usage: { completion_tokens: 1 } }
          : { status: 'running' };
      }, download: async () => video } });
  const job = queue.submit(input);
  await waitFor(() => releases.length === 1);
  assert.equal(state.jobs.read(job.id).warning ?? null, null);
  releases.shift()();
  await waitFor(() => releases.length === 1 && queries === 2);
  assert.equal(state.jobs.read(job.id).warning ?? null, null);
  releases.shift()();
  await waitFor(() => releases.length === 1 && queries === 3);
  const waiting = state.jobs.read(job.id);
  assert.equal(waiting.status, 'running');
  assert.equal(waiting.taskId, 'same-task');
  assert.match(waiting.warning, /暂时查不到进度.*检查网络.*继续查询.*不会重新提交/);
  assert.doesNotMatch(waiting.warning, /PRIVATE_TECHNICAL|Error|undefined|null/);
  assert.equal(jobView(waiting, state.works).warning, waiting.warning);
  assert.equal(waiting.error, null);
  assert.equal(submits, 1);
  restored = true; releases.shift()();
  await waitFor(() => releases.length === 1 && queries === 4);
  const recovered = state.jobs.read(job.id);
  assert.equal(recovered.warning, null);
  assert.equal(recovered.status, 'running');
  assert.equal(jobView(recovered, state.works).warning, null);
  completed = true; releases.shift()();
  await waitFor(() => state.jobs.read(job.id).status === 'succeeded');
  assert.equal(state.jobs.read(job.id).warning, null);
  assert.equal(submits, 1);
  assert.equal(state.works.list().length, 1);
});

test('服务重启后保留任务号，只读查询恢复时清掉持久化网络提醒', async () => {
  const state = stores(); let submits = 0;
  const job = state.jobs.create({ ...input, taskId: 'saved-task' });
  state.jobs.patch(job.id, { status: 'running', phase: 'waiting', warning: '暂时查不到进度' });
  const queue = createVideoQueue({ ...state, pollMs: 1,
    client: { submit: async () => { submits++; throw Error('不得重复提交'); },
      query: async () => ({ status: 'succeeded', content: { video_url: 'https://example.invalid/video' } }), download: async () => video } });
  assert.equal(queue.recover(), 1);
  queue.pump();
  await waitFor(() => state.jobs.read(job.id).status === 'succeeded');
  assert.equal(state.jobs.read(job.id).warning, null);
  assert.equal(submits, 0);
});
