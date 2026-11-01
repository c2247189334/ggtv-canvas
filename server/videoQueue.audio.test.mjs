import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVideoQueue } from './videoQueue.mjs';
import { createJobStore } from './store/jobs.mjs';
import { createUploadStore } from './store/uploads.mjs';
import { createWorkStore } from './store/works.mjs';
import { solidPng } from './png.mjs';
import { tempDir, waitFor } from './testKit.mjs';

const audioId = '33333333-3333-4333-8333-333333333333';
const audio = { kind: 'audio', contentType: 'audio/wav', duration: 3, bytes: 3, buffer: Buffer.from('wav') };
const input = refs => ({ kind: 'video', model: 'doubao-seedance-2-5-260628', mode: 'reference', prompt: '按@音频1动起来',
  ratio: '16:9', resolution: '480p', duration: 5, audio: true, priceYuan: 1, refs });
function stores() {
  const root = tempDir();
  const result = { jobs: createJobStore(root), uploads: createUploadStore(root), works: createWorkStore(root) };
  const read = result.works.read;
  result.works.read = id => id === audioId ? audio : read(id);
  return result;
}
const done = (jobs, id) => () => ['succeeded', 'failed', 'uncertain'].includes(jobs.read(id).status);

test('队列把声音原字节单列且不走TOS，图视频声音分组后的被拦序号映回原顺序', async () => {
  const s = stores();
  const image = s.uploads.save(solidPng(4, 4, [1, 2, 3]));
  const video = s.uploads.save(readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url)));
  let request, uploaded = 0;
  const queue = createVideoQueue({ ...s, spend: {}, uploadVideo: async asset => {
    uploaded++;
    assert.equal(asset.kind, 'video');
    return 'https://fake/ref';
  }, client: { submit: async value => {
    request = value;
    return { ok: false, outcome: 'rejected', code: 'InputAudioSensitiveContentDetected', blocked: [1, 2, 3] };
  } } });
  const job = queue.submit(input([
    { type: 'work', id: audioId, kind: 'audio' },
    { type: 'upload', id: video.id, kind: 'video' },
    { type: 'upload', id: image.id, kind: 'image' }
  ]));
  await waitFor(done(s.jobs, job.id));
  assert.equal(request.images.length, 1);
  assert.equal(request.videos.length, 1);
  assert.deepEqual(request.audios, [audio]);
  assert.equal(request.refVideoSeconds, 2);
  assert.equal(request.prompt, '按@音频1动起来');
  assert.equal(uploaded, 1);
  assert.deepEqual(s.jobs.read(job.id).blocked, [3, 2, 1]);
});

test('只有声音的2.5队列不需要TOS且保留两个声音的顺序', async () => {
  const s = stores();
  let request;
  const queue = createVideoQueue({ ...s, spend: {}, client: { submit: async value => {
    request = value;
    return { ok: false, outcome: 'rejected', code: 'TEST', blocked: [2] };
  } } });
  const job = queue.submit(input(Array(2).fill({ type: 'work', id: audioId, kind: 'audio' })));
  await waitFor(done(s.jobs, job.id));
  assert.deepEqual(request.images, []);
  assert.deepEqual(request.videos, []);
  assert.deepEqual(request.audios, [audio, audio]);
  assert.deepEqual(s.jobs.read(job.id).blocked, [2]);
});

test('参考视频上传超时给慢网建议，普通上传失败保留原话，两者都不交单不记费', async () => {
  for (const code of ['TOS_UPLOAD_TIMEOUT', 'TOS_TRANSFER_FAILED']) {
    const s = stores();
    const video = s.uploads.save(readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url)));
    const queue = createVideoQueue({ ...s, spend: { add: () => assert.fail('不得记费') },
      uploadVideo: async () => { throw Object.assign(Error(code), { code }); },
      client: { submit: async () => assert.fail('不得交单') } });
    const job = queue.submit(input([{ type: 'upload', id: video.id, kind: 'video' }]));
    await waitFor(done(s.jobs, job.id));
    const saved = s.jobs.read(job.id);
    assert.equal(saved.submitStartedAt, undefined);
    if (code === 'TOS_UPLOAD_TIMEOUT') {
      assert.equal(saved.errorCode, code);
      assert.match(saved.error, /上传太慢超时.*没发出去.*没花钱.*截短.*压小/);
      assert.doesNotMatch(saved.error, /TOS_UPLOAD_TIMEOUT/);
    } else assert.equal(saved.error, '参考素材读取或上传失败，这单没发出去，没花钱。');
  }
});
