import { describe, expect, it } from 'vitest';
import { absorbLayerViews, angleOf, changedCount, fitLayer, importLayer, initialLayers, LAYER_TEXT, layerSources, mergedChild,
  normalizedBoxes, readLayerSplit, reorder, scaleLayer, splitMatches, type EditLayer } from './layers';
import { readCard, toDoc } from './canvasDoc';
import { newCanvasCard } from './cards';
import type { CardNode, LayerJobView, LayerSplit } from '@/types';

// 照 11-16 真测：1280 底图拆出勾和标签；另一张 1254 的图拆出三条斜杠。
const SHOE: LayerSplit = { source: { type: 'upload', id: 'u1' }, base: 'w0', width: 1280, height: 1280, items: [
  { work: 'w1', name: '黑色勾形品牌标志', box: [540, 583, 703, 717] }, { work: 'w2', name: '灰色长条标签', box: [428, 488, 579, 658] }] };
const STRIPES: LayerSplit = { source: { type: 'upload', id: 'u2' }, base: 'v0', width: 1254, height: 1254, items: [
  { work: 'v1', name: '鞋身侧面三条斜杠标志', box: [539, 538, 780, 702] }] };

function card(id: string, layerSplit?: LayerSplit, extra: Record<string, unknown> = {}): CardNode {
  const data = newCanvasCard('upload', () => 0, [layerSplit?.source ?? { type: 'upload', id: `u-${id}` }], 'image', `${id}.jpg`);
  return { id, type: 'card', position: { x: 0, y: 0 }, data: { ...data, ...(layerSplit ? { layerSplit } : {}), ...extra } as CardNode['data'] };
}

describe('图层分离纯逻辑', () => {
  it('拆好后每层放回原位置（中心 + 框的大小）', () => {
    const [hook] = initialLayers(SHOE);
    expect(hook).toMatchObject({ work: 'w1', x: 621.5, y: 650, w: 163, h: 134, rotation: 0, flipX: false, hidden: false });
  });

  it('动过几层：挪了、翻了、调了顺序、加了、删了都算', () => {
    const initial = initialLayers(SHOE);
    expect(changedCount(initial, initial)).toBe(0);
    expect(changedCount(initial, [{ ...initial[0], flipX: true }, initial[1]])).toBe(1);
    expect(changedCount(initial, [initial[1], initial[0]])).toBe(2);
    expect(changedCount(initial, [initial[0]])).toBe(1);
    const added = importLayer({ cardId: 'b', title: 'b', split: STRIPES }, 0, SHOE, initial);
    expect(changedCount(initial, [added, ...initial]), '新加一层放最底下只算 1 个').toBe(1);
  });

  it('上移、下移、置顶、置底；到头不动', () => {
    const list = ['a', 'b', 'c'].map(key => ({ key }) as EditLayer);
    const keys = (items: EditLayer[]) => items.map(item => item.key).join('');
    expect(keys(reorder(list, 'a', 'up'))).toBe('bac');
    expect(keys(reorder(list, 'c', 'up'))).toBe('abc');
    expect(keys(reorder(list, 'b', 'down'))).toBe('bac');
    expect(keys(reorder(list, 'a', 'top'))).toBe('bca');
    expect(keys(reorder(list, 'c', 'bottom'))).toBe('cab');
  });

  it('缩放按比例、不小于 4 像素；适配画布放满居中转正', () => {
    const layer = { ...initialLayers(SHOE)[0], rotation: 30 };
    expect(scaleLayer(layer, 2)).toEqual({ w: 326, h: 268 });
    expect(scaleLayer(layer, 0).h).toBeCloseTo(4);
    expect(fitLayer(layer, 1280, 1280)).toEqual({ x: 640, y: 640, w: 1280, h: 134 * 1280 / 163, rotation: 0 });
  });

  it('角度：正上方 0 度、右边 90 度，Shift 吸 15 度', () => {
    expect(angleOf({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(0);
    expect(angleOf({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(90);
    expect(angleOf({ x: 0, y: 0 }, { x: 10, y: -9 }, true)).toBe(45);
  });

  it('框选换成 0~1000 整数框：反着拖也对，夹在图里，太小的丢掉', () => {
    expect(normalizedBoxes([[640, 640, 320, 0], [-10, 0, 2000, 1280], [5, 5, 5.2, 5.2]], 1280, 1280))
      .toEqual([[250, 0, 500, 500], [0, 0, 1000, 1000]]);
  });

  it('添加图层：只列别的卡拆好的；按两张底图宽度比换算大小，放正中，同一层加两次编号不撞', () => {
    const nodes = [card('a', SHOE), card('b', STRIPES), card('c')];
    const sources = layerSources(nodes, 'a', node => node.id);
    expect(sources.map(source => source.cardId)).toEqual(['b']);
    const first = importLayer(sources[0], 0, SHOE, []);
    expect(first).toMatchObject({ x: 640, y: 640, from: 'b', work: 'v1' });
    expect(first.w).toBeCloseTo(241 * 1280 / 1254);
    expect(importLayer(sources[0], 0, SHOE, [first]).key).not.toBe(first.key);
  });

  it('存档读回：好的照存，坏的整个丢掉；单号也存', () => {
    const node = card('a', SHOE, { layerJob: 'job-1' });
    const saved = toDoc({ id: 'c', name: 'c' }, [node], []).nodes[0].data;
    const back = readCard(JSON.parse(JSON.stringify(saved)));
    expect(back?.kind === 'image' && back.layerSplit).toEqual(SHOE);
    expect(back?.kind === 'image' && back.layerJob).toBe('job-1');
    expect(readLayerSplit({ ...SHOE, width: 0 })).toBeUndefined();
    expect(readLayerSplit({ ...SHOE, items: [{ work: 'x', box: [5, 5, 1, 1] }] })?.items).toEqual([]);
  });

  it('收单：成功放上结果、清单号；失败写原话；没跑完不动', () => {
    const nodes = [card('a', undefined, { layerJob: 'j1' }), card('b', undefined, { layerJob: 'j2' }), card('c', undefined, { layerJob: 'j3' })];
    const views: LayerJobView[] = [
      { id: 'j1', kind: 'layers', status: 'succeeded', error: null, source: { type: 'upload', id: 'u-a' },
        layers: { base: 'w0', width: 1280, height: 1280, items: SHOE.items } },
      { id: 'j2', kind: 'layers', status: 'failed', error: '火山没接（400）：太小' },
      { id: 'j3', kind: 'layers', status: 'running', error: null }];
    const [a, b, c] = absorbLayerViews(nodes, views);
    expect(a.data.kind === 'image' && a.data.layerJob).toBeFalsy();
    expect(a.data.kind === 'image' && a.data.layerSplit?.items.length).toBe(2);
    expect(splitMatches(a.data.kind === 'image' ? a.data.layerSplit : undefined, a.data.results[0])).toBe(true);
    expect(b.data.note).toBe('图层分离没成：火山没接（400）：太小');
    expect(c).toBe(nodes[2]);
  });

  it('合并出的新图：不占编号的上传卡，放原卡右边，被占就错开', () => {
    const source = card('a', SHOE);
    const child = mergedChild(source, 'up-1', 'card-x', '鞋.jpg', [source]);
    expect(child.data).toMatchObject({ source: 'upload', number: 0, title: '鞋.jpg 图层合并', results: [{ type: 'upload', id: 'up-1' }] });
    const next = mergedChild(source, 'up-2', 'card-y', '鞋.jpg', [source, child]);
    expect(next.position).not.toEqual(child.position);
  });
});

it('拆分前和重新分离前都写明最多花多少（设计第 5、6 节）', () => {
  expect(LAYER_TEXT.splitHint).toContain('每张约 ¥0.12');
  expect(LAYER_TEXT.splitHint).toContain('最多 17 张，约 ¥2.04');
  expect(LAYER_TEXT.resplit).toContain('最多约 ¥2.04');
});
