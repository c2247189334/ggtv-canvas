import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSeedanceBody, createSeedance } from './seedance.mjs';

const env = { ARK_API_KEY: 'fake-private-key', TOS_SECRET_ACCESS_KEY: 'fake-tos-secret' };
const input = { model: 'model', prompt: '动起来', mode: 'reference', ratio: '16:9', resolution: '480p', duration: 5, audio: true };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const client = (fetch) => createSeedance({ env, fetch });

test('改写reference放在请求顶层，不带时请求逐字不变', () => {
  const plain = { model: input.model, content: [{ type: 'text', text: input.prompt }], ratio: input.ratio,
    resolution: input.resolution, duration: input.duration, generate_audio: true, watermark: false };
  assert.equal(JSON.stringify(buildSeedanceBody(input)), JSON.stringify(plain));
  const rewrite = { ...input, model: 'doubao-seedance-2-5-260628', taskType: 'reference' };
  assert.deepEqual(buildSeedanceBody(rewrite), { ...plain, model: rewrite.model, omni_reference_task_type: 'reference' });
  assert.throws(() => buildSeedanceBody({ ...input, taskType: 'reference' }), /2.5/);
  assert.throws(() => buildSeedanceBody({ ...rewrite, taskType: 'edit' }), /任务类型/);
});

test('请求体文字、图、视频顺序固定，asset图不读buffer，首帧role正确', () => {
  const body = buildSeedanceBody({ ...input, images: [{ buffer: Buffer.from('abc'), contentType: 'image/PNG' },
    { asset: 'face-1', get buffer() { throw Error('不该读'); } }], videos: [{ url: 'https://example.test/ref.mp4' }] });
  assert.deepEqual(body.content, [{ type: 'text', text: '动起来' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' }, role: 'reference_image' },
    { type: 'image_url', image_url: { url: 'asset://face-1' }, role: 'reference_image' },
    { type: 'video_url', video_url: { url: 'https://example.test/ref.mp4' }, role: 'reference_video' }]);
  assert.equal(body.generate_audio, true);
  assert.equal(body.watermark, false);
  assert.equal(buildSeedanceBody({ ...input, mode: 'first_frame', images: [{ asset: 'face' }] }).content[1].role, 'first_frame');
});

test('建任务只发送一次，合法任务号才算成功', async () => {
  let calls = 0;
  const c = client(async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer fake-private-key');
    return response({ id: 'task-123' });
  });
  assert.deepEqual(await c.submit(input), { ok: true, taskId: 'task-123' });
  assert.equal(calls, 1);
  assert.equal((await client(async () => response({ id: '../bad' })).submit(input)).outcome, 'uncertain');
});

test('建任务等 10 分钟（10-26 真测本机上传约 45KB/秒，8MB 请求 60 秒传不完被掐断），查询和下片照旧 60 秒', async () => {
  const waits = {};
  const c = client(async (url, options) => {
    if (options.method === 'POST') { waits.submit = options.timeout; return response({ id: 'task-123' }); }
    if (url.includes('/tasks/')) { waits.query = options.timeout; return response({ status: 'running' }); }
    waits.download = options.timeout; return new Response(Buffer.from('0000ftypmp42'));
  });
  await c.submit(input); await c.query('task-123'); await c.download('https://example.test/v.mp4');
  assert.deepEqual(waits, { submit: 600000, query: 60000, download: 60000 });
});

test('400拒收带回所有参考序号、真人说明、没扣钱且脱敏', async () => {
  const c = client(async () => response({ error: { code: 'InputImageSensitiveContentDetected.PrivacyInformation',
    message: 'content[1] and content[3] fake-private-key fake-tos-secret' } }, 400));
  const result = await c.submit(input);
  assert.equal(result.outcome, 'rejected');
  assert.deepEqual(result.blocked, [1, 3]);
  assert.match(result.message, /参考 1、参考 3/);
  assert.match(result.message, /真人素材编号/);
  assert.match(result.message, /没建任务，没扣钱/);
  assert.doesNotMatch(JSON.stringify(result), /fake-private-key|fake-tos-secret/);
});

test('普通审核、普通400、5xx、notSent、提交断开分类明确', async () => {
  const sensitive = await client(async () => response({ error: { code: 'InputVideoSensitiveContentDetected', message: 'content[2]' } }, 400)).submit(input);
  assert.match(sensitive.message, /内容没过火山审核/);
  for (const [status, outcome] of [[400, 'rejected'], [500, 'uncertain']]) {
    const result = await client(async () => response({ error: { message: '拒绝' } }, status)).submit(input);
    assert.equal(result.outcome, outcome);
    assert.match(result.message, status === 400 ? /没扣钱/ : /可能已建任务并扣费/);
  }
  for (const notSent of [true, false]) {
    const result = await client(async () => { throw Object.assign(Error(env.ARK_API_KEY), { notSent }); }).submit(input);
    assert.equal(result.outcome, notSent ? 'notSent' : 'uncertain');
    assert.doesNotMatch(JSON.stringify(result), /fake-private-key/);
  }
});

test('缺Key和大于64MB的请求绝不发送，也不暴露密钥', async () => {
  let calls = 0;
  const fetch = async () => { calls += 1; throw Error('不能发送'); };
  const missing = await createSeedance({ env: {}, fetch }).submit(input);
  assert.equal(missing.outcome, 'notSent');
  await assert.rejects(client(fetch).submit({ ...input, images: [{ buffer: Buffer.alloc(49 * 1024 * 1024) }] }), /SEEDANCE_BODY_TOO_LARGE/);
  assert.equal(calls, 0);
});

test('查询返回状态、地址、token和脱敏错误；下片认ftyp，拒绝坏文件', async () => {
  const c = client(async (url) => url.endsWith('/task-1') ? response({ status: 'failed', error: { code: 'failed', message: env.ARK_API_KEY },
    content: { video_url: 'https://example.test/out.mp4' }, usage: { completion_tokens: 50220 } }) : new Response(readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url))));
  const result = await c.query('task-1');
  assert.equal(result.status, 'failed');
  assert.equal(result.usage.completion_tokens, 50220);
  assert.doesNotMatch(JSON.stringify(result), /fake-private-key/);
  assert.equal((await c.download('https://example.test/out.mp4')).subarray(4, 8).toString(), 'ftyp');
  await assert.rejects(client(async () => new Response('bad')).download('https://example.test/bad'), /SEEDANCE_DOWNLOAD_INVALID/);
  await assert.rejects(client(async () => { throw Error(env.ARK_API_KEY); }).query('task-1'), /SEEDANCE_QUERY_FAILED/);
});

test('任何查询字段不能夹带凭据；长视频地址原样保留', async () => {
  const url = `https://example.test/video?signature=${'a'.repeat(1200)}`;
  const result = await client(async () => response({ status: 'succeeded', content: { video_url: url },
    usage: { completion_tokens: env.ARK_API_KEY }, updated_at: env.TOS_SECRET_ACCESS_KEY,
    created_at: { nested: env.ARK_API_KEY } })).query('task-1');
  assert.equal(result.content.video_url, url);
  assert.equal(result.usage.completion_tokens, undefined);
  assert.doesNotMatch(JSON.stringify(result), /fake-private-key|fake-tos-secret/);
});

test('所有被点名的下标都保留，包括长错误末尾；视频不能是base64', async () => {
  const result = await client(async () => response({ error: { message: `content[1] ${'x'.repeat(1500)} content[3]` } }, 400)).submit(input);
  assert.deepEqual(result.blocked, [1, 3]);
  assert.throws(() => buildSeedanceBody({ ...input, videos: [{ url: 'data:video/mp4;base64,YWJj' }] }), /SEEDANCE_VIDEO_URL_INVALID/);
});

test('查询保留完成时间给排队判断24小时，时间字段同样脱敏', async () => {
  const result = await client(async () => response({ status: 'succeeded', updated_at: 100,
    finished_at: '2026-10-22T12:00:00Z', completed_at: env.TOS_SECRET_ACCESS_KEY })).query('task-1');
  assert.equal(result.updated_at, 100);
  assert.equal(result.finished_at, '2026-10-22T12:00:00Z');
  assert.equal(result.completed_at, '***');
});

test('声音放图和视频之后，用原MIME的base64和reference_audio，提示词不改', () => {
  const prompt = '按@音频1的节奏动起来';
  const body = buildSeedanceBody({ ...input, prompt, images: [{ asset: 'face' }], videos: [{ url: 'https://example.test/ref.mp4' }],
    audios: [{ contentType: 'audio/wav', buffer: Buffer.from('wav') }, { contentType: 'audio/mpeg', buffer: Buffer.from('mp3') }] });
  assert.deepEqual(body.content.map(item => item.type), ['text', 'image_url', 'video_url', 'audio_url', 'audio_url']);
  assert.equal(body.content[0].text, prompt);
  assert.deepEqual(body.content.slice(3), [
    { type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,d2F2' }, role: 'reference_audio' },
    { type: 'audio_url', audio_url: { url: 'data:audio/mpeg;base64,bXAz' }, role: 'reference_audio' }
  ]);
});

test('声音仍受64MB请求体限制，超限一次也不发送', async () => {
  let calls = 0;
  await assert.rejects(client(async () => { calls++; return response({ id: 'task-1' }); }).submit({ ...input,
    audios: [{ contentType: 'audio/wav', buffer: Buffer.alloc(49 * 1024 * 1024) }] }), /SEEDANCE_BODY_TOO_LARGE/);
  assert.equal(calls, 0);
});
