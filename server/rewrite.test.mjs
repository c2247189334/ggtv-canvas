import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { checkRewriteInput, createRewrite, fakeRewrite } from './rewrite.mjs';
import { rewriteRoutes } from './routes/rewrite.mjs';
import { createRouter, HttpError } from './http.mjs';

// 11-15 用户定：帮我改写不再用豆包，交给本机 agent（Claude / Codex），只发文字、花费记 0。
const MODEL = 'sonnet';
const env = { ARK_API_KEY: 'private-ark', TOS_ACCESS_KEY_ID: 'private-tos-id', TOS_SECRET_ACCESS_KEY: 'private-tos-secret', DEPTH_API_KEY: 'private-depth' };
const input = { prompt: ' 一只猫 ', kind: 'image' };
const agentReply = (text = '```text\n“画一只猫。”\n```') => ({ text, model: 'claude-sonnet-x', elapsedMs: 5, usage: { input_tokens: 1000, output_tokens: 500 } });
const agent = (check = () => {}, text) => { const calls = []; const call = async options => { calls.push(options); check(options); return agentReply(text); }; return { call, calls }; };

test('改写交给本机 agent：规则放系统要求、原话放提问、不带文件，image沿用旧total0提示并清掉围栏引号，花费0', async () => {
  const { call, calls } = agent(options => {
    assert.ok(options.system.startsWith('你的任务：把用户随手写的需求，整理成一句清楚、能直接交给出图模型的中文指令。\n\n【图片情况】用户没传图，这是从零生成一张新图。'));
    assert.match(options.system, /1\. 先定位，再说改动/);
    assert.match(options.system, /6\. 保留清单要单独写成一句/);
    assert.match(options.system, /7\. 用户写的 @图片N、@视频N、@音频N 编号必须原样保留/);
    assert.match(options.system, /8\. 只输出这一句指令本身：不要引号、不要代码围栏、不要解释、不要前言后语。/);
    assert.doesNotMatch(options.system, /一只猫/);
    assert.equal(options.prompt, '一只猫');
    assert.equal(options.files, undefined);
    assert.equal(options.model, MODEL);
  });
  assert.deepEqual(await createRewrite({ call, model: MODEL })(input),
    { text: '画一只猫。', model: 'claude-sonnet-x', usage: { input_tokens: 1000, output_tokens: 500 }, yuan: 0 });
  assert.equal(calls.length, 1);
});

test('video最小适配中文提示，明确保留@图片/@视频/@音频编号，返回文字不重新编号', async () => {
  const prompt = '让@图片3按@视频2的动作跟着@音频1动起来';
  const { call } = agent(options => {
    assert.match(options.system, /视频模型的中文指令/);
    assert.match(options.system, /@图片.*@视频.*@音频.*编号.*原样/);
    assert.equal(options.prompt, prompt);
  }, prompt);
  assert.equal((await createRewrite({ call, model: MODEL })({ prompt, kind: 'video' })).text, prompt);
});

test('非法输入在调用前拒绝；agent 回了空内容不伪造成功；agent 报错原样往上抛、只调一次', async () => {
  const { call, calls } = agent();
  for (const value of [null, {}, { ...input, prompt: ' ' }, { ...input, prompt: '字'.repeat(4001) }, { ...input, kind: 'audio' }]) {
    await assert.rejects(createRewrite({ call, model: MODEL })(value));
  }
  assert.equal(calls.length, 0);
  for (const text of ['', '```\n```']) await assert.rejects(createRewrite({ call: agent(() => {}, text).call, model: MODEL })(input), /没有返回内容/);
  let count = 0;
  await assert.rejects(createRewrite({ call: async () => { count++; throw Error('Claude 没登录或登录过期'); }, model: MODEL })(input), /没登录/);
  assert.equal(count, 1);
});

test('fake改写形状一致、成本0、保留编号，假失败直接抛原话', async () => {
  const prompt = '@图片1按@视频2和@音频3的节奏';
  assert.deepEqual(await fakeRewrite({ prompt, kind: 'video' }), { text: `（假改写）${prompt}`, model: 'fake', usage: { input_tokens: 0, output_tokens: 0 }, yuan: 0 });
  await assert.rejects(async () => fakeRewrite({ ...input, prompt: '假失败' }), /假改写：按提示词拒绝这单。/);
});

function route(deps = {}) {
  const router = createRouter();
  const rows = [];
  rewriteRoutes(router, { readEnv: () => env, fake: false, needAgent: () => null, rewrite: async () => ({ text: '改好了', model: MODEL, usage: { input_tokens: 1000, output_tokens: 500 }, yuan: 0 }),
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
  const { call, calls } = agent(({ system: text }) => {
    assert.match(text, /已连入 2 张参考图.*@图片1.*@图片2/);
    assert.match(text, /没有向你发送.*文件.*不许猜/);
    assert.doesNotMatch(text, /用户没传图/);
    assert.match(text, /@图片N、@视频N、@音频N.*原样保留/);
  });
  await createRewrite({ call, model: MODEL })({ ...input, refs: { images: 2, videos: 1, audios: 1 } });
  assert.equal(calls.length, 1);
});
test('参考数量默认0，拒绝非整数、负数和错误结构，不发上游', async () => {
  assert.deepEqual(checkRewriteInput(input).refs, { images: 0, videos: 0, audios: 0 });
  const { call, calls } = agent();
  for (const refs of [[], null, { images: -1 }, { videos: 1.1 }, { audios: '1' }]) {
    await assert.rejects(createRewrite({ call, model: MODEL })({ ...input, refs }), /参考数量/);
  }
  assert.equal(calls.length, 0);
});
test('路由输入和本机 agent 预检失败不调用改写、不记账；fake 不查 agent', async () => {
  let calls = 0;
  const rewrite = async value => { calls++; return fakeRewrite(value); };
  for (const body of [{ ...input, prompt: '' }, { ...input, kind: 'audio' }, { ...input, prompt: '字'.repeat(4001) }, null]) {
    const r = route({ rewrite });
    await assert.rejects(r.call(body), error => error instanceof HttpError && error.status === 400);
    assert.equal(r.rows.length, 0);
  }
  const noAgent = route({ readEnv: () => ({}), needAgent: () => '这一步要用你电脑上的 Claude 或 Codex，现在用不了。本机 Claude 没配好：装 Claude Code。', rewrite });
  await assert.rejects(noAgent.call(), error => error instanceof HttpError && error.status === 400 && /本机 Claude 没配好/.test(error.message));
  assert.equal(noAgent.rows.length, 0); assert.equal(calls, 0);
  const fake = route({ readEnv: () => ({}), fake: true, needAgent: () => '不该查', rewrite });
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
