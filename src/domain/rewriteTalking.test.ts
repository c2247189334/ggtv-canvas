// 11-19「露脸 · AI 自己配音」页面这边：台词表增删改、开始改写建的卡、存档读回、写词请求和拦截、面板提醒。
import { expect, it } from 'vitest';
import { cardCounter, newCard, newVideoCard } from './cards';
import { readCard } from './canvasDoc';
import { addLine, editLine, lineSpeakers, removeLine, talkingLinesProblem } from './rewriteLines';
import { prepareRewriteCards, rewriteVideoHints, startVideoRewrite } from './videoRewrite';
import { lookPromptProblem, lookPromptRequest } from './rewritePrompt';
import type { AssetRef, CardData, CardNode, VideoCardData } from '@/types';
import type { RewritePlan } from '@/videoRewriteTypes';

const asset: AssetRef = { type: 'upload', id: 'source', media: 'video', seconds: 8.4, width: 720, height: 1280, hasAudio: true };
const node = (id: string, data: CardData): CardNode => ({ id, type: 'card', data, position: { x: 0, y: 0 } });
const plan: RewritePlan = { summary: '口播', items: [{ id: 'P1', kind: '人物', desc: '女生，长发', from: 0, to: 8.4, frame: 1 }], replace: ['P1'],
  changes: [], actions: [], unsure: [], lines: [
    { id: 'L1', who: '镜头外', text: '一样的鞋你怎么买两双', from: 0, to: 1.9 },
    { id: 'L2', who: 'P1', text: '我本来是给我妈买的', from: 2.1, to: 4 }] };
let serial = 0;
const makeId = () => `id${++serial}`;

it('台词表：谁说列出人物和镜头外；改字去掉大括号、改秒数夹在时长里并重排；加一句接在最后一句后面；删一句', () => {
  expect(lineSpeakers(plan)).toEqual([{ id: 'P1', label: '出镜的人' }, { id: '镜头外', label: '镜头外' }]);
  expect(editLine(plan, 'L1', { text: '{哎}一样的鞋' }, 8.4).lines![0].text).toBe('哎一样的鞋');
  const moved = editLine(plan, 'L1', { from: 5, to: 99 }, 8.4).lines!;
  expect(moved.map(line => line.id)).toEqual(['L2', 'L1']); expect(moved[1]).toMatchObject({ from: 5, to: 8.4 });
  expect(editLine(plan, 'L2', { to: 1 }, 8.4).lines![1]).toMatchObject({ from: 2.1, to: 2.2 });
  expect(addLine(plan, 8.4).lines!.at(-1)).toEqual({ id: 'L3', who: 'P1', text: '', from: 4, to: 6 });
  expect(removeLine(plan, 'L1').lines!.map(line => line.id)).toEqual(['L2']);
});

it('开始改写选「AI 自己配音」：新视频卡记成说话版、开着生成音频；铺卡后照旧，台词跟着拆解单进卡', () => {
  const source = node('s', newVideoCard('upload', 1, [asset]));
  const graph = startVideoRewrite({ source, nodes: [source], edges: [], takeNumber: cardCounter(), makeId, userText: '换人', talking: true });
  const card = graph.nodes.find(item => item.id === graph.state.videoId)!.data as VideoCardData;
  expect(card.rewriteTalking).toBe(true); expect(card.video.audio).toBe(true);
  const prepared = prepareRewriteCards({ state: { ...graph.state, plan }, nodes: graph.nodes, edges: graph.edges, takeNumber: cardCounter(), makeId });
  const video = prepared.nodes.find(item => item.id === prepared.videoId)!.data as VideoCardData;
  expect(video.rewriteTalking).toBe(true); expect(video.video.audio).toBe(true); expect(video.rewritePlan?.lines).toEqual(plan.lines);
  const silent = startVideoRewrite({ source, nodes: [source], edges: [], takeNumber: cardCounter(), makeId, userText: '换人' });
  const plainCard = silent.nodes.find(item => item.id === silent.state.videoId)!.data as VideoCardData;
  expect(plainCard.rewriteTalking).toBeUndefined(); expect(plainCard.video.audio).toBe(false);
});

it('存档读回：说话版标记、嗓音、台词都在；坏的台词行丢掉；不是说话版不读嗓音', () => {
  const data = { ...newVideoCard('generate', 2), rewriteId: 'b', rewriteTalking: true, rewriteVoice: '年轻男声',
    rewritePlan: { ...plan, lines: [...plan.lines!, { id: 'bad', who: 'P1', text: '坏', from: 3, to: 2 }] } };
  const read = readCard(JSON.parse(JSON.stringify(data))) as VideoCardData;
  expect(read.rewriteTalking).toBe(true); expect(read.rewriteVoice).toBe('年轻男声'); expect(read.rewritePlan?.lines).toEqual(plan.lines);
  const old = readCard(JSON.parse(JSON.stringify({ ...data, rewriteTalking: undefined }))) as VideoCardData;
  expect(old.rewriteTalking).toBeUndefined(); expect(old.rewriteVoice).toBeUndefined();
});

it('生成提示词：台词表空的或有句没填字就拦；请求带说话版和嗓音（空着不带）', () => {
  const data: VideoCardData = { ...newVideoCard('generate', 2), rewriteId: 'b', rewriteUserText: '换人', rewriteTalking: true, rewritePlan: plan,
    rewriteSource: { ...asset } };
  const nodes = [node('img', { ...newCard('upload', 1, [{ type: 'upload', id: 'pic' }]), rewriteItem: plan.items[0] })];
  const state = { id: 'v', data, nodes, edges: [{ source: 'img', target: 'v' }] };
  expect(lookPromptProblem(state)).toBeNull();
  expect(lookPromptRequest(state)).toMatchObject({ talking: true }); expect(lookPromptRequest(state)).not.toHaveProperty('voice');
  expect(lookPromptRequest({ ...state, data: { ...data, rewriteVoice: ' 年轻男声 ' } })).toMatchObject({ talking: true, voice: '年轻男声' });
  expect(lookPromptProblem({ ...state, data: { ...data, rewritePlan: { ...plan, lines: [] } } })).toContain('台词表是空的');
  expect(lookPromptProblem({ ...state, data: { ...data, rewritePlan: addLine(plan, 8.4) } })).toContain('还有 1 句没填字');
  expect(talkingLinesProblem({ ...data, rewriteTalking: undefined, rewritePlan: { ...plan, lines: [] } })).toBeNull();
});

it('面板提醒：说话版关了生成音频、换成 2.0 都提醒（不拦）', () => {
  const data: VideoCardData = { ...newVideoCard('generate', 2), rewriteId: 'b', rewriteTalking: true };
  data.video = { ...data.video, model: 'doubao-seedance-2-5-260628', audio: false };
  expect(rewriteVideoHints(data, [], [], 'v')).toContain('生成音频关了：人物不会说话，会配回原片声音，口型对不上。');
  data.video = { ...data.video, model: 'doubao-seedance-2-0-260128', audio: true };
  expect(rewriteVideoHints(data, [], [], 'v')[0]).toContain('AI 配音只在 2.5 上真出过片');
});

// 11-19 上传前审查：片长 8.466667 秒时「到第几秒」填到片尾、「加一句」贴着结尾，会被进成 8.5，小服务打回「台词表不对」。
it('片长不整齐时改到片尾、加一句贴着结尾，秒数都不超过片长；粘进来的换行并成空格', () => {
  const duration = 8.466667;
  const edited = editLine(plan, 'L1', { from: 99, to: 99 }, duration).lines!;
  expect(edited.every(line => line.from < line.to && line.to <= duration)).toBe(true);
  const added = addLine({ ...plan, lines: [{ ...plan.lines![0], from: 7.5, to: 8.466667 }] }, duration).lines!;
  expect(added.every(line => line.from < line.to && line.to <= duration)).toBe(true);
  expect(editLine(plan, 'L1', { text: '第一行\n第二行' }, duration).lines!.find(line => line.id === 'L1')!.text).toBe('第一行 第二行');
});
