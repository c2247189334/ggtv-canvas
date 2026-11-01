import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { checkRewriteInput, createRewrite, fakeRewrite } from './rewrite.mjs';
import { rewriteRoutes } from './routes/rewrite.mjs';
import { createRouter, HttpError } from './http.mjs';

const MODEL = 'doubao-seed-2-1-pro-260915';
const env = { ARK_API_KEY: 'private-ark', TOS_ACCESS_KEY_ID: 'private-tos-id', TOS_SECRET_ACCESS_KEY: 'private-tos-secret', DEPTH_API_KEY: 'private-depth' };
const input = { prompt: ' 一只猫 ', kind: 'image' };
const reply = (extra = {}) => ({ choices: [{ message: { content: '```text\n“画一只猫。”\n```' } }], usage: { prompt_tokens: 1000, completion_tokens: 500 }, ...extra });
const response = (payload, status = 200) => new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status });

test('改写用2.1 Pro（10-25换）、关闭thinking、只发送text，image沿用旧total0提示并清掉围栏引号', async () => {
  let calls = 0;
  const rewrite = createRewrite({ env: { ...env, ARK_VISION_MODEL: 'unpriced-model', ARK_BASE_URL: 'https://fake.invalid/v3/' }, fetch: async (url, options) => {
    calls++;
    assert.equal(url, 'https://fake.invalid/v3/chat/completions');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer private-ark');
    const body = JSON.parse(options.body);
    assert.equal(body.model, MODEL);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].role, 'user');
    const content = body.messages[0].content;
    assert.equal(content.length, 1);
    assert.equal(content[0].type, 'text');
    assert.ok(content[0].text.startsWith('你的任务：把用户随手写的需求，整理成一句清楚、能直接交给出图模型的中文指令。\n\n【图片情况】用户没传图，这是从零生成一张新图。'));
    assert.match(content[0].text, /1\. 先定位，再说改动/);
    assert.match(content[0].text, /6\. 保留清单要单独写成一句/);
    assert.match(content[0].text, /7\. 用户写的 @图片N、@视频N、@音频N 编号必须原样保留/);
    assert.match(content[0].text, /8\. 只输出这一句指令本身：不要引号、不要代码围栏、不要解释、不要前言后语。\n\n---\n\n一只猫$/);
    return response(reply());
  } });
  assert.deepEqual(await rewrite(input), { text: '画一只猫。', model: MODEL, usage: { input_tokens: 1000, output_tokens: 500 }, yuan: 0.021 });
  assert.equal(calls, 1);
});

test('video最小适配中文提示，明确保留@图片/@视频/@音频编号，返回文字不重新编号', async () => {
  const prompt = '让@图片3按@视频2的动作跟着@音频1动起来';
  const rewrite = createRewrite({ env, fetch: async (_url, options) => {
    const text = JSON.parse(options.body).messages[0].content[0].text;
    assert.match(text, /视频模型的中文指令/);
    assert.match(text, /@图片.*@视频.*@音频.*编号.*原样/);
    assert.ok(text.endsWith(`\n\n---\n\n${prompt}`));
    return response(reply({ choices: [{ message: { content: prompt } }] }));
  } });
  assert.equal((await rewrite({ prompt, kind: 'video' })).text, prompt);
});

test('上游JSON/非JSON拒绝保留原话，网络故障说中文且日志脱敏，不重发', async () => {
  const message = Object.values(env).join(' ') + ' rejected exactly';
  for (const mode of ['json', 'text', 'network']) {
    let calls = 0;
    const logs = [];
    const rewrite = createRewrite({ env, logError: (tag, error) => logs.push(error.message), fetch: async () => {
      calls++;
      if (mode === 'network') throw Error(message);
      return response(mode === 'json' ? { error: { message } } : message, 429);
    } });
    await assert.rejects(rewrite(input), error => {
      assert.equal(error.message, mode === 'network' ? '这台电脑连不上火山，检查一下网络。' : '*** *** *** *** rejected exactly');
      return true;
    });
    if (mode === 'network') {
      assert.equal(logs.length, 1);
      assert.match(logs[0], /\*\*\* \*\*\* \*\*\* \*\*\* rejected exactly/);
      assert.ok(Object.values(env).every(value => !logs[0].includes(value)));
    }
    assert.equal(calls, 1);
  }
});

test('非法输入与缺Key在发送前拒绝，空回复和无效usage不伪造成功成本', async () => {
  let calls = 0;
  const fetch = async () => { calls++; return response(reply()); };
  for (const value of [null, {}, { ...input, prompt: ' ' }, { ...input, prompt: '字'.repeat(4001) }, { ...input, kind: 'audio' }]) {
    await assert.rejects(createRewrite({ env, fetch })(value));
  }
  await assert.rejects(createRewrite({ env: {}, fetch })(input), /ARK_KEY_MISSING/);
  assert.equal(calls, 0);
  for (const payload of [reply({ choices: [] }), reply({ choices: [{ message: { content: '```\n```' } }] }),
    reply({ usage: undefined }), reply({ usage: { prompt_tokens: -1, completion_tokens: 0 } }),
    reply({ usage: { prompt_tokens: '1', completion_tokens: 0 } })]) {
    await assert.rejects(createRewrite({ env, fetch: async () => response(payload) })(input), /内容|用量/);
  }
});

test('fake改写形状一致、成本0、保留编号，假失败直接抛原话', async () => {
  const prompt = '@图片1按@视频2和@音频3的节奏';
  assert.deepEqual(await fakeRewrite({ prompt, kind: 'video' }), { text: `（假改写）${prompt}`, model: MODEL, usage: { input_tokens: 0, output_tokens: 0 }, yuan: 0 });
  await assert.rejects(async () => fakeRewrite({ ...input, prompt: '假失败' }), /假改写：按提示词拒绝这单。/);
});

function route(deps = {}) {
  const router = createRouter();
  const rows = [];
  rewriteRoutes(router, { readEnv: () => env, fake: false, rewrite: async () => ({ text: '改好了', model: MODEL, usage: { input_tokens: 1000, output_tokens: 500 }, yuan: 0.021 }),
    spend: { add: row => rows.push(row) }, ...deps });
  const handler = router.find('POST', '/api/rewrite');
  return { rows, async call(body = input) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.headers = { 'content-type': 'application/json' };
    let payload;
    await handler({ req, res: { writeHead: status => assert.equal(status, 200), end: text => { payload = JSON.parse(text); } } });
    return payload;
  } };
}
test('路由成功才按实际yuan记账，参考数量传给改写且不传未知字段', async () => {
  let seen;
  const expected = { text: '@音频2改好了', model: MODEL, usage: { input_tokens: 1, output_tokens: 2 }, yuan: 0.0000352 };
  const r = route({ rewrite: async value => { seen = value; return expected; } });
  const refs = { images: 2, videos: 1, audios: 1 };
  assert.deepEqual(await r.call({ ...input, refs, model: 'ignored' }), expected);
  assert.deepEqual(seen, { prompt: '一只猫', kind: 'image', refs });
  assert.deepEqual(r.rows, [{ yuan: expected.yuan, model: MODEL }]);
});

test('图片改写说明已连接参考图但没发图不能猜，图片视频音频引用均原样保留', async () => {
  const rewrite = createRewrite({ env, fetch: async (_url, options) => {
    const text = JSON.parse(options.body).messages[0].content[0].text;
    assert.match(text, /已连入 2 张参考图.*@图片1.*@图片2/);
    assert.match(text, /没有向你发送.*文件.*不许猜/);
    assert.doesNotMatch(text, /用户没传图/);
    assert.match(text, /@图片N、@视频N、@音频N.*原样保留/);
    return response(reply());
  } });
  await rewrite({ ...input, refs: { images: 2, videos: 1, audios: 1 } });
});
test('参考数量默认0，拒绝非整数、负数和错误结构，不发上游', async () => {
  assert.deepEqual(checkRewriteInput(input).refs, { images: 0, videos: 0, audios: 0 });
  let calls = 0;
  for (const refs of [[], null, { images: -1 }, { videos: 1.1 }, { audios: '1' }]) {
    const rewrite = createRewrite({ env, fetch: async () => { calls++; return response(reply()); } });
    await assert.rejects(rewrite({ ...input, refs }), /参考数量/);
  }
  assert.equal(calls, 0);
});
test('路由输入和Key预检失败不调用改写、不记账；fake无需Key', async () => {
  let calls = 0;
  const rewrite = async value => { calls++; return fakeRewrite(value); };
  for (const body of [{ ...input, prompt: '' }, { ...input, kind: 'audio' }, { ...input, prompt: '字'.repeat(4001) }, null]) {
    const r = route({ rewrite });
    await assert.rejects(r.call(body), error => error instanceof HttpError && error.status === 400);
    assert.equal(r.rows.length, 0);
  }
  const noKey = route({ readEnv: () => ({}), rewrite });
  await assert.rejects(noKey.call(), error => error instanceof HttpError && error.status === 400 && /ARK_API_KEY/.test(error.message));
  assert.equal(calls, 0);
  const fake = route({ readEnv: () => ({}), fake: true, rewrite });
  assert.equal((await fake.call()).yuan, 0);
  assert.equal(calls, 1);
});
test('路由失败HttpError502保留原话并脱敏、只调一次且不记账', async () => {
  let calls = 0;
  const r = route({ rewrite: async () => { calls++; throw Error(Object.values(env).join(' ') + ' 原因原话。'); } });
  await assert.rejects(r.call(), error => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 502);
    assert.equal(error.message, '*** *** *** *** 原因原话。');
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(r.rows, []);
});

test('文字改写路由串起真实客户端日志：用户看中文，技术原文只进脱敏日志，不记账', async () => {
  const logs = []; let calls = 0;
  const rewrite = createRewrite({ env, logError: (label, error) => logs.push(error.message), fetch: async () => {
    calls++;
    throw Object.assign(Error('REAL_DNS_PIPE_MISSING ' + env.ARK_API_KEY), { notSent: true });
  } });
  const r = route({ rewrite });
  await assert.rejects(r.call(), error => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 502);
    assert.match(error.message, /假地址.*Clash Verge.*这次没发出去，没花钱/);
    assert.doesNotMatch(error.message, /REAL_DNS_PIPE_MISSING|private-ark/);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /REAL_DNS_PIPE_MISSING \*\*\*/);
  assert.doesNotMatch(logs[0], /private-ark/);
  assert.deepEqual(r.rows, []);
});
