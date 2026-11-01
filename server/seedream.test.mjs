import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeedreamBody, generateOne, seedreamConfig, seedreamSize } from './seedream.mjs';

const FLASH = 'doubao-seedream-5-0-flash-260915';
const LITE = 'doubao-seedream-5-0-lite-260128';
const env = { ARK_API_KEY: 'test-key-123' };
const request = { model: FLASH, prompt: '一只猫', images: [], size: '1024x1024' };

function fakeFetch(handler) {
  const calls = [];
  const doFetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  doFetch.calls = calls;
  return doFetch;
}

test('Key 没填就报 ARK_KEY_MISSING', () => {
  assert.throws(() => seedreamConfig({}), /ARK_KEY_MISSING/);
  assert.throws(() => seedreamConfig({ ARK_API_KEY: '请填写' }), /ARK_KEY_MISSING/);
  assert.equal(seedreamConfig(env).base, 'https://ark.cn-beijing.volces.com/api/v3');
  assert.equal(seedreamConfig({ ...env, ARK_BASE_URL:'请填可选地址' }).base,'https://ark.cn-beijing.volces.com/api/v3');
});

test('flash：1024x1024 在区间里原样不动', () => {
  assert.equal(seedreamSize(FLASH, '1024x1024'), '1024x1024');
});

test('lite：1024x1024 太小，按比例放大到刚够下限（1920x1920）', () => {
  assert.equal(seedreamSize(LITE, '1024x1024'), '1920x1920');
});

test('不是「宽x高」的写法交给火山用默认', () => {
  assert.equal(seedreamSize(FLASH, '2K'), undefined);
  assert.equal(seedreamSize(FLASH, null), undefined);
});

test('请求体：一张图是字符串、多张是数组、没图不带 image；不要水印、要 base64', () => {
  const one = { buffer: Buffer.from('a'), contentType: 'image/png' };
  assert.equal(typeof buildSeedreamBody({ model: FLASH, prompt: 'x', images: [one] }).image, 'string');
  assert.equal(buildSeedreamBody({ model: FLASH, prompt: 'x', images: [one, one] }).image.length, 2);
  const none = buildSeedreamBody({ model: FLASH, prompt: 'x', images: [], size: '1024x1024' });
  assert.equal('image' in none, false);
  assert.equal(none.watermark, false);
  assert.equal(none.response_format, 'b64_json');
  assert.equal(none.output_format, 'jpeg');
  assert.equal(none.size, '1024x1024');
});

test('出好一张：交回中性 image 字段，请求发到火山、带上 Key', async () => {
  const png = Buffer.from('fake-png');
  const doFetch = fakeFetch(() => new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 }));
  const r = await generateOne(request, { env, fetch: doFetch });
  assert.equal(r.ok, true);
  assert.deepEqual(r.image, png);
  assert.equal(doFetch.calls[0].url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
  assert.equal(doFetch.calls[0].init.headers.Authorization, 'Bearer test-key-123');
});

test('火山拒了：带回状态码和火山给的原因', async () => {
  const doFetch = fakeFetch(() => new Response(JSON.stringify({ error: { message: '内容不合规' } }), { status: 400 }));
  const r = await generateOne(request, { env, fetch: doFetch });
  assert.deepEqual(r, { ok: false, status: 400, message: '内容不合规' });
});

test('火山回了话但没给图', async () => {
  const doFetch = fakeFetch(() => new Response(JSON.stringify({ data: [] }), { status: 200 }));
  const r = await generateOne(request, { env, fetch: doFetch });
  assert.equal(r.ok, false);
  assert.match(r.message, /没给图/);
});

test('等超时抛 EDIT_TIMEOUT', async () => {
  const doFetch = fakeFetch(() => {
    throw Object.assign(new Error('t'), { name: 'TimeoutError' });
  });
  await assert.rejects(generateOne(request, { env, fetch: doFetch }), /EDIT_TIMEOUT/);
});

test('连不上抛 EDIT_UNREACHABLE，黑窗口里的话把 Key 打码', async () => {
  const logs = [];
  const doFetch = fakeFetch(() => {
    throw new Error('connect failed test-key-123');
  });
  await assert.rejects(generateOne(request, { env, fetch: doFetch, log: (m) => logs.push(m) }), /EDIT_UNREACHABLE/);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /test-key-123/);
});
