import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from './client.mjs';
import { REWRITE_MODEL } from '../rewrite.mjs';
import { rawPromptReply } from './responseFixture.mjs';
const env = { ARK_API_KEY: 'fake-video-rewrite-key', TOS_SECRET_ACCESS_KEY: 'fake-video-rewrite-secret' };
const usage = { prompt_tokens: 1000, completion_tokens: 500 };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('10-25截图重建：容错真换行并保留分行，说明文字和围栏不作废已付费回话', async () => {
  assert.throws(() => JSON.parse(rawPromptReply), SyntaxError);
  for (const content of [rawPromptReply, `下面是结果：\n\x60\x60\x60json\n${rawPromptReply}\n\x60\x60\x60\n以上是结果。`,
    '说明 {"value":"有{括号}和\\"引号\\"\r\n还有\t制表符","nested":{"ok":true}} 完毕']) {
    const charges = []; let calls = 0;
    const ask = createModel({ env, onCharge: row => charges.push(row), fetch: async () => {
      calls++; return response({ usage, choices: [{ message: { content } }] });
    } });
    const result = await ask({ text: '看图' });
    if (result.videoPrompt) {
      assert.equal(result.videoPrompt.split('\n').length, 9);
      assert.ok(result.videoPrompt.includes('\n5-6秒：'));
      assert.equal(result.imageDescriptions['@图片6'], '粉色缎面无袖短款旗袍，下摆有花朵刺绣');
    } else {
      assert.equal(result.value, '有{括号}和"引号"\r\n还有\t制表符');
      assert.deepEqual(result.nested, { ok: true });
    }
    assert.equal(calls, 1); assert.equal(charges.length, 1); assert.equal(charges[0].yuan, 0.021);
  }
});

test('截断、缺外括号、坏转义不补全；嵌套完整对象也不能冒充外层，仍记账不重发', async () => {
  for (const content of [rawPromptReply.slice(0, -1), '说明 {"nested":{"ok":true}',
    '{"videoPrompt":"没有结束', '{"videoPrompt":"坏\\q转义"}', '{"ok":true} {"other":false}', '[{"ok":true}']) {
    const charges = []; let calls = 0;
    const ask = createModel({ env, onCharge: row => charges.push(row), fetch: async () => {
      calls++; return response({ usage, choices: [{ message: { content } }] });
    } });
    await assert.rejects(ask({ text: '写词' }), /豆包回话不是合法JSON/);
    assert.equal(calls, 1); assert.equal(charges.length, 1); assert.equal(charges[0].yuan, 0.021);
  }
});

test('分析与第二步均可base64看图，用2.1 Pro开思考（10-25换）、按6/30元token费率，也支持纯文字调用', async () => {
  const charges = [], requests = [];
  const ask = createModel({ env, onCharge: row => charges.push(row), fetch: async (url, options) => {
    assert.ok(options.timeout >= 1800000, '官方深度思考文档：超时推荐30分钟及以上（10-25真测300秒被掐断）');
    requests.push(JSON.parse(options.body));
    return response({ usage, choices: [{ message: { content: '{"ok":true}' } }] });
  } });
  assert.deepEqual(await ask({ text: '看图', images: ['data:image/jpeg;base64,YQ=='] }), { ok: true });
  await ask({ text: '写词' });
  await ask({ text: '看用户图片写词', images: ['data:image/jpeg;base64,Yg=='] });
  assert.equal(charges.length, 3); assert.equal(charges[0].yuan, 0.021);
  assert.equal(charges[0].model, REWRITE_MODEL);
  assert.equal(requests[0].model, 'doubao-seed-2-1-pro-260915');
  assert.deepEqual(requests[0].thinking, { type: 'enabled' });
  assert.equal(requests[0].messages[0].content[1].image_url.url, 'data:image/jpeg;base64,YQ==');
  assert.equal(requests[1].messages[0].content.length, 1);
  assert.equal(requests[2].messages[0].content[1].image_url.url, 'data:image/jpeg;base64,Yg==');
  assert.deepEqual(requests[2].thinking, { type: 'enabled' });
});
test('HTTP失败、非法JSON、空回复都不重发；有效usage先记账，原话脱敏', async () => {
  for (const [payload, status, pattern] of [
    [{ usage, error: { message: '拒收 fake-video-rewrite-key fake-video-rewrite-secret' } }, 400, /拒收 \*\*\* \*\*\*/],
    [{ usage, choices: [{ message: { content: '不是JSON fake-video-rewrite-key' } }] }, 200, /不是JSON \*\*\*/],
    [{ usage, choices: [] }, 200, /没有返回内容/]
  ]) {
    let count = 0; const charges = [];
    const ask = createModel({ env, onCharge: row => charges.push(row), fetch: async () => { count++; return response(payload, status); } });
    await assert.rejects(ask({ text: 'test' }), pattern);
    assert.equal(count, 1); assert.equal(charges.length, 1); assert.equal(charges[0].yuan, 0.021);
  }
});
test('断线说中文且原话进脱敏日志，上游坏JSON仍脱敏，没usage不编造花费', async () => {
  for (const [fetch, pattern, logged] of [[async () => { throw Error('断线 fake-video-rewrite-key'); }, /这台电脑连不上火山.*检查一下网络/, true],
    [async () => new Response('坏JSON fake-video-rewrite-key'), /\*\*\*/, false]]) {
    const charges = []; let unknown = 0;
    const logs = [];
    await assert.rejects(createModel({ env, fetch, logError: (tag, error) => logs.push(error.message),
      onCharge: row => charges.push(row), onUnknown: () => { unknown++; } })({ text: 'test' }), pattern);
    assert.equal(logs.length, logged ? 1 : 0);
    if (logged) { assert.match(logs[0], /断线 \*\*\*/); assert.doesNotMatch(logs[0], /fake-video-rewrite-key/); }
    assert.deepEqual(charges, []);
    assert.equal(unknown, 1);
  }
});
test('缺usage不能声称零花费；超过12张图在请求前拒收', async () => {
  let calls = 0, unknown = 0;
  const ask = createModel({ env, onUnknown: () => { unknown++; }, fetch: async () => {
    calls++; return response({ choices: [{ message: { content: '{"ok":true}' } }] });
  } });
  await assert.rejects(ask({ text: 'test' }), /无法确认.*花费/);
  assert.equal(unknown, 1);
  await assert.rejects(ask({ text: 'test', images: Array(13).fill('data:image/jpeg;base64,YQ==') }), /最多12/);
  assert.equal(calls, 1); assert.equal(unknown, 1);
});

// 流式回包（SSE）：按 split 字节切块，故意把中文切在半个字上。
const sse = (events, split = 5, { close = true, onCancel } = {}) => {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join(''));
  return new Response(new ReadableStream({
    start(c) { for (let i = 0; i < bytes.length; i += split) c.enqueue(bytes.slice(i, i + split)); if (close) c.close(); },
    cancel() { onCancel?.(); }
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};
const chunk = (delta, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }], usage: null });

test('10-25真测：非流式开思考等满300秒被掐断 → 改流式，边想边回传；拼正文、思考不混进去、usage取末块记账', async () => {
  const charges = [], requests = [];
  const ask = createModel({ env, onCharge: row => charges.push(row), fetch: async (url, options) => {
    requests.push({ ...options, body: JSON.parse(options.body) });
    return sse([chunk({ reasoning_content: '先看吊扇' }), chunk({ content: '{"desc":"深棕色' }), chunk({ reasoning_content: '再核对' }),
      chunk({ content: '吊扇叶片"}' }), chunk({}, 'stop'), { choices: [], usage }, '[DONE]']);
  } });
  assert.deepEqual(await ask({ text: '看图', images: ['data:image/jpeg;base64,YQ=='] }), { desc: '深棕色吊扇叶片' });
  assert.equal(requests[0].body.stream, true);
  assert.deepEqual(requests[0].body.stream_options, { include_usage: true });
  assert.deepEqual(requests[0].body.thinking, { type: 'enabled' });
  assert.equal(charges.length, 1); assert.equal(charges[0].yuan, 0.021);
});

test('10-26 一轮版：调用方要求时给图片加清晰度、给请求加思考档位；不要求就不带', async () => {
  const requests = [];
  const ask = createModel({ env, fetch: async (url, options) => {
    requests.push(JSON.parse(options.body));
    return sse([chunk({ content: '{"ok":true}' }), chunk({}, 'stop'), { choices: [], usage }, '[DONE]']);
  } });
  await ask({ text: '拆解', images: ['data:image/jpeg;base64,YQ=='], detail: 'xhigh', effort: 'high' });
  await ask({ text: '写词', images: ['data:image/jpeg;base64,Yg=='] });
  assert.deepEqual(requests[0].messages[0].content[1].image_url, { url: 'data:image/jpeg;base64,YQ==', detail: 'xhigh' });
  assert.equal(requests[0].reasoning_effort, 'high');
  assert.deepEqual(requests[1].messages[0].content[1].image_url, { url: 'data:image/jpeg;base64,Yg==' });
  assert.ok(!Object.hasOwn(requests[1], 'reasoning_effort'));
});

test('看人物图这种简单问题可以关深度思考；不说就照旧开', async () => {
  const requests = [];
  const ask = createModel({ env, fetch: async (url, options) => {
    requests.push(JSON.parse(options.body));
    return sse([chunk({ content: '{"ok":true}' }), chunk({}, 'stop'), { choices: [], usage }, '[DONE]']);
  } });
  await ask({ text: '看人物图', images: ['data:image/jpeg;base64,YQ=='], think: false });
  await ask({ text: '拆解' });
  assert.deepEqual(requests[0].thinking, { type: 'disabled' });
  assert.deepEqual(requests[1].thinking, { type: 'enabled' });
});

test('流半路没动静：超过空闲上限就关连接停下，标费用待确认，不重发', async () => {
  let cancelled = 0, calls = 0, unknown = 0;
  const ask = createModel({ env, idleMs: 30, onUnknown: () => { unknown++; }, fetch: async () => {
    calls++; return sse([chunk({ reasoning_content: '想' })], 5, { close: false, onCancel: () => { cancelled++; } });
  } });
  await assert.rejects(ask({ text: '看图' }), /没有回传任何内容/);
  assert.equal(cancelled, 1); assert.equal(calls, 1); assert.equal(unknown, 1);
});

test('流没正常收尾、被截断、中途报错都算失败：有usage照记账，没有就标待确认，原话脱敏', async () => {
  for (const [events, pattern, charged] of [
    [[chunk({ content: '{"ok":' })], /中途断了/, false],
    [[chunk({ content: '{"ok":' }), chunk({}, 'length'), { choices: [], usage }, '[DONE]'], /太长被截断/, true],
    [[chunk({ content: '{"ok":true}' }), chunk({}, 'content_filter'), { choices: [], usage }, '[DONE]'], /审核/, true],
    [[{ error: { message: '服务繁忙 fake-video-rewrite-key' } }], /服务繁忙 \*\*\*/, false]
  ]) {
    const charges = []; let unknown = 0, calls = 0;
    const ask = createModel({ env, onCharge: row => charges.push(row), onUnknown: () => { unknown++; },
      fetch: async () => { calls++; return sse(events); } });
    await assert.rejects(ask({ text: '看图' }), pattern);
    assert.equal(calls, 1); assert.equal(charges.length, charged ? 1 : 0); assert.equal(unknown, charged ? 0 : 1);
  }
});

test('等满总上限被掐断时说人话，不再只给 The operation was aborted', async () => {
  let unknown = 0;
  const ask = createModel({ env, onUnknown: () => { unknown++; }, fetch: async () => {
    throw Object.assign(Error('The operation was aborted'), { name: 'AbortError' });
  } });
  await assert.rejects(ask({ text: '看图' }), /30 分钟还没答完/);
  assert.equal(unknown, 1);
});
