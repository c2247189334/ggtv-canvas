import { describe, expect, it } from 'vitest';
import { cardCounter, newVideoCard } from './cards';
import { fromDoc, toDoc } from './canvasDoc';
import { checkLink, maxRefsOf, referenceLimitReached } from './refs';
import { checkVideoRefs } from './videoModels';
import { readRewriteItem } from './videoRewriteDoc';
import { addRewriteBackground, planChangeSeconds, prepareRewriteCards, rewriteChangeSeconds, rewriteMaterials, sceneItems, startVideoRewrite, videoRewriteMaterials } from './videoRewrite';
import type { AssetRef, CardData, CardNode } from '@/types';
import type { RewriteItem, RewritePlan, VideoRewriteState } from '@/videoRewriteTypes';

const REWRITE_MODEL = 'doubao-seedance-2-5-260628';
const asset: AssetRef = { type: 'upload', id: 'source', media: 'video', seconds: 17.2, width: 576, height: 1024, hasAudio: true };
const node = (id: string, data: CardData): CardNode => ({ id, type: 'card', data, position: { x: 0, y: 0 } });
const scene = (id: string, from: number, to: number): RewriteItem => ({ id, kind: '场景', desc: `场景${id}`, from, to, frame: (from + to) / 2 });
const person = (id: string): RewriteItem => ({ id, kind: '人物', desc: id, from: 0, to: 17, frame: 0 });
const cloth = (id: string, from: number, to: number): RewriteItem => ({ id, kind: '衣服', desc: id, from, to, frame: from, person: 'P1' });
const plan: RewritePlan = { summary: '婚礼', items: [person('P1'), person('P2'), scene('S2', 3.7, 6.5), scene('S1', 0, 3.7), scene('S3', 6.5, 17)],
  replace: ['P1', 'P2'], changes: [], actions: [], unsure: [] };

function graph(current = plan) {
  let serial = 0;
  const makeId = () => `id${++serial}`, takeNumber = cardCounter();
  const source = node('s', newVideoCard('upload', 1, [asset]));
  const started = startVideoRewrite({ source, nodes: [source], edges: [], takeNumber, makeId, userText: '换人' });
  let state: VideoRewriteState = { ...started.state, plan: current }, nodes = started.nodes, edges = started.edges;
  const frames: string[] = [];
  sceneItems(current).forEach((item, index) => {
    const added = addRewriteBackground({ state, frame: { type: 'upload', id: `frame-${index}` }, second: item.frame, scene: item, nodes, edges, takeNumber, makeId });
    state = added.state; nodes = added.nodes; edges = added.edges; frames.push(added.frameId!);
  });
  return { state, nodes, edges, takeNumber, makeId, frames };
}

describe('多场景背景卡', () => {
  it('场景按时间排序', () => {
    expect(sceneItems(plan).map(item => item.id)).toEqual(['S1', 'S2', 'S3']);
  });
  it('每个场景一张背景卡和一张截图卡：第一张仍是 backgroundId，其余进 extraBackgroundIds，标题带序号', () => {
    const { state, nodes, edges, frames } = graph();
    expect(state.extraBackgroundIds).toHaveLength(2);
    const ids = [state.backgroundId!, ...state.extraBackgroundIds!];
    expect(ids.map(id => nodes.find(item => item.id === id)!.data)).toMatchObject([
      { title: '背景', rewriteSceneId: 'S1' }, { title: '背景 2', rewriteSceneId: 'S2' }, { title: '背景 3', rewriteSceneId: 'S3' }]);
    frames.forEach((frame, index) => expect(edges.some(edge => edge.source === frame && edge.target === ids[index])).toBe(true));
  });
  it('铺卡后背景全排在最前，按场景顺序连进视频卡，素材带场景编号、不带原描述', () => {
    const { state, nodes, edges, takeNumber, makeId } = graph();
    const prepared = prepareRewriteCards({ state, nodes, edges, takeNumber, makeId });
    const materials = videoRewriteMaterials(prepared.nodes, prepared.edges, prepared.videoId);
    expect(materials.slice(0, 3)).toEqual([{ tag: '@图片1', purpose: '背景', itemId: 'S1' }, { tag: '@图片2', purpose: '背景', itemId: 'S2' }, { tag: '@图片3', purpose: '背景', itemId: 'S3' }]);
    expect(materials[3]).toMatchObject({ tag: '@图片4', itemId: 'P1' });
    // 11-11 起背景和要补的卡一行一行重排，背景卡也跟着实测尺寸挪（截图和背景同一行）。
    expect(prepared.imageColumn.rows!.slice(0, 3).map(row => row.right)).toEqual([state.backgroundId, ...state.extraBackgroundIds!]);
    expect(prepared.imageColumn.movableIds).toEqual(expect.arrayContaining([state.backgroundId, ...state.extraBackgroundIds!]));
  });
  it('背景卡的场景编号存档读回不丢', () => {
    const { state, nodes } = graph();
    const canvas = { id: 'c', name: 'n' };
    const saved = toDoc(canvas, nodes, []);
    const back = fromDoc(saved).nodes.find(item => item.id === state.extraBackgroundIds![0])!;
    expect(back.data).toMatchObject({ rewriteSceneId: 'S2' });
  });
  it('超过 8 个参考也能铺（2.5 官方 30 张图）；超过 30 张图才拦', () => {
    const many: RewritePlan = { ...plan, items: [...plan.items, ...Array.from({ length: 10 }, (_, i) => cloth(`C${i}`, i, i + 1))], replace: ['P1', 'P2', ...Array.from({ length: 10 }, (_, i) => `C${i}`)] };
    expect(rewriteMaterials(graph(many).state)).toHaveLength(16);
    const huge: RewritePlan = { ...many, items: [...many.items, ...Array.from({ length: 20 }, (_, i) => cloth(`X${i}`, 0, 1))], replace: [...many.replace, ...Array.from({ length: 20 }, (_, i) => `X${i}`)] };
    expect(() => rewriteMaterials(graph(huge).state)).toThrow('参考图最多 30 张');
  });
});

describe('换场点', () => {
  const dressed: RewritePlan = { ...plan, items: [...plan.items, cloth('C1', 0, 3.7), cloth('C2', 3.7, 17)] };
  it('换装和换场合在一起、去重、排序', () => {
    expect(planChangeSeconds(dressed)).toEqual([3.7, 6.5]);
    expect(planChangeSeconds({ ...plan, items: plan.items.filter(item => item.kind !== '场景') })).toEqual([]);
  });
  it('两个人第一套衣服开始时间差一点不算换装', () => {
    const items: RewriteItem[] = [{ ...cloth('C1', 0.4, 7), person: 'P1' }, { ...cloth('C2', 0.2, 7), person: 'P2' }, { ...cloth('C3', 7, 17), person: 'P1' }, { ...cloth('C4', 7, 17), person: 'P2' }];
    expect(planChangeSeconds({ ...plan, items: [person('P1'), person('P2'), ...items] })).toEqual([7]);
  });
  it('视频卡要单独占一秒段的秒数包含换场', () => {
    const data = newVideoCard('generate', 1);
    data.video.duration = 17; data.rewritePlan = dressed;
    expect(rewriteChangeSeconds(data)).toEqual([3.7, 6.5]);
  });
});

describe('存档', () => {
  it('衣服的主人、人的位置读回不丢；写错类型的丢掉', () => {
    expect(readRewriteItem({ ...cloth('C1', 0, 1) })?.person).toBe('P1');
    expect(readRewriteItem({ ...person('P1'), where: '上半屏' })?.where).toBe('上半屏');
    expect(readRewriteItem({ ...cloth('C1', 0, 1), person: 3 })).not.toHaveProperty('person');
  });
});

describe('参考上限跟模型走', () => {
  const video = (model: string) => { const data = newVideoCard('generate', 1); data.video.model = model as typeof data.video.model; return data; };
  it('2.5 视频卡 40 个，其他视频卡和图片卡还是 8 个', () => {
    expect(maxRefsOf(video(REWRITE_MODEL))).toBe(40);
    expect(maxRefsOf(video('doubao-seedance-2-0-260128'))).toBe(8);
    expect(maxRefsOf(undefined)).toBe(8);
  });
  it('连线按传进来的上限算，声音不占名额', () => {
    const kinds = Array<CardData['kind']>(8).fill('image');
    expect(referenceLimitReached(kinds, 'image')).toBe(true);
    expect(referenceLimitReached(kinds, 'image', 40)).toBe(false);
    expect(referenceLimitReached(kinds, 'audio')).toBe(false);
    const edges = Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, source: `n${i}`, target: 't' }));
    const link = { edges, source: 'x', target: 't', targetSource: 'generate' as const, sourceKind: 'image' as const, targetKind: 'video' as const };
    expect(checkLink(link)).toEqual({ ok: false, reason: '一张卡最多连 8 张参考图。' });
    expect(checkLink({ ...link, maxRefs: 40 })).toEqual({ ok: true });
  });
  it('发送前的模型检查：2.5 放行 16 个，2.0 仍拦', () => {
    expect(checkVideoRefs({ model: REWRITE_MODEL, mode: 'reference', images: 15, videos: [17] })).toEqual([]);
    expect(checkVideoRefs({ model: 'doubao-seedance-2-0-260128', mode: 'reference', images: 8, videos: [10] })).toContain('图和视频加起来最多 8 个参考。');
  });
});
