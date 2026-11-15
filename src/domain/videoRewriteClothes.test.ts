import { describe, expect, it } from 'vitest';
import { SIZE_FROM_ASPECT } from './aspects';
import { cardCounter, newVideoCard } from './cards';
import { fromDoc, toDoc } from './canvasDoc';
import { lookPromptRequest } from './rewritePrompt';
import { readRewriteItem } from './videoRewriteDoc';
import { clothesFrameRegion, keptClothes, rewriteClothesPrompt } from './videoRewriteClothes';
import { prepareRewriteCards, replacementItems, rewriteMaterials, startVideoRewrite, videoRewriteMaterials } from './videoRewrite';
import type { AssetRef, CardData, CardNode, VideoCardData } from '@/types';
import type { RewriteItem, RewritePlan, VideoRewriteState } from '@/videoRewriteTypes';

const asset: AssetRef = { type: 'upload', id: 'source', media: 'video', seconds: 12, width: 576, height: 1024, hasAudio: true };
const node = (id: string, data: CardData): CardNode => ({ id, type: 'card', data, position: { x: 0, y: 0 } });
const person = (id: string, where?: string): RewriteItem => ({ id, kind: '人物', desc: `${id}，黑发`, from: 0, to: 12, frame: 0, ...(where ? { where } : {}) });
const cloth = (id: string, owner: string, from: number, to: number, sameAs?: string): RewriteItem => ({ id, kind: '衣服', person: owner, desc: `衣服${id}`, from, to, frame: from + 1, ...(sameAs ? { sameAs } : {}) });
const plan: RewritePlan = { summary: '婚礼', changes: [], actions: [], unsure: [], replace: ['P1', 'P2'],
  items: [person('P1', '上半屏'), person('P2', '下半屏'), cloth('C2', 'P1', 4, 8), cloth('C1', 'P1', 0, 4), cloth('C3', 'P1', 8, 12, 'C1'), cloth('C4', 'P2', 0, 12)] };
const frames: Record<string, AssetRef> = { C1: { type: 'upload', id: 'f1' }, C2: { type: 'upload', id: 'f2' }, C4: { type: 'upload', id: 'f4' } };

function graph(current = plan, keepClothes = true) {
  let serial = 0;
  const makeId = () => `id${++serial}`, takeNumber = cardCounter();
  const source = node('s', newVideoCard('upload', 1, [asset]));
  const started = startVideoRewrite({ source, nodes: [source], edges: [], takeNumber, makeId, userText: '换人' });
  const state: VideoRewriteState = { ...started.state, plan: current, keepClothes };
  return { state, nodes: started.nodes, edges: started.edges, takeNumber, makeId };
}

describe('要自动抽的衣服', () => {
  it('没写要换的才抽，同一套只抽第一件，按时间排', () => {
    expect(keptClothes(plan).map(item => item.id)).toEqual(['C1', 'C4', 'C2']);
    expect(keptClothes({ ...plan, replace: ['P1', 'C1', 'C3'] }).map(item => item.id)).toEqual(['C4', 'C2']);
  });
  it('分屏时只截这个人那半边；没分屏不裁', () => {
    expect(clothesFrameRegion(cloth('C1', 'P1', 0, 4), plan)).toBe('top');
    expect(clothesFrameRegion(cloth('C4', 'P2', 0, 4), plan)).toBe('bottom');
    const side: RewritePlan = { ...plan, items: [person('P1', '左半屏'), person('P2', '右半屏')] };
    expect(clothesFrameRegion(cloth('C1', 'P1', 0, 4), side)).toBe('left');
    expect(clothesFrameRegion(cloth('C4', 'P2', 0, 4), side)).toBe('right');
    expect(clothesFrameRegion(cloth('C1', 'P1', 0, 4), { ...plan, items: [person('P1'), person('P2')] })).toBeUndefined();
  });
  it('抽衣服的提示词：裁好的图只说人物；同框两个人点名是谁、哪一件', () => {
    const body = /全套服饰.*无头人台.*头冠或帽子单独摆.*不出现人脸/;
    expect(rewriteClothesPrompt(cloth('C1', 'P1', 0, 4), plan)).toMatch(/^提取图中人物穿戴的/);
    expect(rewriteClothesPrompt(cloth('C1', 'P1', 0, 4), plan)).toMatch(body);
    const same = rewriteClothesPrompt(cloth('C1', 'P1', 0, 4), { ...plan, items: [person('P1'), person('P2')] });
    expect(same).toMatch(/^提取图中P1（衣服C1）穿戴的/); expect(same).toMatch(body);
    expect(rewriteClothesPrompt(cloth('C1', 'P1', 0, 4), { ...plan, items: [person('P1')] })).toMatch(/^提取图中人物穿戴的/);
  });
});

describe('铺卡和连线', () => {
  const prepare = (current = plan, keepClothes = true) => {
    const start = graph(current, keepClothes);
    return { start, prepared: prepareRewriteCards({ ...start, keptFrames: keepClothes ? Object.fromEntries(keptClothes(current).map(item => [item.id, frames[item.id]])) : {} }) };
  };
  it('每件衣服一张截图卡 → 一张衣服卡 → 视频卡，全部连好，竖版出图不跟截图尺寸', () => {
    const { prepared } = prepare();
    const frameIds = prepared.clothesIds.map(id => prepared.imageColumn.rows!.find(row => row.right === id)!.left!);
    expect(prepared.clothesIds).toHaveLength(3); expect(frameIds.every(Boolean)).toBe(true);
    prepared.clothesIds.forEach((id, index) => {
      const card = prepared.nodes.find(item => item.id === id)!.data;
      expect(card).toMatchObject({ kind: 'image', source: 'generate', rewriteItemId: ['C1', 'C4', 'C2'][index] });
      if (card.kind !== 'image') throw Error('要图片卡');
      expect(card.prompt).toMatch(/^提取图中人物穿戴的/);
      expect(card.gen).toMatchObject({ aspect: '9:16', sizeFrom: SIZE_FROM_ASPECT });
      expect(prepared.edges.some(edge => edge.source === frameIds[index] && edge.target === id)).toBe(true);
      expect(prepared.edges.some(edge => edge.source === id && edge.target === prepared.videoId)).toBe(true);
    });
    expect(frameIds.map(id => prepared.nodes.find(item => item.id === id)!.data.title)).toEqual(['衣服 1 截图（1 秒）', '衣服 2 截图（1 秒）', '衣服 3 截图（5 秒）']);
    expect(prepared.imageColumn.movableIds).toEqual(expect.arrayContaining(prepared.clothesIds));
  });
  it('素材编号和连线一致：人物在前，衣服按时间，不带要写进提示词的原描述以外的东西', () => {
    const { start, prepared } = prepare();
    const materials = videoRewriteMaterials(prepared.nodes, prepared.edges, prepared.videoId);
    expect(materials.map(item => item.itemId)).toEqual(['P1', 'P2', 'C1', 'C4', 'C2', undefined]);
    expect(materials).toEqual(rewriteMaterials(start.state));
  });
  it('视频卡记住衣服保持原片，存档读回不丢；同一套的标记也不丢', () => {
    const { prepared } = prepare();
    const video = prepared.nodes.find(item => item.id === prepared.videoId)!.data as VideoCardData;
    expect(video.rewriteKeepClothes).toBe(true);
    const saved = fromDoc(toDoc({ id: 'c', name: 'n' }, prepared.nodes, prepared.edges));
    const back = saved.nodes.find(item => item.id === prepared.videoId)!.data as VideoCardData;
    expect(back.rewriteKeepClothes).toBe(true);
    expect(back.rewritePlan?.items.find(item => item.id === 'C3')?.sameAs).toBe('C1');
    expect(readRewriteItem({ ...cloth('C3', 'P1', 8, 12), sameAs: 'C1' })?.sameAs).toBe('C1');
  });
  it('交提示词时带上 keepClothes；没勾就不带', () => {
    const request = (current: ReturnType<typeof prepare>['prepared']) => {
      const video = current.nodes.find(item => item.id === current.videoId)!;
      return lookPromptRequest({ id: current.videoId, data: video.data as VideoCardData, nodes: current.nodes, edges: current.edges });
    };
    expect(request(prepare().prepared).keepClothes).toBe(true);
    expect(request(prepare(plan, false).prepared)).not.toHaveProperty('keepClothes');
  });
  it('没勾：不铺原片衣服卡', () => {
    const { prepared } = prepare(plan, false);
    expect(prepared.clothesIds).toEqual([]);
    expect(prepared.nodes.filter(item => item.data.kind === 'image' && item.data.rewriteItem?.kind === '衣服')).toHaveLength(0);
  });
  it('写明要换的衣服照旧是空卡等用户补，同一套只铺一张', () => {
    const current = { ...plan, replace: ['P1', 'C1', 'C3'] };
    expect(replacementItems(current).map(item => item.id)).toEqual(['P1', 'C1']);
    const { prepared } = prepare(current);
    const card = prepared.nodes.find(item => item.data.kind === 'image' && item.data.rewriteItemId === 'C1')!;
    expect(card.data.results).toEqual([]); expect(prepared.clothesIds).not.toContain(card.id);
  });
  it('超过 30 张图提示能怎么减', () => {
    const many = Array.from({ length: 31 }, (_, index) => cloth(`C${index + 10}`, 'P1', index * 0.3, index * 0.3 + 0.2));
    const start = graph({ ...plan, items: [person('P1'), ...many], replace: ['P1'] });
    expect(() => rewriteMaterials(start.state)).toThrow('不勾「衣服和原片保持一致」');
  });
});
