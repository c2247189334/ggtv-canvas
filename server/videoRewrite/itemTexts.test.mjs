import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planFromReply } from './analyze.mjs';
import { checkPromptInput } from './input.mjs';
import { checkRules } from './rules.mjs';
import { writePrompt } from './writePrompt.mjs';
import { finalizePrompt } from './finalPrompt.mjs';
import { checkItemTexts, fakeItemTexts, itemTextNote, itemTextRows } from './itemTexts.mjs';
import { FAKE_SCENE_READ, sceneReadsOf } from './sceneTexts.mjs';
import { setup } from './routeTestKit.mjs';
import { fakeClaudeLogin, tempDir } from '../testKit.mjs';

// 11-16 衣服卡、东西卡「不出图，用文字」（设计 docs/specs/2026-11-16-衣服卡和东西卡用文字-design.md）。
const plan = planFromReply({ people: [{ id: 'P1', desc: '女生', from: 0, to: 12 }],
  clothes: [{ id: 'C1', person: 'P1', desc: '休闲套装，白色短袖', from: 0, to: 4 }, { id: 'C2', person: 'P1', desc: '棒球套装，红色棒球帽', from: 4, to: 8 },
    { id: 'C3', person: 'P1', desc: '高尔夫套装，黑色直筒长裤', from: 8, to: 10 }, { id: 'C4', person: 'P1', sameAs: 'C1', desc: '休闲套装，白色短袖', from: 10, to: 12 }],
  things: [{ id: 'D1', kind: '道具', desc: '棒球棒，浅木色握把缠胶带', from: 0, to: 12 }], replace: ['P1', 'C1', 'C2', 'C3', 'C4', 'D1'], unsure: [] }, 12);
const asset = { type: 'upload', id: '0ab69783-e141-40c6-9397-d3c687cc0e4e' };
const person = tag => ({ tag, purpose: '人物', itemId: 'P1', asset });
const cloth = (tag, itemId, n) => ({ tag, purpose: `衣服 ${n}`, itemId, asset });
const body = (materials, itemTexts, more = {}) => ({ cardId: 'card-1', plan, duration: 12, sourceDuration: 12, ratio: '9:16', userText: '人和衣服换成我的',
  materials, ...(itemTexts ? { itemTexts } : {}), ...more });
const yellow = { title: '衣服 2', itemId: 'C2', text: '换成黄色篮球背心和短裤，帽子不要了' };
const same = { title: '衣服 3', itemId: 'C3', text: '跟原来一样' };
const bat = { title: '道具', itemId: 'D1', text: '换成银色的金属球棒' };

test('用文字的衣服写占位，编号不因剪线变；用文字的卡不查原描述，占位没换掉规则会报', () => {
  const input = checkPromptInput(body([person('@图片1'), cloth('@图片2', 'C1', 1)], [yellow, same, bat]));
  assert.deepEqual(input.itemTexts, [{ ...yellow, cardTitle: '衣服 2' }, { ...same, cardTitle: '衣服 3' }, bat]);
  const { videoPrompt, warnings } = writePrompt(input);
  assert.match(videoPrompt, /@图片2是第1套衣服（0-4秒穿）/);
  assert.match(videoPrompt, /身穿【衣服 2 用文字】[\s\S]*身穿【衣服 3 用文字】/);
  assert.match(videoPrompt, /11-12秒：人物身穿@图片2的衣服/, '隔一段穿回的同一套照旧用那张图');
  assert.doesNotMatch(videoPrompt, /棒球套装|黑色直筒长裤|第2套衣服|第3套衣服/, '不抄原片描述，也不留光秃秃的称呼');
  assert.equal(warnings.some(text => text.includes('棒球棒')), false, '用文字的东西不进「底稿没写」的提醒');
  assert.ok(checkRules({ ...input, videoPrompt }).includes('提示词里还有占位「【衣服 2 用文字】」，要写成这一段的画面描述。'));
  const done = videoPrompt.replaceAll('【衣服 2 用文字】', '黄色篮球背心和短裤').replaceAll('【衣服 3 用文字】', '黑色无袖上衣、黑色直筒长裤');
  assert.deepEqual(checkRules({ ...input, videoPrompt: done }), [], '「跟原来一样」照原片写，不算照抄原描述');
  const { itemTexts: _texts, ...plain } = input;
  assert.ok(checkRules({ ...plain, videoPrompt: done }).some(text => text.includes('黑色直筒长裤')), '没写字的要换项照旧查原描述');
  assert.equal('itemTexts' in checkPromptInput(body([person('@图片1'), cloth('@图片2', 'C1', 1)])), false);
});

test('剪掉一张衣服卡（没用文字）：素材分工句和时间轴用同一套编号，不会两套都叫第 2 套', () => {
  const { videoPrompt } = writePrompt(checkPromptInput(body([person('@图片1'), cloth('@图片2', 'C1', 1), cloth('@图片3', 'C3', 3)])));
  assert.match(videoPrompt, /@图片3是第3套衣服（8-10秒穿）/);
  assert.match(videoPrompt, /4-5秒：[^\n]*随后身穿第2套衣服/);
});

test('占位的号由小服务自己排：页面传来的卡名排得不一样，也不会和分工句、时间轴撞号；回显换回页面的卡名', () => {
  // 11-17 审查：衣服 1 的卡被删（要换、没图没字），页面曾把衣服 2 那张叫成「衣服 1」，底稿里「第1套衣服」和「【衣服 1 用文字】」指了两套。
  const deleted = checkPromptInput(body([person('@图片1'), cloth('@图片2', 'C3', 2)], [{ ...yellow, title: '衣服 1' }]));
  assert.deepEqual(deleted.itemTexts, [{ ...yellow, title: '衣服 2', cardTitle: '衣服 1' }]);
  const first = writePrompt(deleted).videoPrompt;
  assert.match(first, /0-4秒：人物身穿第1套衣服。/);
  assert.match(first, /随后身穿【衣服 2 用文字】/);
  assert.match(first, /@图片2是第3套衣服（8-10秒穿）/);
  assert.doesNotMatch(first, /【衣服 1 用文字】/);
  assert.deepEqual(sceneReadsOf(deleted.itemTexts, [{ title: '衣服 2', read: '黄色背心' }]), [{ title: '衣服 1', text: yellow.text, read: '黄色背心' }]);
  // 衣服都跟原片（不在要换名单）：衣服 1 的卡只剪线，衣服 2 用文字，衣服 3 连图。小服务不数衣服 1，占位和图各用各的号。
  const kept = checkPromptInput({ ...body([person('@图片1'), cloth('@图片2', 'C3', 3)], [yellow], { keepClothes: true }), plan: { ...plan, replace: ['P1'] } });
  assert.equal(kept.itemTexts[0].title, '衣服 1');
  const second = writePrompt(kept).videoPrompt;
  assert.match(second, /@图片2是第2套衣服（8-10秒穿）/);
  assert.match(second, /【衣服 1 用文字】/);
  assert.doesNotMatch(second, /【衣服 2 用文字】/);
});

test('衣服全用文字：不穿人物图那身，深度那句照旧不采用衣服轮廓；跟原片的衣服（不在要换名单）也写占位', () => {
  const texts = [{ title: '衣服 1', itemId: 'C1', text: '黑色小礼服' }, yellow, same];
  const all = writePrompt(checkPromptInput(body([person('@图片1')], texts))).videoPrompt;
  assert.match(all, /@图片1是人物：只采用脸、发型和身材，不采用图中的衣服和背景/);
  assert.match(all, /0-4秒：人物身穿【衣服 1 用文字】[\s\S]*11-12秒：人物身穿【衣服 1 用文字】/, '隔一段穿回共用一个占位');
  const keptPlan = { ...plan, replace: ['P1'] };
  const depth = { tag: '@视频1', purpose: '深度，参考机位、动作、空间和遮挡节奏', asset };
  const keptBody = texts => ({ ...body([person('@图片1'), cloth('@图片2', 'C1', 1), depth], texts, { keepClothes: true }), plan: keptPlan });
  const kept = writePrompt(checkPromptInput(keptBody([yellow]))).videoPrompt;
  assert.match(kept, /身穿【衣服 2 用文字】/); assert.doesNotMatch(kept, /棒球套装/);
  assert.match(kept, /不采用其中的灰度画面、发型和衣服轮廓/, '有衣服改用文字，深度里那套的轮廓不能再采用');
  assert.match(writePrompt(checkPromptInput(keptBody())).videoPrompt, /不采用其中的灰度画面、发型；/, '没有用文字的衣服时照旧不排除衣服轮廓');
  assert.match(kept, /高尔夫套装/, '没写字的跟原片衣服照旧写原描述');
});

test('检查 itemTexts：空字、太长、对不上、人物 / 场景不行、同一项两次、同时连着图都拦', () => {
  const materials = [person('@图片1'), cloth('@图片2', 'C1', 1)];
  const fail = (rows, pattern) => assert.throws(() => checkItemTexts(rows, plan, materials), pattern);
  fail([{ ...yellow, text: '  ' }], /衣服 2 选了用文字，还没写字/);
  fail([{ ...yellow, text: '裙'.repeat(301) }], /最多 300 个/);
  fail([{ ...yellow, itemId: 'C9' }], /对不上拆解单里的衣服或东西/);
  fail([{ title: '人物', itemId: 'P1', text: '换个人' }], /对不上拆解单里的衣服或东西/);
  fail([yellow, { ...yellow, title: '衣服 9' }], /写了两次字/);
  fail([{ title: '衣服 1', itemId: 'C1', text: '黑色小礼服' }], /同时有图和字，留一样/);
  fail([{ itemId: 'C2', text: '黄色' }], /缺了卡名/);
  fail('黄色', /格式不对/);
  assert.deepEqual(checkItemTexts(undefined, plan, materials), []);
});

test('卡片要求：衣服卡写谁穿、管哪几秒（含隔一段穿回）、截这套衣服的 frame；东西卡不截图', () => {
  const rows = itemTextRows([{ title: '衣服 1', itemId: 'C1', text: '黑色小礼服' }, bat], plan, 12);
  assert.match(rows[0].file, /^衣服1_原片[\d.]+s\.jpg$/); assert.equal(rows[0].second, plan.items.find(item => item.id === 'C1').frame);
  assert.equal(rows[1].file, undefined);
  const note = itemTextNote(rows, plan);
  assert.match(note, /衣服 1（衣服卡，人物 P1 穿，管 0-4 秒 和 10-12 秒，拆解单 C1 \/ C4）：用户写「黑色小礼服」。原片截图：衣服1_原片/);
  assert.match(note, /道具（东西卡，拆解单 D1，原片里 0-12 秒）：用户写「换成银色的金属球棒」。没有单独截图/);
  assert.doesNotMatch(itemTextRows([{ ...yellow, title: '..\\..\\外面' }], plan, 12)[0].file, /[\\/:]|^\./);
});

const sheets = calls => ({ frames: async ({ source, folder }, times) => { calls.push({ source, times }); mkdirSync(folder, { recursive: true });
  return times.map((_, i) => { writeFileSync(join(folder, `f-${i}.jpg`), Buffer.from([i])); return `f-${i}.jpg`; }); },
contact: async ({ folder }, options) => { mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, 'c.jpg'), Buffer.from([1])); return [{ name: 'c.jpg', from: 0, to: options.end }]; } });
const finalInput = folder => ({ kind: 'person', draft: '@图片1是人物。\n0-12秒：人物身穿【衣服 2 用文字】。', folder, duration: 12, userText: '换', plan, warnings: [],
  materials: [{ tag: '@图片1', purpose: '人物', image: { name: '图片1_人物.jpg', buffer: Buffer.from([9]) } }],
  itemTexts: itemTextRows([yellow, bat], plan, 12), sourceVideo: { path: 'S0.mp4' } });
const reply = (prompt, unfixable = []) => ({ text: JSON.stringify({ prompt, changes: [], unfixable, sceneReads: [{ title: '衣服 2', read: '黄色篮球背心和短裤，不戴帽子' }] }) });
const good = reply('@图片1是人物。\n0-12秒：人物身穿黄色篮球背心和短裤，手里拿着银色金属球棒。');

test('定稿：多给补充说明、卡片要求.txt 和衣服截图；失败重跑一次，再不行报错不退底稿', async () => {
  const frames = [], calls = [];
  const result = await finalizePrompt(finalInput(tempDir()), { call: async input => { calls.push(input); return good; }, sheets: sheets(frames), rules: () => [] });
  assert.equal(result.finalized, true); assert.deepEqual(result.sceneReads, [{ title: '衣服 2', read: '黄色篮球背心和短裤，不戴帽子' }]);
  assert.match(calls[0].system, /补充（卡片改用文字）[\s\S]*占位「【… 用文字】」必须全部换成画面描述[\s\S]*补的这句不带秒数[\s\S]*"sceneReads"/);
  assert.doesNotMatch(calls[0].system, /补充（背景卡改用文字）/);
  const names = calls[0].files.map(file => file.name);
  assert.ok(names.includes('卡片要求.txt') && names.some(name => /^衣服2_原片[\d.]+s\.jpg$/.test(name)), names.join(','));
  assert.equal(names.filter(name => /^道具/.test(name)).length, 0, '东西卡不截图');
  assert.ok(frames.some(row => row.source === 'S0.mp4' && row.times[0] === plan.items.find(item => item.id === 'C2').frame), JSON.stringify(frames));
  let n = 0;
  await assert.rejects(finalizePrompt(finalInput(tempDir()), { call: async () => { n++; throw Error('断线'); }, sheets: sheets([]), rules: () => [] }),
    /卡上的字这次没写进去（本机 agent 定稿没成功（断线））/);
  assert.equal(n, 2);
});

test('11-16 实测坑：第一轮过不了规则重跑第二轮，第一轮列的「改字解决不了」要留着', async () => {
  let n = 0;
  const call = async () => ++n === 1 ? reply('第一轮', [{ what: '帽子轮廓压不住', evidence: '深度图', fix: '换白模' }]) : reply('第二轮', [{ what: '帽子轮廓压不住' }, { what: '新发现' }]);
  const result = await finalizePrompt(finalInput(tempDir()), { call, sheets: sheets([]), rules: prompt => prompt === '第一轮' ? ['坏'] : [] });
  assert.equal(result.finalized, true); assert.equal(result.videoPrompt, '第二轮');
  assert.deepEqual(result.unfixable.map(row => row.what), ['帽子轮廓压不住', '新发现']);
  assert.equal(result.unfixable[0].fix, '换白模');
});

test('假模式：衣服占位换成原话，东西卡的原话接在第一段末尾', () => {
  const text = fakeItemTexts('@图片1是人物。\n0-4秒：人物身穿【衣服 2 用文字】。\n4-12秒：人物身穿【衣服 2 用文字】。', [yellow, bat], plan);
  assert.equal(text, '@图片1是人物。\n0-4秒：人物身穿（用户写：换成黄色篮球背心和短裤，帽子不要了），道具（用户写：换成银色的金属球棒）。\n4-12秒：人物身穿（用户写：换成黄色篮球背心和短裤，帽子不要了）。');
});

const routeBody = (s, itemTexts = [yellow, same, bat]) => ({ cardId: 'rewrite-1', plan, duration: 12, ratio: '9:16', userText: '人和衣服换成我的',
  materials: s.images([{ tag: '@图片1', purpose: '人物', itemId: 'P1', originalDesc: '女生' }, { tag: '@图片2', purpose: '衣服 1', itemId: 'C1', originalDesc: '休闲套装，白色短袖' }]),
  itemTexts, source: s.upload(12), settings: { model: 'doubao-seedance-2-5-260628', ratio: '9:16', resolution: '480p', duration: 12, audio: false } });

test('接口：本机 Claude 拿到卡上的字定稿并回每张卡的理解；两次都坏报错；假模式换成原话；空字拦', async t => {
  const logout = fakeClaudeLogin(); t.after(logout);
  const bin = join(tempDir(), 'claude.exe'); writeFileSync(bin, '');
  const calls = []; let broken = false;
  const claude = async input => {
    calls.push(input);
    if (!String(input.system ?? '').startsWith('你是 Seedance 2.5「视频复刻」的提示词定稿员')) {
      return { text: JSON.stringify({ people: [{ tag: '@图片1', views: 1, plainClothes: false, clothes: '', hair: '黑短发' }] }), model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: 1 } };
    }
    const draft = input.files.find(file => file.name === '底稿.txt').buffer.toString();
    const prompt = draft.replaceAll('【衣服 2 用文字】', '黄色篮球背心和短裤').replaceAll('【衣服 3 用文字】', '黑色无袖上衣、黑色直筒长裤');
    return { text: broken ? '不是 JSON' : JSON.stringify({ prompt, changes: [], unfixable: [], sceneReads: [{ title: '衣服 2', read: '黄色篮球背心和短裤' }, { title: '道具', read: '银色金属球棒' }] }),
      model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: 1 } };
  };
  const s = setup({ fake: false, readEnv: () => ({ CLAUDE_CLI: bin }), claude });
  const written = await s.call('POST', '/api/video-rewrite/prompt', routeBody(s));
  assert.equal(written.status, 200, JSON.stringify(written.json));
  assert.equal(written.json.finalized, true); assert.deepEqual(written.json.issues, []);
  assert.match(written.json.videoPrompt, /黄色篮球背心和短裤[\s\S]*黑色直筒长裤/); assert.doesNotMatch(written.json.videoPrompt, /用文字】/);
  assert.deepEqual(written.json.sceneReads, [{ title: '衣服 2', text: yellow.text, read: '黄色篮球背心和短裤' }, { title: '衣服 3', text: same.text, read: '（没说怎么理解）' },
    { title: '道具', text: bat.text, read: '银色金属球棒' }]);
  const names = calls.at(-1).files.map(file => file.name);
  assert.ok(names.includes('卡片要求.txt') && names.some(name => /^衣服2_原片[\d.]+s\.jpg$/.test(name)) && !names.includes('背景卡要求.txt'), names.join(','));

  broken = true; const before = calls.length;
  const failed = await s.call('POST', '/api/video-rewrite/prompt', routeBody(s));
  assert.equal(failed.status, 502); assert.match(failed.json.error, /卡上的字这次没写进去.*再点一次「生成提示词」/);
  assert.equal(calls.length - before, 3, '看一次人物图 + 定稿两次');

  const f = setup(), fake = await f.call('POST', '/api/video-rewrite/prompt', routeBody(f));
  assert.equal(fake.status, 200, JSON.stringify(fake.json));
  assert.match(fake.json.videoPrompt, /身穿（用户写：换成黄色篮球背心和短裤，帽子不要了）/); assert.match(fake.json.videoPrompt, /道具（用户写：换成银色的金属球棒）/);
  assert.doesNotMatch(fake.json.videoPrompt, /用文字】/);
  assert.equal(fake.json.sceneReads.length, 3); assert.equal(fake.json.sceneReads[0].read, FAKE_SCENE_READ);
  const empty = await f.call('POST', '/api/video-rewrite/prompt', routeBody(f, [{ ...yellow, text: '' }]));
  assert.equal(empty.status, 400); assert.match(empty.json.error, /衣服 2 选了用文字，还没写字/);
});
