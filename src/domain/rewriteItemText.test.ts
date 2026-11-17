import { expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import { newCard, newVideoCard } from './cards';
import { createLookPromptAction, lookPromptProblem, lookPromptRequest } from './rewritePrompt';
import { canUseText, isRewriteItemCard, itemTextsOf, sceneTextStaleNotes, usesText } from './rewriteTextScene';
import { videoRewriteMaterials } from './videoRewrite';
import type { CardNode, ImageCardData, VideoCardData } from '@/types';
import type { WriteVideoResult } from '@/videoRewriteApiTypes';
import type { RewriteItem, RewritePlan } from '@/videoRewriteTypes';

// 11-16 衣服卡、东西卡「不出图，用文字」（设计 docs/specs/2026-11-16-衣服卡和东西卡用文字-design.md）。
const items: RewriteItem[] = [
  { id: 'P1', kind: '人物', desc: '女生', from: 0, to: 12, frame: 0 },
  { id: 'C1', kind: '衣服', desc: '休闲套装', from: 0, to: 4, frame: 1, person: 'P1' }, { id: 'C2', kind: '衣服', desc: '棒球套装', from: 4, to: 8, frame: 5, person: 'P1' },
  { id: 'C3', kind: '衣服', desc: '高尔夫套装', from: 8, to: 12, frame: 9, person: 'P1' }, { id: 'D1', kind: '道具', desc: '棒球棒', from: 0, to: 12, frame: 0 }];
const plan: RewritePlan = { summary: '棒球', changes: [], actions: [], unsure: [], replace: items.map(item => item.id), items };
const card = (number: number, item: RewriteItem, extra: Partial<ImageCardData> = {}): ImageCardData =>
  ({ ...newCard('generate', number, [{ type: 'work', id: `w${number}` }]), rewriteId: 'batch', title: `${item.kind} 卡`, rewriteItem: item, ...extra });
function graph() {
  const video: VideoCardData = { ...newVideoCard('generate', 9), rewriteId: 'batch', rewriteSourceId: 'source', rewritePlan: plan, rewriteUserText: '人和衣服换成我的',
    rewriteSource: { type: 'upload', id: 'src', media: 'video', seconds: 12 } };
  video.video.duration = 12;
  const node = (id: string, data: CardNode['data']): CardNode => ({ id, type: 'card', position: { x: 0, y: 0 }, data });
  const nodes = [node('person', card(1, items[0])), node('c1', card(2, items[1])),
    node('c2', card(3, items[2], { rewriteTextOn: true, rewriteSceneText: ' 黄色篮球背心和短裤 ' })), node('c3', card(4, items[3])),
    node('d1', card(5, items[4], { rewriteTextOn: true, rewriteSceneText: '银色的金属球棒' })), node('video', video)];
  const edges: Edge[] = ['person', 'c1', 'c3'].map(source => ({ id: source, source, target: 'video' }));
  return { nodes, edges, video, state: { id: 'video', data: video, nodes, edges } };
}

it('衣服卡、东西卡能用文字；人物卡、商品拆解的卡、视频卡不能', () => {
  const { nodes } = graph();
  expect(nodes.map(node => isRewriteItemCard(node.data))).toEqual([false, true, true, true, true, false]);
  expect(canUseText(nodes[0].data)).toBe(false);
  expect(isRewriteItemCard({ ...nodes[1].data, productRole: { role: 'product' } } as ImageCardData)).toBe(false);
  expect(usesText(nodes[1].data)).toBe(false); expect(usesText(nodes[2].data)).toBe(true);
  expect(usesText({ ...nodes[0].data, rewriteTextOn: true } as ImageCardData)).toBe(false);
});

it('请求带上 itemTexts（卡名和素材表同一套编号、去空格）；用文字的卡不占 @图片，后面的衣服不往前挪号', () => {
  const { state } = graph();
  expect(itemTextsOf(state.nodes, state.data)).toEqual([{ cardId: 'c2', title: '衣服 2', itemId: 'C2', text: '黄色篮球背心和短裤' },
    { cardId: 'd1', title: '道具', itemId: 'D1', text: '银色的金属球棒' }]);
  const request = lookPromptRequest(state);
  expect(request.itemTexts?.map(row => row.title)).toEqual(['衣服 2', '道具']);
  expect(request.materials.map(row => `${row.tag} ${row.purpose}`)).toEqual(['@图片1 人物', '@图片2 衣服 1（0-4 秒穿）', '@图片3 衣服 3（8-12 秒穿）']);
  expect(lookPromptProblem(state)).toBeNull();
  // 剪线但没用文字的卡也不让别的卡变号。
  (state.nodes[2].data as ImageCardData).rewriteTextOn = false;
  expect(videoRewriteMaterials(state.nodes, state.edges, 'video')[2].purpose).toBe('衣服 3（8-12 秒穿）');
  expect(lookPromptRequest(state).itemTexts?.map(row => row.title)).toEqual(['道具']);
  (state.nodes[4].data as ImageCardData).rewriteTextOn = false;
  expect('itemTexts' in lookPromptRequest(state)).toBe(false);
});

it('排号和小服务同一条规矩：删掉衣服卡不让别的卡变号；跟原片又只剪线的衣服不占号', () => {
  // 11-17 审查：以前页面按「还在画布上的卡」排，删掉衣服 1 的卡后把衣服 2 叫成「衣服 1」，和小服务的「第1套衣服」撞号。
  const { state } = graph();
  state.nodes = state.nodes.filter(node => node.id !== 'c1'); state.edges = state.edges.filter(edge => edge.source !== 'c1');
  expect(itemTextsOf(state.nodes, state.data, state.edges).map(row => row.title)).toEqual(['衣服 2', '道具']);
  expect(videoRewriteMaterials(state.nodes, state.edges, 'video').map(row => row.purpose)).toEqual(['人物', '衣服 3（8-12 秒穿）']);
  // 衣服都不在要换名单（跟原片）：衣服 1 只剪线、没用文字 → 不占号，后面的往前挪，和小服务 labelPeers 一样。
  const kept = graph();
  kept.video.rewritePlan = { ...plan, replace: ['P1'] };
  kept.state.edges = kept.state.edges.filter(edge => edge.source !== 'c1');
  expect(itemTextsOf(kept.state.nodes, kept.state.data, kept.state.edges)[0].title).toBe('衣服 1');
  expect(videoRewriteMaterials(kept.state.nodes, kept.state.edges, 'video').map(row => row.purpose)).toEqual(['人物', '衣服 2（8-12 秒穿）']);
});

it('没写字拦「生成提示词」；缺图的衣服卡提示可以改用文字；卡全用文字、一张图没连时说清怎么救', () => {
  const { state } = graph();
  (state.nodes[2].data as ImageCardData).rewriteSceneText = ' ';
  expect(lookPromptProblem(state)).toBe('衣服 2 选了用文字，还没写字');
  (state.nodes[2].data as ImageCardData).rewriteSceneText = '黄色';
  state.nodes[3].data.results = [];
  expect(lookPromptProblem(state)).toBe('还差 1 张图：衣服 卡；不想出图可以点卡上的「不出图，用文字」');
  state.nodes[3].data.results = [{ type: 'work', id: 'w4' }]; state.nodes[0].data.results = [];
  expect(lookPromptProblem(state)).toBe('还差 1 张图：人物 卡'); // 人物卡不能用文字，不提示
  state.edges = [];
  expect(lookPromptProblem(state)).toBe('卡都改成用文字了，一张图也没连。生成提示词至少要一张图：连一张人物图，或者选一张卡点「改回用图」。');
});

it('回显按卡名对回卡；生成后改了衣服卡的字、东西卡改回用图都出红字提醒', async () => {
  const { state, nodes } = graph();
  state.data.prompt = '';
  const result: WriteVideoResult = { videoPrompt: '新词', warnings: [], issues: [], yuan: 0,
    sceneReads: [{ title: '衣服 2', text: '黄色篮球背心和短裤', read: '黄色背心短裤' }, { title: '道具', text: '银色的金属球棒', read: '银色球棒' }] };
  const run = createLookPromptAction({ getState: () => state, request: vi.fn(async () => result), notify: vi.fn(), onError: vi.fn(),
    apply: patch => { Object.assign(state.data, patch); } });
  await run();
  expect(state.data.rewriteSceneReads?.map(row => row.cardId)).toEqual(['c2', 'd1']);
  expect(sceneTextStaleNotes(nodes, state.data)).toEqual([]);
  (nodes[2].data as ImageCardData).rewriteSceneText = '红色球衣';
  (nodes[4].data as ImageCardData).rewriteTextOn = false;
  expect(sceneTextStaleNotes(nodes, state.data)).toEqual(['衣服 2 的字在生成提示词之后改过，再点一次「生成提示词」', '道具 在生成提示词之后改回了用图，再点一次「生成提示词」']);
});
