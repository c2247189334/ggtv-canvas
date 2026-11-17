import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLayerBody, layerPrompt, readLayerReply, splitLayers } from './layerSplit.mjs';
import { solidPng } from './png.mjs';

const KEY = 'sk-test-secret-key';
const env = { ARK_API_KEY: KEY };
const image = { buffer: solidPng(4, 4, [1, 2, 3]), contentType: 'image/png' };

// 照 11-16 真测回话的样子（字段名、z_index、bounding_box.absolute、usage.generated_images）。
const REPLY = {
  model: 'doubao-seedream-5-0-flash-260915', created: 1,
  data: [
    { url: 'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/l2.png', size: '603x678', output_format: 'png', z_index: 2,
      name: '灰色长条标签', description: '…', bounding_box: { absolute: [428, 488, 579, 658], normalized: [334, 381, 452, 514] } },
    { url: 'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/base.png', size: '1280x1280', output_format: 'png', z_index: 0 },
    { url: 'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/l1.png', size: '654x537', output_format: 'png', z_index: 1,
      name: '黑色勾形品牌标志', description: '…', bounding_box: { absolute: [540, 583, 703, 717], normalized: [422, 455, 549, 560] } }
  ],
  usage: { input_images: 1, generated_images: 3, output_tokens: 14592, total_tokens: 14592 }
};

function fakeFetch({ status = 200, body = REPLY, downloadStatus = 200, throwOnPost } = {}) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'POST') {
      if (throwOnPost) throw throwOnPost;
      return new Response(JSON.stringify(body), { status });
    }
    return new Response(Buffer.from(`file:${url.split('/').pop()}`), { status: downloadStatus });
  };
  return { fetch, calls };
}

test('提示词：框在前、文字在后；都没有是空串（自动拆）', () => {
  assert.equal(layerPrompt('', []), '');
  assert.equal(layerPrompt('  拆出勾  ', []), '拆出勾');
  assert.equal(layerPrompt('', [[1, 2, 3, 4]]), '将图片进行精确图层分离，需分离的区域坐标为<bbox>1 2 3 4</bbox>');
  assert.equal(layerPrompt('拆出勾', [[1, 2, 3, 4], [5, 6, 7, 8]]),
    '将图片进行精确图层分离，需分离的区域坐标为<bbox>1 2 3 4</bbox>、<bbox>5 6 7 8</bbox>。拆出勾');
});

test('请求体：Flash + layer_decomposition + 要链接 + PNG；没提示词就不带 prompt', () => {
  const body = buildLayerBody({ image, prompt: '' });
  assert.equal(body.model, 'doubao-seedream-5-0-flash-260915');
  assert.equal(body.layer_decomposition, true);
  assert.equal(body.response_format, 'url');
  assert.equal(body.output_format, 'png');
  assert.equal(body.watermark, false);
  assert.equal('prompt' in body, false);
  assert.match(body.image, /^data:image\/png;base64,/);
  assert.equal(buildLayerBody({ image, prompt: '拆出勾' }).prompt, '拆出勾');
});

test('读回话：底图按 z_index 0 找，图层按 z_index 排，收费张数看 usage', () => {
  const reply = readLayerReply(REPLY);
  assert.equal(reply.count, 3);
  assert.deepEqual(reply.base, { url: REPLY.data[1].url, width: 1280, height: 1280 });
  assert.deepEqual(reply.layers.map(layer => [layer.name, layer.box]), [
    ['黑色勾形品牌标志', [540, 583, 703, 717]], ['灰色长条标签', [428, 488, 579, 658]]]);
  assert.equal(readLayerReply({ data: [REPLY.data[0]] }), null, '没有底图不认');
});

test('成功：发一次、下三张图，Key 只在请求头里', async () => {
  const { fetch, calls } = fakeFetch();
  const result = await splitLayers({ image, prompt: '拆出勾' }, { env, fetch, log: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
  assert.equal(result.base.width, 1280);
  assert.deepEqual(result.base.buffer, Buffer.from('file:base.png'));
  assert.deepEqual(result.layers.map(layer => layer.buffer.toString()), ['file:l1.png', 'file:l2.png']);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test('火山拒收：不下载、没花钱、原因原话带回', async () => {
  const { fetch, calls } = fakeFetch({ status: 400, body: { error: { message: 'image too small' } } });
  const result = await splitLayers({ image, prompt: '' }, { env, fetch, log: () => {} });
  assert.deepEqual(result, { ok: false, status: 400, message: 'image too small', charged: 0 });
  assert.equal(calls.length, 1);
});

test('拆好了但下载失败：试 3 次，报已扣费张数，不重发', async () => {
  const { fetch, calls } = fakeFetch({ downloadStatus: 500 });
  const result = await splitLayers({ image, prompt: '' }, { env, fetch, log: () => {} });
  assert.equal(result.ok, false);
  assert.equal(result.charged, 3);
  assert.match(result.message, /已经拆好并扣费（3 张）/);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(calls.filter(call => call.options.method !== 'POST').length, 3);
});

test('网络出错：没发出去 / 发出去后断，分开报；日志里 Key 打码', async () => {
  const logs = [];
  const notSent = Object.assign(new Error(`boom ${KEY}`), { notSent: true });
  await assert.rejects(splitLayers({ image }, { env, fetch: fakeFetch({ throwOnPost: notSent }).fetch, log: line => logs.push(line) }), /EDIT_UNREACHABLE/);
  await assert.rejects(splitLayers({ image }, { env, fetch: fakeFetch({ throwOnPost: new Error('reset') }).fetch, log: () => {} }), /EDIT_INTERRUPTED/);
  assert.equal(logs.join('').includes(KEY), false);
  await assert.rejects(splitLayers({ image }, { env: {}, fetch: fakeFetch().fetch }), /ARK_KEY_MISSING/);
});
