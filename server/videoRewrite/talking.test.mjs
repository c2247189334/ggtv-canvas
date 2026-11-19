// 11-19「露脸 · AI 自己配音」小服务这边：读台词、铺空行、台词表校验、写进时间轴、一字不差检查、拆解多附字幕连拍。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from './analyze.mjs';
import { imageNames } from './claudeAsk.mjs';
import { checkPromptInput } from './input.mjs';
import { blankLines, checkLineTexts, lineIssues, readLines, validateLines } from './lines.mjs';
import { checkRules } from './rules.mjs';
import { createSheets } from './sheets.mjs';
import { DEFAULT_VOICE, SOUND_RULE } from './talkingPrompt.mjs';
import { writePrompt } from './writePrompt.mjs';
import { fakeRound } from './fake.mjs';
import { tempDir } from '../testKit.mjs';

const person = { id: 'P1', kind: '人物', desc: '女生，黑色长发', from: 0, to: 8.4, frame: 0 };
const lines = [{ id: 'L1', who: '镜头外', text: '哎一样的鞋你怎么还买两双啊', from: 0, to: 1.9 },
  { id: 'L2', who: 'P1', text: '哎我本来是给我妈买的', from: 2.1, to: 3.6 }, { id: 'L3', who: 'P1', text: '结果我试了一下', from: 3.6, to: 4.8 },
  { id: 'L4', who: 'P1', text: '哇真的太好穿了', from: 4.9, to: 6.1 }, { id: 'L5', who: 'P1', text: '这不果断又给自己买了一双', from: 6.2, to: 8.4 }];
const plan = { summary: '拆解：1个人', items: [person], replace: ['P1'], changes: [], actions: [], unsure: [], lines };
const materials = [{ tag: '@图片1', purpose: '人物', itemId: 'P1', originalDesc: person.desc, asset: { type: 'work', id: '5ccfd561-31a3-49c4-83e1-acdb1529275c' } },
  { tag: '@视频1', purpose: '深度，参考机位、动作、空间和遮挡节奏', asset: { type: 'work', id: '80d7c339-a57b-4b07-a248-aeedfc9b93f6' } }];
const input = { cardId: 'c1', plan, materials, duration: 8, sourceDuration: 8.4, ratio: '9:16', userText: '人物换成我的', talking: true, lines };

test('读台词回话：字去掉大括号、秒数是字符串也认、越界夹回、结束不晚于开始补 1 秒；谁说认不出时一个人就算他并记没把握；空字丢掉、按时间排', () => {
  const read = readLines([{ who: 'P1', text: '{第二句}', from: '3', to: '2' }, { who: '老板', text: '第一句', from: -1, to: 2 }, { who: 'P1', text: '  ', from: 5, to: 6 }, '坏'], 8.4, ['P1']);
  assert.deepEqual(read.lines, [{ id: 'L1', who: 'P1', text: '第一句', from: 0, to: 2 }, { id: 'L2', who: 'P1', text: '第二句', from: 3, to: 4 }]);
  assert.match(read.notes[0], /「第一句」是谁说的没认准，先算出镜的人/);
  assert.equal(readLines([{ who: '?', text: '谁', from: 1, to: 2 }], 8.4, ['P1', 'P2']).lines[0].who, '镜头外');
});

test('没认出字幕：按人声时段铺空行；一段人声都没有就一行管全片', () => {
  assert.deepEqual(blankLines([[0.2, 1.9], [2.1, 8.4]], 8.4, 'P1'), [{ id: 'L1', who: 'P1', text: '', from: 0.2, to: 1.9 }, { id: 'L2', who: 'P1', text: '', from: 2.1, to: 8.4 }]);
  assert.deepEqual(blankLines([], 8.4, '镜头外'), [{ id: 'L1', who: '镜头外', text: '', from: 0, to: 8.4 }]);
});

test('台词表校验：谁说要是人物或镜头外、秒数在时长内、不带大括号；生成提示词时不许有空句、至少一句；检查接口只认 [{ text }]', () => {
  assert.doesNotThrow(() => validateLines(plan, 8.4));
  for (const bad of [{ who: 'P9' }, { from: 9 }, { text: '{台词}' }, { id: 'L2' }]) {
    assert.throws(() => validateLines({ ...plan, lines: [{ ...lines[0], ...bad }, lines[1]] }, 8.4), /台词表不对/);
  }
  assert.throws(() => validateLines({ ...plan, lines: [{ ...lines[0], text: '' }] }, 8.4, { allowBlank: false }), /没填字/);
  assert.throws(() => checkPromptInput({ ...input, plan: { ...plan, lines: [] } }), /台词表是空的/);
  const checked = checkPromptInput({ ...input, voice: ' {年轻}男声 ' });
  assert.deepEqual([checked.talking, checked.voice, checked.lines.length], [true, '年轻男声', 5]);
  assert.equal(checkPromptInput({ ...input, talking: undefined }).talking, undefined);
  assert.deepEqual(checkLineTexts([{ text: 'a', who: 'x' }]), [{ text: 'a' }]);
  assert.throws(() => checkLineTexts([{ text: 1 }]), /格式不对/);
});

test('写词：开头声音约束，时间轴在台词开始处切开（每段至少 2 秒），台词放进 {}，镜头外说话时人闭着嘴听；结尾嗓音 + 嘴型同步 + 不要音乐；过免费检查', () => {
  const result = writePrompt(input);
  const rows = result.videoPrompt.split('\n');
  assert.equal(rows[0], SOUND_RULE);
  const timeline = rows.filter(row => /^\d+-\d+秒：/.test(row));
  assert.deepEqual(timeline.map(row => row.match(/^(\d+-\d+)秒/)[1]), ['0-2', '2-4', '4-6', '6-8']);
  assert.match(timeline[0], /@图片1闭着嘴听，镜头外不出镜的人说：\{哎一样的鞋你怎么还买两双啊\}/);
  // 每句按开始秒四舍五入归段：3.6 秒开始的「结果我试了一下」归 4-6 秒。
  assert.match(timeline[1], /^2-4秒：@图片1对镜头说：\{哎我本来是给我妈买的\}。$/);
  assert.match(timeline[2], /^4-6秒：@图片1对镜头说：\{结果我试了一下\}，@图片1对镜头说：\{哇真的太好穿了\}。$/);
  assert.match(rows.at(-1), new RegExp(`^@图片1说话的声音是${DEFAULT_VOICE}。@图片1说每一句台词时嘴型和声音同步，吐字清晰，台词一字不差。镜头外的人说话时，画面里的人闭着嘴听。音频只保留说话人声和轻微的现场环境声，不要音乐、背景音乐、BGM、配乐、旋律。全程同一个人、同一个场景和光线，不要字幕。$`));
  assert.deepEqual(checkRules({ ...input, ...result, changeSeconds: [] }), []);
  assert.match(writePrompt({ ...input, voice: '清亮的年轻男声' }).videoPrompt, /@图片1说话的声音是清亮的年轻男声。/);
  // 不是说话版：一字不变（没有声音约束、没有 {}）。
  const silent = writePrompt({ ...input, talking: undefined, plan: { ...plan, lines: undefined } }).videoPrompt;
  assert.doesNotMatch(silent, /声音约束|\{/);
});

test('一字不差检查：漏一句、多一句、写两遍、先后反了都报；标点空格不算；{} 里的「改成」「字幕」不当成指令', () => {
  const ok = '0-8秒：说：{哎，一样的鞋}，又说：{我本来 是给我妈买的}。不要字幕。';
  const two = [{ text: '哎一样的鞋' }, { text: '我本来是给我妈买的' }];
  assert.deepEqual(lineIssues(ok, two), []);
  assert.match(lineIssues('0-8秒：{哎一样的鞋}。', two)[0], /台词「我本来是给我妈买的」没原样写进提示词/);
  assert.match(lineIssues(`${ok}{多的}`, two)[0], /\{多的\} 不在台词表里/);
  assert.match(lineIssues(`${ok}{哎一样的鞋}`, two)[0], /写了两遍/);
  assert.match(lineIssues('0-8秒：{我本来是给我妈买的}{哎一样的鞋}。', two)[0], /先后/);
  const words = checkRules({ videoPrompt: '0-8秒：@图片1对镜头说：{我把颜色改成了白的，字幕上也有}。不要字幕。', materials: [{ tag: '@图片1', purpose: '人物' }],
    duration: 8, changeSeconds: [], lines: [{ text: '我把颜色改成了白的，字幕上也有' }] });
  assert.deepEqual(words.filter(issue => /改成|字幕/.test(issue)), []);
});

test('拆解说话版：多附字幕连拍、带人声时段、多问 lines，台词进改写单；没认出字幕按人声时段铺空行并提醒', async () => {
  const folder = tempDir('talk-analyze-');
  writeFileSync(join(folder, 'timeline-0.jpg'), 'jpeg');
  const asks = [], contacts = [];
  const sheets = { timeline: async () => ['timeline-0.jpg'], cuts: async () => [],
    frames: async (_input, times) => times.map((_, i) => { writeFileSync(join(folder, `frame-${i}.jpg`), 'jpeg'); return `frame-${i}.jpg`; }),
    contact: async (_input, options) => { contacts.push(options); writeFileSync(join(folder, 'subtitle-0.jpg'), 'jpeg'); return [{ name: 'subtitle-0.jpg', from: 0, to: 5.5 }, { name: 'subtitle-0.jpg', from: 6, to: 8 }]; },
    speech: async () => [[0.2, 1.9], [2.1, 8.4]], peak: async () => 200 };
  const ask = async request => { asks.push(request); return fakeRound(request); };
  const base = { source: 'clip', folder, duration: 8.4, ratio: '9:16', width: 720, height: 1280, talking: true };
  const result = await analyze({ ...base, userText: '人物换成我的' }, { sheets, ask });
  assert.equal(asks[0].images.length, 1 + 6 + 2);
  assert.match(asks[0].text, /再附2张字幕连拍（依次是0～5\.5秒、6～8秒/); assert.match(asks[0].text, /⑥lines/);
  assert.deepEqual(asks[0].context.speech, [[0.2, 1.9], [2.1, 8.4]]);
  assert.deepEqual(contacts[0], { end: 8.4, step: 0.5, columns: 4, rows: 3, area: 360 * 640, prefix: 'subtitle' });
  assert.deepEqual(imageNames('analyze', 9, asks[0].text).slice(-3), ['清楚大图-6.jpg', '字幕连拍-1.jpg', '字幕连拍-2.jpg']);
  assert.deepEqual(result.plan.lines.map(line => [line.who, line.text]), [['镜头外', '哎一样的东西你怎么买两个'], ['P1', '我本来是给我妈买的'], ['P1', '结果自己试了一下真的太好用了']]);
  const blank = await analyze({ ...base, userText: '假无字幕' }, { sheets, ask });
  assert.deepEqual(blank.plan.lines.map(line => [line.text, line.from, line.to]), [['', 0.2, 1.9], ['', 2.1, 8.4]]);
  assert.ok(blank.plan.unsure.some(text => text.includes('没认出字幕')));
  const silent = await analyze({ ...base, talking: undefined, userText: '人物换成我的' }, { sheets, ask });
  assert.equal(silent.plan.lines, undefined); assert.doesNotMatch(asks.at(-1).text, /字幕连拍|lines/);
});

test('量人声：把 silencedetect 的安静段反过来，丢掉短于 0.3 秒的；读不出（没声音轨）回空', async () => {
  const stderr = '[silencedetect] silence_start: 0\n[silencedetect] silence_end: 0.21 | silence_duration: 0.21\n[silencedetect] silence_start: 1.9\n'
    + '[silencedetect] silence_end: 2.1\n[silencedetect] silence_start: 3.0\n[silencedetect] silence_end: 3.1\n[silencedetect] silence_start: 3.2\n';
  const sheets = createSheets({ executor: { run: async () => ({ stderr }), stop: () => {} } });
  assert.deepEqual(await sheets.speech({ source: 'clip' }, 8.4), [[0.21, 1.9], [2.1, 3]]);
  const broken = createSheets({ executor: { run: async () => { throw Error('没有声音轨'); }, stop: () => {} } });
  assert.deepEqual(await broken.speech({ source: 'clip' }, 8.4), []);
});

test('第二期声音样本：@音频 用途是「音色」时写「@图片1使用@音频1的音色说话」（官方 2.5 指南第 188 行），不当背景音乐；过免费检查；定稿写成背景音乐就打回', () => {
  const voice = { tag: '@音频1', purpose: '音色，阿青说话的声音样本', asset: { type: 'work', id: '9a1b2c3d-1111-4222-8333-444455556666' } };
  const withVoice = { ...input, materials: [...materials, voice], voice: '清亮的年轻男声' };
  const result = writePrompt(withVoice);
  const rows = result.videoPrompt.split('\n');
  assert.ok(rows.includes('@音频1是@图片1的声音样本：@图片1使用@音频1的音色说话；只采用@音频1的音色，不采用其中说的话和背景声。'), result.videoPrompt);
  assert.doesNotMatch(result.videoPrompt, /@音频1是背景音乐/);
  assert.ok(rows.indexOf(rows.find(row => row.startsWith('@音频1'))) < rows.findIndex(row => /^\d+-\d+秒：/.test(row)), '素材句在时间轴前');
  assert.deepEqual(checkRules({ ...withVoice, ...result, changeSeconds: [] }), []);
  const asMusic = result.videoPrompt.replace(/@音频1是@图片1的声音样本：[^\n]+/, '@音频1是背景音乐，动作节奏跟随它。');
  assert.ok(checkRules({ ...withVoice, videoPrompt: asMusic, changeSeconds: [] }).some(issue => /@音频1是人物的声音样本/.test(issue)));
  // 原声卡（不是声音样本）照旧当背景音乐。
  const music = writePrompt({ ...input, materials: [...materials, { ...voice, purpose: '原声，作为背景音乐和节奏参考' }] }).videoPrompt;
  assert.match(music, /@音频1是背景音乐/);
});

// 11-19 上传前审查：片长小数不整齐（8.466667 秒）时，先夹再四舍五入会把片尾进成 8.5，超出片长，整张台词表被自己的校验打回。
test('片长不整齐时台词秒数不超出片长；字幕两行的换行并成一行', () => {
  const duration = 8.466667, items = [{ id: 'P1', kind: '人物' }];
  const { lines } = readLines([{ who: 'P1', text: '第一行\n第二行', from: 7.9, to: 8.466667 }, { who: 'P1', text: '尾巴', from: 8.46, to: 99 }], duration, ['P1']);
  assert.equal(lines.length, 2);
  for (const line of lines) assert.ok(line.from < line.to && line.to <= duration, JSON.stringify(line));
  assert.equal(lines[0].text, '第一行 第二行');
  assert.doesNotThrow(() => validateLines({ items, lines }, duration));
  for (const blank of [blankLines([[7, 8.466667]], duration, 'P1'), blankLines([], duration, 'P1')]) {
    assert.ok(blank.every(line => line.from < line.to && line.to <= duration), JSON.stringify(blank));
    assert.doesNotThrow(() => validateLines({ items, lines: blank }, duration));
  }
});
