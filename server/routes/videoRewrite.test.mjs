import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeRound } from '../videoRewrite/fake.mjs';
import { planFromReply } from '../videoRewrite/analyze.mjs';
import { agentEnv, setup } from '../videoRewrite/routeTestKit.mjs';
import { fakeClaudeLogin, tempDir } from '../testKit.mjs';
const analyzeBody = source => ({ cardId: 'rewrite-1', source, userText: '人和衣服都换成我的' });
const fakePlan = async duration => planFromReply(await fakeRound({ context: { duration } }), duration);
const materials = [{ tag: '@图片1', itemId: 'P1', purpose: '人物' },
  ...[1, 2, 3, 4].map(i => ({ tag: `@图片${i + 1}`, itemId: `C${i}`, purpose: `衣服${i}` })),
  { tag: '@视频1', purpose: '深度' }, { tag: '@音频1', purpose: '原声' }];

test('假模式拆解一轮 + 代码拼词：大图仅在分析内部使用，不保存上传图，成功清临时目录且花费0', async () => {
  const s = setup();
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
  assert.deepEqual(written.json.warnings, ['拆解没把握：画面上方的东西是不是吊扇叶片', '拆解认出画面里还有吊扇叶片：程序底稿没写；成片里少了或摆错，再自己补一句。']);
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

test('11-15 用户定只走本机 agent：没配好时拆解和生成提示词都在动手前拦下，原话说清这一步要它干嘛、缺什么，零调用不记账', async () => {
  let calls = 0;
  const s = setup({ fake: false, readEnv: () => ({}), claude: async () => { calls++; throw Error('不能调用'); } });
  const plan = await fakePlan(15);
  for (const picked of [materials.slice(1), materials]) {
    const result = await s.call('POST', '/api/video-rewrite/prompt', { cardId: 'rewrite-1', plan, materials: s.images(picked), duration: 15, ratio: '9:16', userText: '换衣服' });
    assert.equal(result.status, 400); assert.match(result.json.error, /Claude 或 Codex/); assert.match(result.json.error, /本机 Claude 没配好/);
  }
  const analyzed = await s.call('POST', '/api/video-rewrite/analyze', analyzeBody(s.upload(15)));
  assert.equal(analyzed.status, 400); assert.match(analyzed.json.error, /本机 Claude 没配好/);
  assert.equal(calls, 0); assert.equal(s.mediaCalls.length, 0); assert.equal(s.app.stores.spend.totalOn(), 0);
});

test('越目录的id拒绝，4~30秒外和缺本机 agent 拒绝且零调用零执行器', async () => {
  let network = 0;
  const s = setup({ fake: false, claude: async () => { network++; throw Error('不能调用'); } });
  for (const cardId of ['..', '../x', 'a/b', 'a\\b', '', 'a'.repeat(65)]) {
    assert.equal((await s.call('POST', '/api/video-rewrite/analyze', { ...analyzeBody(s.upload(15)), cardId })).status, 400);
  }
  for (const duration of [3.99, 30.01]) {
    const result = await s.call('POST', '/api/video-rewrite/analyze', analyzeBody(s.upload(duration)));
    assert.equal(result.status, 400); assert.match(result.json.error, /4.*30.*秒/);
  }
  const noKey = setup({ fake: false, readEnv: () => ({}), claude: async () => { network++; } });
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

test('本机 agent 拆解回了坏 JSON 或调用失败：不重发，原话脱敏回给页面，中间目录清掉，记 0 元', async t => {
  const env = agentEnv(t), calls = [];
  for (const claude of [async input => { calls.push(input); return { text: '坏JSON test-rewrite-private test-rewrite-secret', model: 'claude-sonnet', usage: { input_tokens: 1, output_tokens: 1 } }; },
    async input => { calls.push(input); throw Error('Claude 调用失败：断线 test-rewrite-private'); }]) {
    calls.length = 0;
    const s = setup({ fake: false, readEnv: () => env, claude });
    const result = await s.call('POST', '/api/video-rewrite/analyze', analyzeBody(s.upload(15.05)));
    assert.equal(result.status, 502); assert.equal(calls.length, 1); assert.equal(result.json.yuan, 0);
    assert.ok(result.json.error.includes('***'), result.json.error); assert.doesNotMatch(result.json.error, /test-rewrite-private|test-rewrite-secret/);
    assert.equal(existsSync(join(s.root, '改写', 'rewrite-1')), false);
    assert.equal(s.app.stores.spend.totalOn(), 0);
  }
});

test('坏改写单、素材表和检查参数直接拒绝', async () => {
  let calls = 0;
  const s = setup({ fake: false, claude: async () => { calls++; } });
  const plan = await fakePlan(15);
  const input = { cardId: 'rewrite-1', plan, userText: '换衣', materials, duration: 15, ratio: '9:16' };
  for (const patch of [{ plan: {} }, { materials: {} }, { materials: [{ tag: '@图片0', purpose: '人' }] },
    { materials: [materials[0], materials[0]] }, { ratio: 'x' }, { duration: 31 }, { userText: '' }, { plan: { ...plan, items: [] } }]) {
    assert.equal((await s.call('POST', '/api/video-rewrite/prompt', { ...input, ...patch })).status, 400);
  }
  assert.equal((await s.call('POST', '/api/video-rewrite/check', { cardId: 'rewrite-1', materials, duration: 15 })).status, 400);
  assert.equal(calls, 0);
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
  assert.equal(failed.json.yuan, 0);
  assert.equal(existsSync(join(s.root, '改写', 'rewrite-1')), false);
  assert.deepEqual(readdirSync(join(s.root, '上传')).sort(), before);
});

test('拼图执行器失败也删临时目录，明确没发出去', async () => {
  const s = setup({ sheets: { timeline: async ({ folder }) => { writeFileSync(join(folder, 'partial.jpg'), 'unfinished'); throw Error('本机拼图失败'); } } });
  const result = await s.call('POST', '/api/video-rewrite/analyze', { ...analyzeBody(s.upload(6)), cardId: 'sheet-failure' });
  assert.equal(result.status, 502); assert.match(result.json.error, /本机拼图失败/);
  assert.equal(result.json.yuan, 0);
  assert.equal(existsSync(join(s.root, '改写', 'sheet-failure')), false);
});

test('分析时本机 agent 没配好就不拼图，也清掉同任务残留中间目录', async () => {
  const s = setup({ fake: false, readEnv: () => ({}) });
  const body = analyzeBody(s.upload(6));
  const folder = join(s.root, '改写', 'rewrite-1'); mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'old.jpg'), 'old');
  const result = await s.call('POST', '/api/video-rewrite/analyze', body);
  assert.equal(result.status, 400); assert.match(result.json.error, /本机 Claude 没配好/);
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
  // 等待时长要远大于拼词本身的耗时：GitHub 云电脑上拼词要 300ms 以上（11-01 自动检查红过一次），本机约几十毫秒。
  const delayMs = 2000, s = setup({ fakeDelayMs: delayMs });
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

test('11-03 本机 Claude 配好：health 报就绪；拆解和看图不要火山 Key、走注入的 claude 调用、图按总览 / 清楚 / 人物图命名、记 0 元账', async t => {
  t.after(fakeClaudeLogin());
  const bin = join(tempDir(), 'claude.exe'); writeFileSync(bin, '');
  const env = { CLAUDE_CLI: bin, CLAUDE_MODEL: 'haiku' };
  const calls = [];
  const claude = async input => {
    calls.push(input);
    const text = input.prompt.includes('总览大图')
      ? JSON.stringify({ people: [{ id: 'P1', desc: '年轻女生', from: 0, to: 6 }], clothes: [{ id: 'C1', person: 'P1', desc: '舞蹈服', from: 0, to: 6 }], things: [], replace: ['P1'], unsure: [] })
      : JSON.stringify({ people: [{ tag: '@图片2', views: 3, plainClothes: false, clothes: '橙色工装', hair: '灰白短发' }] });
    return { text, model: 'claude-haiku-5-5', elapsedMs: 9, usage: { input_tokens: 20, output_tokens: 3 } };
  };
  const s = setup({ fake: false, readEnv: () => env, claude });
  assert.equal((await s.call('GET', '/api/video-rewrite/estimates')).status, 404, '11-15 不再有豆包估价');
  const health = (await s.call('GET', '/api/health')).json;
  assert.equal(health.agentReady, true); assert.equal(health.agentModel, 'haiku'); assert.equal(health.keyReady, false);
  const analyzed = await s.call('POST', '/api/video-rewrite/analyze', analyzeBody(s.upload(6)));
  assert.equal(analyzed.status, 200, JSON.stringify(analyzed.json));
  assert.equal(analyzed.json.model, 'claude-haiku-5-5'); assert.equal(analyzed.json.yuan, 0); assert.deepEqual(analyzed.json.plan.replace, ['P1']);
  assert.equal(calls[0].model, 'haiku');
  assert.deepEqual(calls[0].files.map(file => file.name), ['总览大图-1.jpg', ...[1, 2, 3, 4, 5, 6].map(i => `清楚大图-${i}.jpg`)]);
  assert.match(calls[0].prompt, /总览大图-1\.jpg[\s\S]*看总览大图/);
  const rows = [{ tag: '@图片1', purpose: '背景' }, { tag: '@图片2', purpose: '人物', itemId: 'P1', originalDesc: '年轻女生' }, { tag: '@视频1', purpose: '深度' }];
  const written = await s.call('POST', '/api/video-rewrite/prompt', { cardId: 'rewrite-1', plan: analyzed.json.plan, materials: s.images(rows), duration: 6, ratio: '9:16', userText: '人物换掉' });
  assert.equal(written.status, 200, JSON.stringify(written.json));
  assert.equal(written.json.yuan, 0); assert.equal(written.json.model, 'claude-haiku-5-5'); assert.match(written.json.videoPrompt, /灰白短发/);
  assert.deepEqual(calls[1].files.map(file => file.name), ['人物图-1.jpg']);
  assert.equal(s.app.stores.spend.totalOn(), 0);
  assert.equal(existsSync(join(s.root, '改写', 'rewrite-1')), false);
});

test('AGENT_ENGINE 选 codex：health 报 Codex 就绪，不要 Claude 登录也不要火山 Key；没登录就拦下拆解并说清楚', async () => {
  const bin = join(tempDir(), 'codex.exe'), home = tempDir(), saved = process.env.CODEX_HOME;
  writeFileSync(bin, ''); process.env.CODEX_HOME = home;
  try {
    const env = { AGENT_ENGINE: 'codex', CODEX_CLI: bin };
    const s = setup({ fake: false, readEnv: () => env });
    const notLogged = (await s.call('GET', '/api/health')).json;
    assert.equal(notLogged.agentReady, false); assert.match(notLogged.agentProblem, /codex login/);
    const refused = await s.call('POST', '/api/video-rewrite/analyze', analyzeBody(s.upload(6)));
    assert.equal(refused.status, 400); assert.match(refused.json.error, /codex login/);
    writeFileSync(join(home, 'auth.json'), '{}');
    const ready = (await s.call('GET', '/api/health')).json;
    assert.equal(ready.agentName, 'Codex'); assert.equal(ready.agentReady, true); assert.equal(ready.agentProblem, null); assert.equal(ready.keyReady, false);
  } finally {
    if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved;
  }
});

test('11-08 生成提示词合并看图定稿：拼完底稿把图、深度和原片抽帧交给本机 Claude 定稿，过规则才用，提醒带回；11-15 起没就绪就拦下', async t => {
  const logout = fakeClaudeLogin(); t.after(logout);
  const bin = join(tempDir(), 'claude.exe'); writeFileSync(bin, '');
  const calls = [];
  let final = draft => ({ prompt: draft, changes: [{ before: '旧', after: '新', why: '衣服图有白帽，原片没戴', evidence: '原片_6.0s' }],
    unfixable: [{ what: '深度里有辫子', evidence: '视频1_1.5s', fix: '换白模' }], checked: '全看了' });
  const claude = async input => {
    calls.push(input);
    const text = input.system?.includes('提示词定稿员') ? JSON.stringify(final(input.files.find(file => file.name === '底稿.txt').buffer.toString()))
      : JSON.stringify({ people: [{ tag: '@图片1', views: 1, plainClothes: false, clothes: '', hair: '灰白短发' }] });
    return { text, model: 'claude-sonnet-5-5', elapsedMs: 9, usage: { input_tokens: 1, output_tokens: 1 } };
  };
  const s = setup({ fake: false, readEnv: () => ({ CLAUDE_CLI: bin }), claude });
  const rows = s.images(materials).map(row => row.tag === '@视频1' ? { ...row, asset: s.upload(15) } : row);
  const body = { cardId: 'rewrite-1', plan: await fakePlan(15), materials: rows, duration: 15, ratio: '9:16', userText: '人和衣服都换成我的', source: s.upload(15),
    settings: { model: 'doubao-seedance-2-5-260628', ratio: '9:16', resolution: '480p', duration: 15, audio: false } };
  const written = await s.call('POST', '/api/video-rewrite/prompt', body);
  assert.equal(written.status, 200, JSON.stringify(written.json));
  assert.equal(written.json.finalized, true); assert.deepEqual(written.json.issues, []); assert.equal(written.json.yuan, 0);
  assert.ok(written.json.warnings.includes('Claude 看图改了 1 处：衣服图有白帽，原片没戴'), written.json.warnings.join('|'));
  assert.ok(written.json.warnings.includes('Claude 看图发现改字解决不了：深度里有辫子（建议：换白模）'));
  assert.equal(calls.length, 2, '看一次人物图 + 定稿一次');
  const names = calls[1].files.map(file => file.name);
  for (const name of ['图片1_人物.jpg', '图片2_衣服1.jpg', '视频1_0.0s.jpg', '原片_0.0s.jpg', '底稿.txt', '素材表.txt', '拆解单.json', '用户原话.txt']) assert.ok(names.includes(name), `${name} 不在 ${names.join(',')}`);
  assert.match(calls[1].files.find(file => file.name === '素材表.txt').buffer.toString(), /@音频1：原声，这次没有文件/);
  assert.match(calls[1].prompt, /Seedance 2\.5，参考模式，9:16，480p，15 秒，生成音频关/); assert.equal(calls[1].timeoutMs, 600000);
  assert.equal(existsSync(join(s.root, '改写', 'rewrite-1')), false); assert.equal(s.app.stores.spend.totalOn(), 0);

  final = () => ({ prompt: '0-15秒：坏稿' });
  const fallback = await s.call('POST', '/api/video-rewrite/prompt', body);
  assert.equal(fallback.status, 200); assert.equal(fallback.json.finalized, false); assert.equal(fallback.json.videoPrompt, written.json.videoPrompt);
  assert.ok(fallback.json.warnings.some(text => /两次都没过程序检查.*先用程序底稿/.test(text)), fallback.json.warnings.join('|'));
  assert.equal(calls.length, 5, '看图 + 两轮定稿');

  logout();
  const unready = setup({ fake: false, readEnv: () => ({}), claude });
  const plain = await unready.call('POST', '/api/video-rewrite/prompt', { ...body, materials: unready.images([{ tag: '@图片1', purpose: '背景' }]) });
  assert.equal(plain.status, 400, JSON.stringify(plain.json)); assert.match(plain.json.error, /Claude 或 Codex/); assert.equal(calls.length, 5, '没就绪不调本机 agent');
  const f = setup(), fakeMode = await f.call('POST', '/api/video-rewrite/prompt', { ...body, materials: f.images([{ tag: '@图片1', purpose: '背景' }]) });
  assert.equal(fakeMode.status, 200); assert.equal(fakeMode.json.finalized, false);
});
