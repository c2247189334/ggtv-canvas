import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planFromReply } from './analyze.mjs';
import { checkPromptInput, checkSceneTexts } from './input.mjs';
import { NEW_SCENE_PURPOSE } from './roles.mjs';
import { checkRules } from './rules.mjs';
import { writePrompt } from './writePrompt.mjs';
import { parseModelJson } from './modelJson.mjs';
import { finalizePrompt } from './finalPrompt.mjs';
import { FAKE_SCENE_READ, sceneReadsOf, sceneTextRows } from './sceneTexts.mjs';
import { setup } from './routeTestKit.mjs';
import { fakeClaudeLogin, tempDir } from '../testKit.mjs';

// 11-13 背景卡「不出图，用文字」（设计 docs/specs/2026-11-12-背景卡用文字-design.md）。
const plan = planFromReply({ people: [{ id: 'P1', desc: '女生', from: 0, to: 10 }], clothes: [{ id: 'C1', person: 'P1', desc: '大衣，棕色', from: 0, to: 10 }],
  things: [], replace: ['P1'], unsure: [], scenes: [{ id: 'S1', desc: '白棚，白色', from: 0, to: 4 }, { id: 'S2', desc: '巨大棒球，白色', from: 4, to: 7 },
    { id: 'S3', desc: '保龄球，深蓝', from: 7, to: 10 }] }, 10);
const asset = { type: 'upload', id: '0ab69783-e141-40c6-9397-d3c687cc0e4e' };
const backdrop = (tag, itemId) => ({ tag, purpose: NEW_SCENE_PURPOSE, itemId, asset });
const body = (materials, sceneTexts) => ({ cardId: 'card-1', plan, duration: 10, sourceDuration: 10, ratio: '9:16', userText: '人和背景换成我的',
  materials: [...materials, { tag: `@图片${materials.length + 1}`, itemId: 'P1', purpose: '人物', asset }], ...(sceneTexts ? { sceneTexts } : {}) });
const ball = { title: '背景 2', sceneId: 'S2', text: '脚下和身后的球都换成篮球' };

test('用文字的段不被并掉：底稿写占位，规则查出占位残留；没写字时请求里不带 sceneTexts', () => {
  const input = checkPromptInput(body([backdrop('@图片1', 'S1')], [ball]));
  assert.deepEqual(input.sceneTexts, [ball]);
  assert.deepEqual(input.plan.items.filter(item => item.kind === '场景').map(item => item.id), ['S1', 'S2'], 'S3 没图没字照旧并进前一段');
  const { videoPrompt } = writePrompt(input);
  assert.match(videoPrompt, /场景是@图片1[\s\S]*场景是【背景 2 用文字】/);
  assert.doesNotMatch(videoPrompt, /巨大棒球/, '不拿拆解原描述顶上');
  assert.ok(checkRules({ ...input, videoPrompt }).includes('提示词里还有占位「【背景 2 用文字】」，要写成这一段的画面描述。'));
  assert.deepEqual(checkRules({ ...input, videoPrompt: videoPrompt.replaceAll('【背景 2 用文字】', '纯白空间里的巨大篮球布景') }), []);
  assert.equal('sceneTexts' in checkPromptInput(body([backdrop('@图片1', 'S1')])), false);
});

test('检查 sceneTexts：空字、太长、对不上场景、多场景缺段、同段两次、同段又有图都拦', () => {
  const materials = [backdrop('@图片1', 'S1')];
  const fail = (rows, pattern) => assert.throws(() => checkSceneTexts(rows, plan, materials), pattern);
  fail([{ ...ball, text: '  ' }], /背景 2 选了用文字，还没写字/);
  fail([{ ...ball, text: '球'.repeat(301) }], /最多 300 个/);
  fail([{ ...ball, sceneId: 'S9' }], /对不上拆解单里的场景/);
  fail([{ title: '背景 2', text: '篮球' }], /没记是哪一段/);
  fail([ball, { ...ball, title: '背景 4' }], /这一段写了两次字/);
  fail([{ ...ball, sceneId: 'S1', title: '背景' }], /同时有图和字，留一样/);
  fail('篮球', /格式不对/);
  // 原片只有一个地方：不带 sceneId 的一句管全片；连着背景图就冲突。
  const single = { items: plan.items.filter(item => item.kind !== '场景'), replace: ['P1'] };
  assert.deepEqual(checkSceneTexts([{ title: '背景', text: '沙发换成红色皮沙发' }], single, []), [{ title: '背景', text: '沙发换成红色皮沙发' }]);
  assert.throws(() => checkSceneTexts([{ title: '背景', text: '红沙发' }], single, [{ tag: '@图片1', purpose: '背景', asset }]), /同时有图和字/);
});

test('11-12 实测坑：定稿回话字段之间的逗号写成中文「，」也能读；字符串里的「，」原样', () => {
  assert.deepEqual(parseModelJson('{"prompt":"0-4秒：纯白，明亮"，"changes":[]，"unfixable":[]}'), { prompt: '0-4秒：纯白，明亮', changes: [], unfixable: [] });
});

test('11-15 截图文件名：卡名里的路径符号、盘符冒号、开头的点都换掉，写不到临时目录外面', () => {
  for (const title of ['..\\..\\外面', '../../外面', 'C:\\外面', '背景/2', '..', 'a<b>|c?*"']) {
    const [{ file }] = sceneTextRows([{ ...ball, title }], plan, 10);
    assert.doesNotMatch(file, /[\\/:*?"<>|]/, file); assert.doesNotMatch(file, /^\./, file); assert.match(file, /_原片[\d.]+s\.jpg$/);
  }
  assert.match(sceneTextRows([ball], plan, 10)[0].file, /^背景2_原片/, '正常卡名不变');
});

const sheets = calls => ({ frames: async ({ source, folder }, times) => { calls.push({ source, times }); mkdirSync(folder, { recursive: true });
  return times.map((_, i) => { writeFileSync(join(folder, `f-${i}.jpg`), Buffer.from([i])); return `f-${i}.jpg`; }); },
contact: async ({ folder }, options) => { mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, 'c.jpg'), Buffer.from([1])); return [{ name: 'c.jpg', from: 0, to: options.end }]; } });
const finalInput = folder => ({ kind: 'person', draft: '@图片1是人物。\n0-10秒：场景是【背景 2 用文字】，人物。', folder, duration: 10, userText: '换', plan, warnings: [],
  materials: [{ tag: '@图片1', purpose: '人物', image: { name: '图片1_人物.jpg', buffer: Buffer.from([9]) } }],
  sceneTexts: sceneTextRows([ball], plan, 10), sourceVideo: { path: 'S0.mp4' } });
const good = { text: JSON.stringify({ prompt: '@图片1是人物。\n0-10秒：场景是巨大篮球布景，人物。', changes: [], unfixable: [],
  sceneReads: [{ title: '背景 2', read: '脚下和身后都是篮球' }] }) };

test('定稿：多给补充说明、背景卡要求.txt 和原片那一刻的截图（截拆解单这一段的背景帧），回显每张卡怎么理解', async () => {
  const frames = [], calls = [];
  const result = await finalizePrompt(finalInput(tempDir()), { call: async input => { calls.push(input); return good; }, sheets: sheets(frames), rules: () => [] });
  assert.equal(result.finalized, true); assert.deepEqual(result.sceneReads, [{ title: '背景 2', read: '脚下和身后都是篮球' }]);
  assert.match(calls[0].system, /补充（背景卡改用文字）[\s\S]*占位「【… 用文字】」必须全部换成画面描述[\s\S]*不采用其中的××[\s\S]*"sceneReads"/);
  const second = plan.items.find(item => item.id === 'S2').frame;
  assert.ok(frames.some(row => row.source === 'S0.mp4' && row.times[0] === second), JSON.stringify(frames));
  const names = calls[0].files.map(file => file.name);
  assert.ok(names.includes(`背景2_原片${second.toFixed(1)}s.jpg`) && names.includes('背景卡要求.txt'), names.join(','));
  assert.match(calls[0].files.find(file => file.name === '背景卡要求.txt').buffer.toString(), /背景 2（管 4-7 秒，拆解单场景 S2）：用户写「脚下和身后的球都换成篮球」/);
  assert.deepEqual(sceneReadsOf([ball, { title: '背景 3', text: '跟原来一样' }], result.sceneReads), [{ title: '背景 2', text: ball.text, read: '脚下和身后都是篮球' },
    { title: '背景 3', text: '跟原来一样', read: '（没说怎么理解）' }]);
});

test('有背景卡的字时定稿失败不退底稿：自动再跑一次，成了就用；还不行就报错；没有字时照旧退底稿', async () => {
  let n = 0;
  const flaky = await finalizePrompt(finalInput(tempDir()), { call: async () => { if (++n === 1) throw Error('断线'); return good; }, sheets: sheets([]), rules: () => [] });
  assert.equal(flaky.finalized, true); assert.equal(n, 2);
  n = 0;
  await assert.rejects(finalizePrompt(finalInput(tempDir()), { call: async () => { n++; throw Error('断线'); }, sheets: sheets([]), rules: () => [] }),
    /背景卡的字这次没写进去（本机 agent 定稿没成功（断线））/);
  assert.equal(n, 2);
  n = 0;
  await assert.rejects(finalizePrompt(finalInput(tempDir()), { call: async () => { n++; return good; }, sheets: sheets([]), rules: () => ['坏'] }), /两次都没过程序检查/);
  assert.equal(n, 4, '每次两轮，共两次');
  const { sceneTexts: _texts, ...plain } = finalInput(tempDir());
  const fallback = await finalizePrompt(plain, { call: async () => { throw Error('断线'); }, sheets: sheets([]), rules: () => [] });
  assert.equal(fallback.finalized, false); assert.equal(fallback.videoPrompt, plain.draft);
});

const routeBody = (s, sceneTexts = [ball, { title: '背景 3', sceneId: 'S3', text: '跟原来一样，还是保龄球' }]) => ({ cardId: 'rewrite-1', plan, duration: 10, ratio: '9:16', userText: '人和背景换成我的',
  materials: s.images([{ tag: '@图片1', purpose: NEW_SCENE_PURPOSE, itemId: 'S1' }, { tag: '@图片2', purpose: '人物', itemId: 'P1', originalDesc: '女生' }]),
  sceneTexts, source: s.upload(10), settings: { model: 'doubao-seedance-2-5-260628', ratio: '9:16', resolution: '480p', duration: 10, audio: false } });

test('接口：本机 Claude 拿到卡上的字和截图定稿，回 sceneReads；两次都坏就报错不回底稿；没 agent 直接拦；假模式占位换成原话', async t => {
  const logout = fakeClaudeLogin(); t.after(logout);
  const bin = join(tempDir(), 'claude.exe'); writeFileSync(bin, '');
  const calls = []; let broken = false;
  const claude = async input => {
    calls.push(input);
    if (!String(input.system ?? '').startsWith('你是 Seedance 2.5「视频复刻」的提示词定稿员')) {
      return { text: JSON.stringify({ people: [{ tag: '@图片2', views: 1, plainClothes: false, clothes: '', hair: '黑短发' }] }), model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: 1 } };
    }
    const draft = input.files.find(file => file.name === '底稿.txt').buffer.toString();
    const prompt = draft.replaceAll('【背景 2 用文字】', '纯白空间里的巨大篮球布景').replaceAll('【背景 3 用文字】', '纯白空间里的巨大蓝色保龄球布景');
    return { text: broken ? '不是 JSON' : JSON.stringify({ prompt, changes: [], unfixable: [], sceneReads: [{ title: '背景 2', read: '脚下和身后都是篮球' }] }),
      model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: 1 } };
  };
  const s = setup({ fake: false, readEnv: () => ({ CLAUDE_CLI: bin }), claude });
  const written = await s.call('POST', '/api/video-rewrite/prompt', routeBody(s));
  assert.equal(written.status, 200, JSON.stringify(written.json));
  assert.equal(written.json.finalized, true); assert.deepEqual(written.json.issues, []);
  assert.match(written.json.videoPrompt, /巨大篮球布景[\s\S]*蓝色保龄球布景/); assert.doesNotMatch(written.json.videoPrompt, /用文字】/);
  assert.deepEqual(written.json.sceneReads, [{ title: '背景 2', text: ball.text, read: '脚下和身后都是篮球' }, { title: '背景 3', text: '跟原来一样，还是保龄球', read: '（没说怎么理解）' }]);
  const names = calls.at(-1).files.map(file => file.name);
  assert.ok(names.includes('背景卡要求.txt') && names.some(name => /^背景2_原片[\d.]+s\.jpg$/.test(name)) && names.some(name => /^背景3_原片[\d.]+s\.jpg$/.test(name)), names.join(','));
  assert.match(calls.at(-1).system, /补充（背景卡改用文字）/);

  broken = true; const before = calls.length;
  const failed = await s.call('POST', '/api/video-rewrite/prompt', routeBody(s));
  assert.equal(failed.status, 502); assert.match(failed.json.error, /背景卡的字这次没写进去.*再点一次「生成提示词」/);
  assert.equal(calls.length - before, 3, '看一次人物图 + 定稿两次');

  logout();
  const unready = setup({ fake: false, readEnv: () => ({}), claude });
  const blocked = await unready.call('POST', '/api/video-rewrite/prompt', routeBody(unready));
  assert.equal(blocked.status, 400); assert.match(blocked.json.error, /Claude 或 Codex/);

  const f = setup(), fake = await f.call('POST', '/api/video-rewrite/prompt', routeBody(f));
  assert.equal(fake.status, 200, JSON.stringify(fake.json));
  assert.match(fake.json.videoPrompt, /场景是（用户写：脚下和身后的球都换成篮球）/); assert.doesNotMatch(fake.json.videoPrompt, /用文字】/);
  assert.equal(fake.json.sceneReads[0].read, FAKE_SCENE_READ);
  const empty = await f.call('POST', '/api/video-rewrite/prompt', routeBody(f, [{ ...ball, text: '' }]));
  assert.equal(empty.status, 400); assert.match(empty.json.error, /背景 2 选了用文字，还没写字/);
});
