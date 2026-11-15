import { expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import { newCard, newVideoCard } from './cards';
import { fromDoc, toDoc } from './canvasDoc';
import { createLookPromptAction, lookPromptProblem, lookPromptRequest } from './rewritePrompt';
import { attachReadCards, isRewriteBackground, readSceneReads, rewriteVideoOf, sceneTextIds, sceneTextProblem, sceneTextsOf, sceneTextStaleNotes,
  usesSceneText } from './rewriteTextScene';
import type { CardNode, ImageCardData, VideoCardData } from '@/types';
import type { WriteVideoResult } from '@/videoRewriteApiTypes';
import type { RewritePlan } from '@/videoRewriteTypes';

// 11-13 背景卡「不出图，用文字」（设计 docs/specs/2026-11-12-背景卡用文字-design.md）。
const plan: RewritePlan = { summary: '棒球', changes: [], actions: [], unsure: [], replace: ['P1'], items: [
  { id: 'P1', kind: '人物', desc: '女生', from: 0, to: 10, frame: 0 },
  { id: 'S1', kind: '场景', desc: '白棚', from: 0, to: 4, frame: 2 }, { id: 'S2', kind: '场景', desc: '棒球', from: 4, to: 7, frame: 5 },
  { id: 'S3', kind: '场景', desc: '保龄球', from: 7, to: 10, frame: 8 }] };
const background = (number: number, title: string, sceneId: string, extra: Partial<ImageCardData> = {}): ImageCardData =>
  ({ ...newCard('generate', number), rewriteId: 'batch', title, rewriteNewScene: true, rewriteSceneId: sceneId, ...extra });
function graph() {
  const video: VideoCardData = { ...newVideoCard('generate', 9), rewriteId: 'batch', rewriteSourceId: 'source', rewritePlan: plan, rewriteUserText: '人和背景换成我的',
    rewriteSource: { type: 'upload', id: 'src', media: 'video', seconds: 10 } };
  video.video.duration = 10;
  const nodes: CardNode[] = [
    { id: 'bg1', type: 'card', position: { x: 0, y: 0 }, data: background(3, '背景', 'S1', { results: [{ type: 'work', id: 'w1' }] }) },
    { id: 'bg3', type: 'card', position: { x: 0, y: 0 }, data: background(5, '背景 3', 'S3', { rewriteTextOn: true, rewriteSceneText: ' 跟原来一样 ' }) },
    { id: 'bg2', type: 'card', position: { x: 0, y: 0 }, data: background(4, '背景 2', 'S2', { rewriteTextOn: true, rewriteSceneText: '脚下和身后的球都换成篮球' }) },
    { id: 'person', type: 'card', position: { x: 0, y: 0 }, data: { ...newCard('generate', 6, [{ type: 'work', id: 'w2' }]), rewriteId: 'batch', title: '人物',
      rewriteItem: plan.items[0] } },
    { id: 'video', type: 'card', position: { x: 0, y: 0 }, data: video }];
  const edges: Edge[] = [{ id: 'a', source: 'bg1', target: 'video' }, { id: 'b', source: 'person', target: 'video' }];
  return { nodes, edges, video, state: { id: 'video', data: video, nodes, edges } };
}

it('背景卡才有这个开关：人物 / 衣服卡、商品卡、视频卡都不算；找得到它的改写视频卡', () => {
  const { nodes } = graph();
  expect(isRewriteBackground(nodes[0].data)).toBe(true);
  expect(isRewriteBackground(nodes[3].data)).toBe(false);
  expect(isRewriteBackground(nodes[4].data)).toBe(false);
  expect(isRewriteBackground({ ...nodes[0].data, productRole: { role: 'background' } } as ImageCardData)).toBe(false);
  expect(usesSceneText(nodes[0].data)).toBe(false); expect(usesSceneText(nodes[1].data)).toBe(true);
  expect(rewriteVideoOf(nodes, nodes[1].data as ImageCardData)?.id).toBe('video');
});

it('请求带上用文字的卡（按卡序号排、去空格、带场景编号）；编号只按连线算，用文字的卡不占 @图片', () => {
  const { state } = graph();
  expect(sceneTextsOf(state.nodes, state.data)).toEqual([{ cardId: 'bg2', title: '背景 2', sceneId: 'S2', text: '脚下和身后的球都换成篮球' },
    { cardId: 'bg3', title: '背景 3', sceneId: 'S3', text: '跟原来一样' }]);
  expect(sceneTextIds(state.nodes, state.data)).toEqual(['S2', 'S3']);
  const request = lookPromptRequest(state);
  expect(request.sceneTexts?.map(row => row.title)).toEqual(['背景 2', '背景 3']);
  expect(request.materials.map(row => row.tag)).toEqual(['@图片1', '@图片2']);
  expect(lookPromptProblem(state)).toBeNull();
  const { state: plain } = graph();
  for (const node of plain.nodes) if (node.data.kind === 'image') node.data.rewriteTextOn = false;
  expect('sceneTexts' in lookPromptRequest(plain)).toBe(false);
});

it('没写字拦「生成提示词」；缺的是背景图就提示可以改用文字', () => {
  const { state } = graph();
  (state.nodes[2].data as ImageCardData).rewriteSceneText = '  ';
  expect(lookPromptProblem(state)).toBe('背景 2 选了用文字，还没写字');
  expect(sceneTextProblem([])).toBeNull();
  state.nodes[0].data.results = [];
  expect(lookPromptProblem(state)).toBe('还差 1 张图：背景；不想出图可以点卡上的「不出图，用文字」');
  state.nodes[0].data.results = [{ type: 'work', id: 'w1' }]; state.nodes[3].data.results = [];
  expect(lookPromptProblem(state)).toBe('还差 1 张图：人物');
});

// 11-14 体检：生成提示词至少要一张图（小服务也这么拦）。只连着一张背景卡时照提示点了「用文字」就再也点不了，所以这时不提示；
// 已经全改成用文字的，说清楚怎么救回来。
it('只剩一张背景图时不劝人改用文字；图全改成文字了说清要连回一张', () => {
  const { state } = graph();
  state.edges = state.edges.filter(edge => edge.source !== 'person');
  state.nodes[0].data.results = [];
  expect(lookPromptProblem(state)).toBe('还差 1 张图：背景');
  state.edges = [];
  (state.nodes[0].data as ImageCardData).rewriteTextOn = true; (state.nodes[0].data as ImageCardData).rewriteSceneText = '海边';
  expect(lookPromptProblem(state)).toBe('背景都改成用文字了，一张图也没连。生成提示词至少要一张图：连一张人物或衣服图，或者选一张背景卡点「改回用图」。');
  for (const node of state.nodes) if (node.data.kind === 'image') (node.data as ImageCardData).rewriteTextOn = false;
  expect(lookPromptProblem(state)).toBe('请先连入背景、人物或衣服图片，再生成提示词。');
});

it('生成后回显带上卡编号存进视频卡；之后改字、切回用图、生成前就开了用文字都出红字提醒', async () => {
  const { state, nodes } = graph();
  state.data.prompt = '';
  const result: WriteVideoResult = { videoPrompt: '新词', warnings: [], issues: [], yuan: 0,
    sceneReads: [{ title: '背景 2', text: '脚下和身后的球都换成篮球', read: '脚下和身后都是篮球' }, { title: '背景 3', text: '跟原来一样', read: '照原片保龄球' }] };
  const run = createLookPromptAction({ getState: () => state, request: vi.fn(async () => result), notify: vi.fn(), onError: vi.fn(),
    apply: patch => { Object.assign(state.data, patch); } });
  await run();
  expect(state.data.prompt).toBe('新词');
  expect(state.data.rewriteSceneReads).toEqual([{ title: '背景 2', text: '脚下和身后的球都换成篮球', read: '脚下和身后都是篮球', cardId: 'bg2' },
    { title: '背景 3', text: '跟原来一样', read: '照原片保龄球', cardId: 'bg3' }]);
  expect(sceneTextStaleNotes(nodes, state.data)).toEqual([]);
  (nodes[2].data as ImageCardData).rewriteSceneText = '球都换成足球';
  (nodes[1].data as ImageCardData).rewriteTextOn = false;
  expect(sceneTextStaleNotes(nodes, state.data)).toEqual(['背景 2 的字在生成提示词之后改过，再点一次「生成提示词」',
    '背景 3 在生成提示词之后改回了用图，再点一次「生成提示词」']);
  expect(sceneTextStaleNotes(nodes, { ...state.data, rewriteSceneReads: undefined })).toEqual(['背景 2 选了用文字，提示词里还没有这段的字，再点一次「生成提示词」']);
  expect(sceneTextStaleNotes(nodes, { ...state.data, prompt: '' })).toEqual([]);
  expect(attachReadCards(undefined, [])).toBeUndefined();
});

it('存档读写保留开关、卡上的字（最多 300）和回显；关着的开关不存', () => {
  const { nodes, edges } = graph();
  (nodes[1].data as ImageCardData).rewriteSceneText = '球'.repeat(320);
  (nodes[4].data as VideoCardData).rewriteSceneReads = [{ title: '背景 2', text: '篮球', read: '都是篮球', cardId: 'bg2' }];
  (nodes[0].data as ImageCardData).rewriteTextOn = false; (nodes[0].data as ImageCardData).rewriteSceneText = '留着的字';
  const doc = JSON.parse(JSON.stringify(toDoc({ id: 'c', name: '画布' }, nodes, edges)));
  const back = fromDoc(doc).nodes;
  const data = (id: string) => back.find(node => node.id === id)!.data as ImageCardData;
  expect(data('bg2').rewriteTextOn).toBe(true); expect(data('bg2').rewriteSceneText).toBe('脚下和身后的球都换成篮球');
  expect(data('bg3').rewriteSceneText).toHaveLength(300);
  expect('rewriteTextOn' in data('bg1')).toBe(false); expect(data('bg1').rewriteSceneText).toBe('留着的字');
  expect((back.find(node => node.id === 'video')!.data as VideoCardData).rewriteSceneReads).toEqual([{ title: '背景 2', text: '篮球', read: '都是篮球', cardId: 'bg2' }]);
  expect(readSceneReads([{ title: '背景', text: 1, read: 'x' }, 'x'])).toBeUndefined();
});
