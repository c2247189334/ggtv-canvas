import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeRound } from '../videoRewrite/fake.mjs';
import { planFromReply } from '../videoRewrite/analyze.mjs';
import { setup } from '../videoRewrite/routeTestKit.mjs';
const analyzeBody = source => ({ cardId: 'rewrite-1', source, userText: '人和衣服都换成我的' });
const fakePlan = async duration => planFromReply(await fakeRound({ context: { duration } }), duration);
const materials = [{ tag: '@图片1', itemId: 'P1', purpose: '人物' },
  ...[1, 2, 3, 4].map(i => ({ tag: `@图片${i + 1}`, itemId: `C${i}`, purpose: `衣服${i}` })),
  { tag: '@视频1', purpose: '深度' }, { tag: '@音频1', purpose: '原声' }];

test('假模式拆解一轮 + 代码拼词：大图仅在分析内部使用，不保存上传图，成功清临时目录且花费0', async () => {
  const s = setup();
  assert.deepEqual((await s.call('GET', '/api/video-rewrite/estimates')).json, { analyzeYuan: 0.2, lookYuan: 0.03 });
  const body = analyzeBody(s.upload(15.05));
  const before = readdirSync(join(s.root, '上传')).sort();
  const result = await s.call('POST', '/api/video-rewrite/analyze', body);
  assert.equal(result.status, 200);
  const data = result.json;
  assert.equal(data.duration, 15.05); assert.equal(data.targetDuration, 15);
  assert.equal(data.ratio, '16:9'); assert.equal(data.hasAudio, true); assert.equal(data.yuan, 0);
  assert.match(data.plan.items.at(-1).desc, /吊扇叶/);
  assert.ok(!Object.hasOwn(data, 'first') && !Object.hasOwn(data, 'corrections'), '10-26 一轮版没有第一轮草稿和改正说明');
  assert.ok(data.plan.unsure.some(value => /吊扇叶/.test(value)));
  assert.equal(s.mediaCalls.length, 1, '分析内部拼大图');
  assert.deepEqual(s.frameCalls, [[1.3, 3.8, 6.3, 8.8, 11.3, 13.8]], '同一次问附 6 张清楚大帧');
  assert.deepEqual([s.mediaCalls[0].width, s.mediaCalls[0].height], [864, 480], '按真实宽高定帧宽');
  assert.deepEqual(readdirSync(join(s.root, '上传')).sort(), before);
  assert.equal(existsSync(join(s.root, '改写', 'rewrite-1')), false);
  const input = { cardId: 'rewrite-1', plan: data.plan, userText: '换人换衣', materials: s.images(materials), duration: data.duration, ratio: data.ratio };
  const written = await s.call('POST', '/api/video-rewrite/prompt', input);
  assert.equal(written.status, 200); assert.deepEqual(written.json.issues, []);
  assert.equal(Object.hasOwn(written.json, 'imageDescriptions'), false); assert.equal(written.json.yuan, 0);
  assert.deepEqual(written.json.warnings, ['拆解没把握：画面上方的东西是不是吊扇叶片', '拆解认出画面里还有吊扇叶片：提示词没写，交给背景图和深度视频；成片里少了或摆错，再自己补一句。']);
  const checked = await s.call('POST', '/api/video-rewrite/check', { ...input, changeSeconds: data.plan.changes.map(x => x.second), videoPrompt: written.json.videoPrompt + '修改' });
  assert.equal(checked.status, 200); assert.equal(checked.json.yuan, 0); assert.ok(checked.json.issues.some(x => x.includes('修改')));
  assert.equal(s.app.stores.spend.totalOn(), 0);
});

test('假路由分析到拼词：职责在前，按页面快照免费检查零问题，粘原描述后拦截', async () => {
  const s = setup();
  const analyzed = await s.call('POST', '/api/video-rewrite/analyze', analyzeBody(s.upload(15.05)));
  const { plan, duration, ratio } = analyzed.json;
  const pageMaterials = [{ tag: '@图片1', purpose: '背景' }, ...plan.replace.map((id, index) => {
    const item = plan.items.find(entry => entry.id === id);
    return { tag: `@图片${index + 2}`, itemId: id, purpose: item.kind, originalDesc: item.desc };
  }), { tag: '@视频1', purpose: '深度' }, { tag: '@音频1', purpose: '原声' }];
  const written = await s.call('POST', '/api/video-rewrite/prompt', { cardId: 'rewrite-1', plan, duration, ratio,
    userText: '人物衣服用我的', materials: s.images(pageMaterials) });
  assert.equal(written.status, 200);
  assert.ok(written.json.videoPrompt.startsWith('@图片1是场景：只采用场景的布局'));
  assert.deepEqual(written.json.issues, []);
  const body = { cardId: 'rewrite-1', duration, materials: pageMaterials, changeSeconds: plan.changes.map(row => row.second),
    videoPrompt: written.json.videoPrompt };
  assert.deepEqual((await s.call('POST', '/api/video-rewrite/check', body)).json.issues, []);
  const bad = await s.call('POST', '/api/video-rewrite/check', { ...body, videoPrompt: body.videoPrompt + pageMaterials[1].originalDesc });
  assert.ok(bad.json.issues.some(issue => /原描述/.test(issue)));
  const late = await s.call('POST', '/api/video-rewrite/check', { ...body, videoPrompt: '0-15秒：' + body.videoPrompt });
  assert.ok(late.json.issues.some(issue => /时间轴前/.test(issue)));
  for (const originalDesc of [null, 1, {}, 'x'.repeat(4001)]) {
    assert.equal((await s.call('POST', '/api/video-rewrite/check', { ...body,
      materials: [{ tag: '@图片1', purpose: '人物', originalDesc }] })).status, 400);
  }
  assert.equal(s.app.stores.spend.totalOn(), 0);
});

test('没连要换的人物图：照旧不调豆包，没填 Key 也能出词，零网络、不花钱、不记账', async () => {
  let calls = 0;
  const s = setup({ fake: false, readEnv: () => ({}), fetch: async () => { calls++; throw Error('不能调用'); } });
  const plan = await fakePlan(15);
  const result = await s.call('POST', '/api/video-rewrite/prompt', { cardId: 'rewrite-1', plan: { ...plan, replace: plan.replace.filter(id => id !== 'P1') },
    materials: s.images(materials.slice(1)), duration: 15, ratio: '9:16', userText: '换衣服' });
  assert.equal(result.status, 200); assert.deepEqual(result.json.issues, []);
  assert.equal(result.json.yuan, 0); assert.equal(result.json.costUnknown, false);
  assert.equal(calls, 0); assert.equal(s.app.stores.spend.totalOn(), 0);
});

test('连了要换的人物图：没填 Key 就拒绝、零网络；填了就看一次图（关思考、一张图），记账，衣服发型照看图结果写', async () => {
  const blocked = setup({ fake: false, readEnv: () => ({}), fetch: async () => { throw Error('不能调用'); } });
  const one = planFromReply({ people: [{ id: 'P1', desc: '年轻女生，黑色长辫', from: 0, to: 6 }], clothes: [{ id: 'C1', desc: '舞蹈服，黑红', from: 0, to: 6 }],
    things: [], replace: ['P1'], unsure: [] }, 6);
  const rows = [{ tag: '@图片1', purpose: '背景' }, { tag: '@图片2', purpose: '人物', itemId: 'P1', originalDesc: '年轻女生，黑色长辫' }, { tag: '@视频1', purpose: '深度' }];
  const body = s => ({ cardId: 'rewrite-1', plan: one, materials: s.images(rows), duration: 6, ratio: '9:16', userText: '人物换掉' });
  const refused = await blocked.call('POST', '/api/video-rewrite/prompt', body(blocked));
  assert.equal(refused.status, 400); assert.match(refused.json.error, /ARK_API_KEY/);
  const requests = [];
  const reply = { people: [{ tag: '@图片2', views: 3, plainClothes: false, clothes: '橙色工作服和长裤', hair: '灰白色短发' }] };
  const s = setup({ fake: false, fetch: async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ usage: { prompt_tokens: 2000, completion_tokens: 100 }, choices: [{ message: { content: JSON.stringify(reply) } }] }));
  } });
  const result = await s.call('POST', '/api/video-rewrite/prompt', body(s));
  assert.equal(result.status, 200); assert.deepEqual(result.json.issues, []);
  assert.equal(requests.length, 1); assert.deepEqual(requests[0].thinking, { type: 'disabled' });
  assert.equal(requests[0].messages[0].content.filter(part => part.type === 'image_url').length, 1);
  assert.match(result.json.videoPrompt, /@图片2是人物：采用脸、发型（灰白色短发）、身材和衣服，不采用图中的背景；图里3个身影/);
  assert.match(result.json.videoPrompt, /\n0-6秒：人物身穿@图片2里的衣服（橙色工作服和长裤）。\n/);
  assert.equal(result.json.yuan, (2000 * 6 + 100 * 30) / 1e6, '按 2.1 Pro 6 / 30 元每百万 token');
  assert.equal(s.app.stores.spend.totalOn(), 0.02, '流水今天合计按分四舍五入');
});

test('越目录的id拒绝，4~30秒外和缺Key拒绝且零网络零执行器', async () => {
  let network = 0;
  const s = setup({ fake: false, fetch: async () => { network++; throw Error('不能调用'); } });
  for (const cardId of ['..', '../x', 'a/b', 'a\\b', '', 'a'.repeat(65)]) {
    assert.equal((await s.call('POST', '/api/video-rewrite/analyze', { ...analyzeBody(s.upload(15)), cardId })).status, 400);
  }
  for (const duration of [3.99, 30.01]) {
    const result = await s.call('POST', '/api/video-rewrite/analyze', analyzeBody(s.upload(duration)));
    assert.equal(result.status, 400); assert.match(result.json.error, /4.*30.*秒/);
  }
  const noKey = setup({ fake: false, readEnv: () => ({}), fetch: async () => { network++; } });
  assert.equal((await noKey.call('POST', '/api/video-rewrite/analyze', analyzeBody(noKey.upload(15)))).status, 400);
  assert.equal(network, 0); assert.equal(s.mediaCalls.length, 0); assert.equal(noKey.mediaCalls.length, 0);
});

test('边界4和30秒接收；真实元数据不信页面谎报，work来源也通', async () => {
  const s = setup();
  for (const duration of [4, 30]) {
    assert.equal((await s.call('POST', '/api/video-rewrite/analyze', analyzeBody(s.upload(duration)))).status, 200);
  }
  const short = await s.call('POST', '/api/video-rewrite/analyze', { ...analyzeBody(s.upload(2)), duration: 15 });
  assert.equal(short.status, 400);
  const ref = s.upload(15), asset = s.app.stores.uploads.read(ref.id);
  const work = s.app.stores.works.addVideo(asset.buffer, {});
  assert.equal((await s.call('POST', '/api/video-rewrite/analyze', analyzeBody({ type: 'work', id: work.id }))).status, 200);
  assert.equal((await s.call('POST', '/api/video-rewrite/analyze', analyzeBody({ type: 'url', id: ref.id }))).status, 400);
});

test('拆解坏JSON不重发，已花token立即落盘且原话脱敏', async () => {
  const calls = [];
  const s = setup({ fake: false, fetch: async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    const content = '坏JSON test-rewrite-private test-rewrite-secret';
    return new Response(JSON.stringify({ usage: { prompt_tokens: 1000, completion_tokens: 500 }, choices: [{ message: { content } }] }));
  } });
  const result = await s.call('POST', '/api/video-rewrite/analyze', analyzeBody(s.upload(15.05)));
  assert.equal(result.status, 502); assert.equal(calls.length, 1);
  assert.equal(result.json.yuan, 0.021); assert.match(result.json.error, /坏JSON \*\*\* \*\*\*/);
  assert.equal(existsSync(join(s.root, '改写', 'rewrite-1')), false);
  assert.equal(s.app.stores.spend.totalOn(), 0.02);
  const rows = readFileSync(join(s.root, '花费.jsonl'), 'utf8').trim().split('\n').map(x => JSON.parse(x));
  assert.equal(rows.length, 1); assert.equal(rows[0].jobId, 'rewrite-1');
});

test('坏改写单、素材表和检查参数直接拒绝', async () => {
  let calls = 0;
  const s = setup({ fake: false, fetch: async () => { calls++; } });
  const plan = await fakePlan(15);
  const input = { cardId: 'rewrite-1', plan, userText: '换衣', materials, duration: 15, ratio: '9:16' };
  for (const patch of [{ plan: {} }, { materials: {} }, { materials: [{ tag: '@图片0', purpose: '人' }] },
    { materials: [materials[0], materials[0]] }, { ratio: 'x' }, { duration: 31 }, { userText: '' }, { plan: { ...plan, items: [] } }]) {
    assert.equal((await s.call('POST', '/api/video-rewrite/prompt', { ...input, ...patch })).status, 400);
  }
  assert.equal((await s.call('POST', '/api/video-rewrite/check', { cardId: 'rewrite-1', materials, duration: 15 })).status, 400);
  assert.equal(calls, 0);
});

test('断线不编造花费、标出待确认且不重发，用户关页面也记账', async () => {
  let calls = 0;
  const logs = [];
  const s = setup({ fake: false, logError: (label, error) => logs.push(error.message),
    fetch: async () => { calls++; throw Error('断线 test-rewrite-private'); } });
  const result = await s.call('POST', '/api/video-rewrite/analyze', analyzeBody(s.upload(15)));
  assert.equal(result.status, 502); assert.equal(result.json.yuan, 0); assert.equal(result.json.costUnknown, true);
  assert.match(result.json.error, /这台电脑连不上火山.*检查一下网络/);
  assert.doesNotMatch(result.json.error, /test-rewrite-private|断线/);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /断线 \*\*\*/);
  assert.doesNotMatch(logs[0], /test-rewrite-private/);
  assert.equal(calls, 1); assert.equal(s.app.stores.spend.totalOn(), 0);
  // 模拟请求已读完，响应目标已关闭；模型调用不挂在连接的abort信号上。
  const disconnected = setup({ fake: false, fetch: async () => new Response(JSON.stringify({
    usage: { prompt_tokens: 1000, completion_tokens: 500 }, choices: [{ message: { content: '坏JSON' } }]
  })) });
  const body = analyzeBody(disconnected.upload(15));
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method: 'POST', url: '/api/video-rewrite/analyze', headers: { host: '127.0.0.1:5290', 'content-type': 'application/json' } });
  const res = new Writable({ write(chunk, encoding, done) { done(); } });
  res.destroy(); res.writeHead = () => {};
  await disconnected.app.handler(req, res);
  assert.equal(disconnected.app.stores.spend.totalOn(), 0.02);
});

test('同一卡处理中重拆报409且不误删进行中目录，完成后目录已清', async () => {
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const s = setup({ sheets: { cuts: async () => { entered(); await gate; return []; } } });
  const body = analyzeBody(s.upload(15));
  const ongoing = s.call('POST', '/api/video-rewrite/analyze', body);
  await waiting;
  assert.equal((await s.call('POST', '/api/video-rewrite/analyze', body)).status, 409);
  assert.equal(existsSync(join(s.root, '改写', 'rewrite-1')), true);
  release(); assert.equal((await ongoing).status, 200);
  assert.equal(existsSync(join(s.root, '改写', 'rewrite-1')), false);
});

test('假分析失败也不保存任何上传图，并删除中间目录', async () => {
  const s = setup(), failedBody = { ...analyzeBody(s.upload(6)), userText: '假拆解失败' };
  const before = readdirSync(join(s.root, '上传')).sort();
  const failed = await s.call('POST', '/api/video-rewrite/analyze', failedBody);
  assert.equal(failed.status, 502); assert.match(failed.json.error, /假拆解失败/);
  assert.equal(failed.json.yuan, 0); assert.equal(failed.json.costUnknown, false);
  assert.equal(existsSync(join(s.root, '改写', 'rewrite-1')), false);
  assert.deepEqual(readdirSync(join(s.root, '上传')).sort(), before);
});

test('拼图执行器失败也删临时目录，明确没花钱', async () => {
  const s = setup({ sheets: { timeline: async ({ folder }) => { writeFileSync(join(folder, 'partial.jpg'), 'unfinished'); throw Error('本机拼图失败'); } } });
  const result = await s.call('POST', '/api/video-rewrite/analyze', { ...analyzeBody(s.upload(6)), cardId: 'sheet-failure' });
  assert.equal(result.status, 502); assert.match(result.json.error, /本机拼图失败/);
  assert.equal(result.json.yuan, 0); assert.equal(result.json.costUnknown, false);
  assert.equal(existsSync(join(s.root, '改写', 'sheet-failure')), false);
});

test('分析缺Key时不拼图，也清掉同任务残留中间目录', async () => {
  const s = setup({ fake: false, readEnv: () => ({}) });
  const body = analyzeBody(s.upload(6));
  const folder = join(s.root, '改写', 'rewrite-1'); mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'old.jpg'), 'old');
  const result = await s.call('POST', '/api/video-rewrite/analyze', body);
  assert.equal(result.status, 400); assert.match(result.json.error, /ARK_API_KEY/);
  assert.equal(existsSync(join(s.root, '改写', 'rewrite-1')), false);
  assert.equal(s.mediaCalls.length, 0);
});

test('合法任务号下的坏用户输入也会清除残留中间目录', async () => {
  const s = setup();
  for (const userText of ['', 'x'.repeat(4001)]) {
    const body = analyzeBody(s.upload(6));
    const folder = join(s.root, '改写', 'rewrite-1'); mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'old.jpg'), 'old');
    const result = await s.call('POST', '/api/video-rewrite/analyze', { ...body, userText });
    assert.equal(result.status, 400);
    assert.equal(existsSync(join(s.root, '改写', 'rewrite-1')), false);
  }
});

test('免费检查严格校验changeSeconds，旧卡不传兼容并按变化点检查一秒区间', async () => {
  const s = setup();
  const input = { cardId: 'rewrite-1', materials: [], duration: 15, videoPrompt: '0-15秒：站立。' };
  for (const changeSeconds of [null, {}, '5', [null], ['5'], [-1], [15], [16], [1e100]]) {
    const response = await s.call('POST', '/api/video-rewrite/check', { ...input, changeSeconds });
    assert.equal(response.status, 400, JSON.stringify(changeSeconds));
    assert.match(response.json.error, /变化.*秒数/);
  }
  assert.equal((await s.call('POST', '/api/video-rewrite/check', input)).status, 200);
  const checked = await s.call('POST', '/api/video-rewrite/check', { ...input, changeSeconds: [5.5, 9] });
  assert.equal(checked.status, 200);
  assert.ok(checked.json.issues.some(x => x.includes('5-6秒')));
  assert.ok(checked.json.issues.some(x => x.includes('9-10秒')));
});

test('启动传入fakeDelayMs后只有拆解等（10-30 起提示词由代码拼、不等），普通帮我改写不受影响', async () => {
  const delayMs = 300, s = setup({ fakeDelayMs: delayMs });
  const start = performance.now();
  const result = await s.call('POST', '/api/video-rewrite/analyze', analyzeBody(s.upload(6)));
  assert.equal(result.status, 200);
  assert.ok(performance.now() - start >= delayMs - 10, '拆解等待');
  const promptStart = performance.now();
  const written = await s.call('POST', '/api/video-rewrite/prompt', { cardId: 'rewrite-1', plan: result.json.plan,
    materials: s.images(materials), duration: 6, ratio: '9:16', userText: '换衣' });
  assert.equal(written.status, 200);
  assert.ok(performance.now() - promptStart < delayMs, '拼词不等');
  const ordinary = await s.call('POST', '/api/rewrite', { prompt: '一位女生', kind: 'image' });
  assert.equal(ordinary.status, 200);
});
