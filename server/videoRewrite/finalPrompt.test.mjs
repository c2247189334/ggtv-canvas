import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { finalFiles, finalizePrompt, finalSystem, frameTimes, modelLabel, parseFinal, resolveFinalMaterials } from './finalPrompt.mjs';
import { tempDir } from '../testKit.mjs';
import { createPromptImages } from './promptImages.mjs';
import { createUploadStore } from '../store/uploads.mjs';
import { createWorkStore } from '../store/works.mjs';
import { solidPng } from '../png.mjs';

const sheetsStub = (calls, contacts = []) => ({ frames: async ({ source, folder }, times, options) => { calls.push({ source, folder, times, options }); mkdirSync(folder, { recursive: true });
  return times.map((_, i) => { writeFileSync(join(folder, `frame-${i}.jpg`), Buffer.from([i])); return `frame-${i}.jpg`; }); },
  contact: async ({ source, folder }, options) => { contacts.push({ source, options }); const name = `${options.prefix}-0.jpg`; writeFileSync(join(folder, name), Buffer.from([7]));
    return [{ name, from: options.start ?? 0, to: Math.round((options.end - (options.step ?? 0.5)) * 10) / 10 }]; } });
const reply = body => ({ text: JSON.stringify(body), model: 'claude-sonnet-5-5', elapsedMs: 5, usage: { input_tokens: 1, output_tokens: 1 } });
const person = (folder, extra = {}) => ({ kind: 'person', draft: '@图像1是人物：画面里只出现这一个人。\n0-7秒：人物。', folder, duration: 6.6, userText: '人物换掉',
  plan: { items: [{ id: 'P1', kind: '人物', desc: '年轻女生' }], replace: ['P1'] }, warnings: ['拆解没把握：猫'],
  settings: { model: 'doubao-seedance-2-5-260628', ratio: '9:16', resolution: '480p', audio: false },
  materials: [{ tag: '@图片1', purpose: '人物', image: { name: '图片1_人物.jpg', buffer: Buffer.from([9]) } },
    { tag: '@视频1', purpose: '深度，参考机位、动作', video: { path: 'D.mp4', seconds: 6.6, source: { path: 'S.mp4', seconds: 6.6 } } }], ...extra });

test('抽帧时刻 6～10 个、从 0 均分到结尾；模型编号转成人话', () => {
  assert.deepEqual(frameTimes(6.6), [0, 1.3, 2.6, 4, 5.3, 6.5]);
  assert.equal(frameTimes(15).length, 10); assert.equal(frameTimes(15).at(-1), 14.9); assert.equal(frameTimes(30).length, 10);
  assert.equal(modelLabel('doubao-seedance-2-5-260628'), 'Seedance 2.5'); assert.equal(modelLabel('doubao-seedance-2-0-mini-260615'), 'Seedance 2.0 Mini');
  assert.equal(modelLabel('doubao-seedance-2-0-260128'), 'Seedance 2.0 Pro');
});

test('系统提示：人物改写和拆解（无人物）各用自己的清单，共用官方规则；秒数填进时间轴要求', () => {
  const people = finalSystem('person', 17), product = finalSystem('product', 15);
  assert.match(people, /只算一个人/); assert.match(people, /衣服图里的假发不采用/); assert.match(people, /换白模/); assert.doesNotMatch(people, /商品实物照/);
  // 11-11 用户定：配件默认照衣服图穿戴；动作看每 0.5 秒连拍、没看到的不写；转场看换点前后连拍。
  assert.match(people, /鞋、袜子、手套、首饰这些穿戴的东西照图穿戴（衣服图是用户挑好的样子，原片同时段没有也照图）/);
  assert.match(people, /只写连拍里连续两帧以上看得清的动作/); assert.match(people, /连拍里没看到的动作不写/); assert.match(people, /转场方式照它写/);
  assert.match(product, /商品外观只照商品实物照/); assert.match(product, /数量和摆位/); assert.doesNotMatch(product, /换白模/);
  for (const text of [people, product]) {
    assert.match(text, /最后一段到 \d+ 秒/); assert.match(text, /只许写「不要字幕」/); assert.match(text, /编辑视频、增加、加上、删除、去掉、修改、替换、改成/);
    assert.match(text, /"prompt":"定稿全文/); assert.match(text, /原样输出底稿/);
  }
  assert.match(people, /最后一段到 17 秒/); assert.match(product, /最后一段到 15 秒/);
});

test('11-10 用户定统一按官方 2.5 写：四块结构、转场、概括动作、负向只用于字幕和声音、前后不矛盾；深度 / 白模要写每段内容只在人物改写清单', () => {
  const people = finalSystem('person', 12), product = finalSystem('product', 12);
  for (const text of [people, product]) {
    assert.match(text, /Seedance 2\.5 提示词指南/);
    assert.match(text, /①素材指代[\s\S]*②一句话概述[\s\S]*③时间轴[\s\S]*④结尾：只写贯穿全片不变的东西/);
    assert.match(text, /转场：写清在哪一秒、怎么转/);
    assert.match(text, /动作用概括说法/);
    assert.match(text, /不写「无字母、无商标、无图案、不出现…」/);
    assert.match(text, /前后不能矛盾/);
    assert.doesNotMatch(text, /只改这些句子，其余一字不改/);
  }
  assert.match(people, /动作参考是深度视频或白模/); assert.match(people, /补全这个动作/);
  assert.doesNotMatch(product, /深度视频或白模/);
});

test('11-10 用户定：东西写不写以原片为准，动作参考帧（深度）只管动作、不当门槛；条件满足就写，被人拿着的写明在谁手里', () => {
  const people = finalSystem('person', 12);
  assert.match(people, /拆解单\.json（第一次看原片拆出来的结果[^）]*以原片抽帧为准）/);
  assert.match(people, /5\. 东西：写不写以原片抽帧和拆解单为准/);
  assert.match(people, /背景图里又没有，就在它出现的那段时间轴里加一句它是什么（名字和外观），被人拿着的写明在谁手里/);
  assert.doesNotMatch(people, /在动作参考帧里清楚可见|动作参考帧里看不见的东西一律不写|可以在它出现的那段/);
});

test('解析定稿：去代码围栏、只留短字段、空条目丢掉；没有 prompt 或不是 JSON 报人话', () => {
  const parsed = parseFinal('```json\n{"prompt":"  定稿\\r\\n第二行 ","changes":[{"before":"旧","after":"新","why":"  多  空格 ","evidence":"图1"},{"why":"只有理由"}],"unfixable":[{"what":"深度有辫子","fix":"换白模"},{"fix":"没写问题"}],"checked":"看了"}\n```');
  assert.deepEqual(parsed, { prompt: '定稿\n第二行', changes: [{ before: '旧', after: '新', why: '多 空格', evidence: '图1' }],
    unfixable: [{ what: '深度有辫子', evidence: '', fix: '换白模' }], checked: '看了' });
  assert.throws(() => parseFinal('我觉得没问题'), /不是 JSON：我觉得没问题/);
  assert.throws(() => parseFinal('{"prompt":"  ","changes":[]}'), /没有 prompt/);
});

test('解析素材引用：图片读成文件（名字去掉括号空格）、视频找路径带原片；原片就是这段视频时不重复给（拆解无人物）', async () => {
  const png = Buffer.from([1, 2, 3]);
  const promptImages = { prepare: async (pictures, options) => { assert.equal(options, undefined); return pictures.map(() => `data:image/jpeg;base64,${png.toString('base64')}`); } };
  const media = { checkSource: source => ({ path: `/v/${source.id}.mp4`, duration: source.id === 'clip' ? 9.7 : 6.6 }) };
  const materials = [{ tag: '@图片1', purpose: '背景' }, { tag: '@图片2', purpose: '衣服 2（3.8-7 秒穿）', asset: { type: 'work', id: 'p' } },
    { tag: '@视频1', purpose: '白模，参考人物动作', asset: { type: 'work', id: 'mesh' } }, { tag: '@音频1', purpose: '原声' }];
  const resolved = await resolveFinalMaterials(materials, { type: 'upload', id: 'clip' }, { promptImages, media });
  assert.deepEqual(resolved[0], materials[0]);
  assert.deepEqual(resolved[1].image, { name: '图片2_衣服23.8-7.jpg', buffer: png });
  assert.deepEqual(resolved[2].video, { path: '/v/mesh.mp4', seconds: 6.6, source: { path: '/v/clip.mp4', seconds: 9.7 } });
  assert.equal(resolved[3].video, undefined);
  const product = await resolveFinalMaterials([{ tag: '@视频1', purpose: '参考视频', asset: { type: 'upload', id: 'clip' } }], { type: 'upload', id: 'clip' }, { promptImages, media });
  assert.equal(product[0].video.source, null);
});

test('看图不设张数上限：15 张参考图照样都读成文件（11-08 婚礼 15 张图；11-15 起只走本机 agent，豆包的 12 张上限去掉）', async () => {
  const uploads = createUploadStore(tempDir()), works = createWorkStore(tempDir());
  const image = uploads.save(solidPng(10, 10, [100, 120, 140]));
  const executor = { run: async (_command, args) => writeFileSync(args.at(-1), Buffer.from([0xff, 0xd8])), stop() {} };
  const promptImages = createPromptImages({ uploads, works, executor });
  const materials = Array.from({ length: 15 }, (_, i) => ({ tag: `@图片${i + 1}`, purpose: '衣服', asset: { type: 'upload', id: image.id } }));
  const resolved = await resolveFinalMaterials(materials, null, { promptImages, media: {} });
  assert.equal(resolved.filter(row => row.image).length, 15);
  assert.equal(resolved[14].image.name, '图片15_衣服.jpg');
  assert.equal((await promptImages.prepare(materials)).length, 15);
});

test('交给 agent 的文件：参考图、动作参考和原片同一时刻的帧、底稿、素材表、拆解单、原话、提醒；拆解无人物只抽原片本身', async () => {
  const folder = tempDir(), frameCalls = [];
  const files = await finalFiles(person(folder), { sheets: sheetsStub(frameCalls) });
  const names = files.map(file => file.name);
  assert.deepEqual(names.slice(0, 2), ['图片1_人物.jpg', '视频1_0.0s.jpg']);
  for (const name of ['原片_6.5s.jpg', '底稿.txt', '素材表.txt', '拆解单.json', '用户原话.txt', '提醒.txt']) assert.ok(names.includes(name), `${name} 不在 ${names.join(',')}`);
  assert.deepEqual(frameCalls.map(c => [c.source, c.folder.slice(folder.length + 1), c.options]), [['D.mp4', 'ref-1', { maxSide: 720 }], ['S.mp4', 'source-1', { maxSide: 720 }]]);
  const table = files.find(file => file.name === '素材表.txt').buffer.toString();
  assert.match(table, /^@图片1：人物，文件 图片1_人物\.jpg\n@视频1：深度，参考机位、动作（动作参考，6\.6 秒），按时间抽帧：视频1_0\.0s\.jpg、/);
  assert.match(table, /它的原片（真人实拍，火山收不到它，只给你核对）同一时刻：原片_0\.0s\.jpg/);
  assert.equal(JSON.parse(files.find(file => file.name === '拆解单.json').buffer.toString()).replace[0], 'P1');
  assert.equal(files.find(file => file.name === '提醒.txt').buffer.toString(), '- 拆解没把握：猫');
  assert.ok(names.includes('原片连拍_0.0-6.1s.jpg'), names.join(','));
  assert.match(table, /原片连拍（每 0\.5 秒一帧，图上印着秒数；看快动作和动作先后用）：原片连拍_0\.0-6\.1s\.jpg/);
  assert.doesNotMatch(table, /换点前后/, '没有换装 / 换场点就不拍换点前后');
  const productFiles = await finalFiles({ ...person(tempDir()), kind: 'product', warnings: [], userText: '',
    materials: [{ tag: '@视频1', purpose: '参考视频', video: { path: 'S.mp4', seconds: 15, source: null } }] }, { sheets: sheetsStub([]) });
  assert.ok(!productFiles.some(file => file.name.startsWith('原片_')) && !productFiles.some(file => file.name === '提醒.txt'));
  assert.ok(!productFiles.some(file => file.name.startsWith('原片连拍')), '拆解无人物不加连拍');
  assert.match(productFiles.find(file => file.name === '素材表.txt').buffer.toString(), /参考视频（原片本身（火山也会收到它），15\.0 秒）/);
  assert.equal(productFiles.find(file => file.name === '用户原话.txt').buffer.toString(), '（没写）');
});

test('11-11 快动作和转场：原片整条每 0.5 秒连拍，换装点前后每 0.2 秒连拍（贴着开头结尾的不拍）', async () => {
  const contacts = [], plan = { items: [{ id: 'P1', kind: '人物', desc: '女生', from: 0, to: 6.6 },
    { id: 'C1', kind: '衣服', desc: '大衣', from: 0, to: 3 }, { id: 'C2', kind: '衣服', desc: '婚纱', from: 3, to: 6.6 }], replace: ['P1'], changes: [] };
  const files = await finalFiles(person(tempDir(), { plan }), { sheets: sheetsStub([], contacts) });
  assert.deepEqual(contacts.map(row => [row.source, row.options]), [['S.mp4', { end: 6.6, prefix: 'all' }],
    ['S.mp4', { start: 2.4, end: 3.8, step: 0.2, columns: 7, rows: 1, area: 240 * 427, prefix: 'change0' }]]);
  assert.ok(files.some(file => file.name === '换点前后_2.4-3.6s.jpg'), files.map(file => file.name).join(','));
  assert.match(files.find(file => file.name === '素材表.txt').buffer.toString(), /换装 \/ 换场点前后（每 0\.2 秒一帧，看转场怎么转）：换点前后_2\.4-3\.6s\.jpg/);
  const edge = { ...plan, items: [plan.items[0], { ...plan.items[1], to: 6.5 }, { ...plan.items[2], from: 6.5 }] }, late = [];
  await finalFiles(person(tempDir(), { plan: edge }), { sheets: sheetsStub([], late) });
  assert.equal(late.length, 1, '换装点离结尾不到 0.2 秒不拍');
});

test('定稿过了规则就用；第一轮过不了带着问题和上次定稿再改一次', async () => {
  const calls = [], good = '@图像1是人物：这些身影只算一个人。\n0-7秒：人物。';
  const rules = prompt => prompt.includes('只出现这一个人') || prompt.includes('坏') ? ['时间轴断了'] : [];
  const call = async input => { calls.push(input); return reply(calls.length === 1 ? { prompt: '坏稿', changes: [], unfixable: [] }
    : { prompt: good, changes: [{ before: '画面里只出现这一个人', after: '这些身影只算一个人', why: '两个人', evidence: '原片_6.5s' }], unfixable: [{ what: '深度有辫子', fix: '换白模' }], checked: '全看了' }); };
  const result = await finalizePrompt(person(tempDir()), { call, sheets: sheetsStub([]), model: 'sonnet', rules });
  assert.equal(result.videoPrompt, good); assert.equal(result.finalized, true); assert.deepEqual(result.issues, []); assert.equal(result.note, '');
  assert.equal(result.changes[0].after, '这些身影只算一个人'); assert.equal(result.unfixable[0].fix, '换白模'); assert.equal(result.checked, '全看了');
  assert.equal(calls.length, 2); assert.equal(calls[0].model, 'sonnet'); assert.equal(calls[0].timeoutMs, 600000);
  assert.equal(calls[0].system, finalSystem('person', 7));
  assert.match(calls[0].prompt, /^视频设置：Seedance 2\.5，参考模式，9:16，480p，7 秒，生成音频关。/);
  assert.equal(calls[1].files.at(-1).name, '上次定稿.txt'); assert.equal(calls[1].files.at(-1).buffer.toString(), '坏稿');
  assert.match(calls[1].prompt, /过不了程序检查，问题：时间轴断了。/);
});

test('两轮都过不了规则、agent 出错或回话坏：退回程序底稿并说清原因，改不了的问题照样带回', async () => {
  const draft = person(tempDir()).draft, rules = prompt => prompt === draft ? ['底稿也有的问题'] : prompt.includes('坏') ? ['时间轴断了'] : [];
  const bad = await finalizePrompt(person(tempDir()), { call: async () => reply({ prompt: '坏稿', unfixable: [{ what: '图画错了' }] }), sheets: sheetsStub([]), model: 'sonnet', rules });
  assert.equal(bad.videoPrompt, draft); assert.equal(bad.finalized, false); assert.deepEqual(bad.issues, ['底稿也有的问题']);
  assert.match(bad.note, /两次都没过程序检查（时间轴断了），先用程序底稿/); assert.equal(bad.unfixable[0].what, '图画错了');
  const broken = await finalizePrompt(person(tempDir()), { call: async () => { throw Error('Claude 超时'); }, sheets: sheetsStub([]), model: 'sonnet', rules: () => [] });
  assert.equal(broken.videoPrompt, draft); assert.equal(broken.finalized, false); assert.match(broken.note, /本机 agent 定稿没成功（Claude 超时）/);
  const garbled = await finalizePrompt(person(tempDir()), { call: async () => ({ text: '我看完了' }), sheets: sheetsStub([]), model: 'sonnet', rules: () => [] });
  assert.equal(garbled.finalized, false); assert.match(garbled.note, /不是 JSON/);
  const noFrames = await finalizePrompt(person(tempDir()), { call: async () => reply({ prompt: 'x' }), sheets: { frames: async () => { throw Error('ffmpeg 没了'); } }, model: 'sonnet', rules: () => [] });
  assert.equal(noFrames.finalized, false); assert.match(noFrames.note, /准备看图的文件没成功（ffmpeg 没了）/);
});
