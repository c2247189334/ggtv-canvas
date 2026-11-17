import { describe, expect, it } from 'vitest';
import { absorbRedrawViews, applyRedraw, readLayerRedraw, redrawPending, redrawResults, swapRedrawn } from './layerRedraw';
import { changedCount, importLayer, initialLayers } from './layers';
import { readCard, toDoc } from './canvasDoc';
import { copySelection, pasteClipboard } from './clipboard';
import { newCanvasCard } from './cards';
import type { CardNode, LayerRedrawView, LayerSplit } from '@/types';

const SHOE: LayerSplit = { source: { type: 'upload', id: 'u1' }, base: 'w0', width: 1280, height: 1280, items: [
  { work: 'w1', name: '黑色勾形品牌标志', box: [540, 583, 703, 717] }] };
const STRIPES: LayerSplit = { source: { type: 'upload', id: 'u2' }, base: 'v0', width: 1254, height: 1254, items: [
  { work: 'v1', name: '三条斜杠', box: [539, 538, 780, 702] }] };

function card(extra: Record<string, unknown> = {}): CardNode {
  const data = newCanvasCard('upload', () => 0, [SHOE.source], 'image', 'shoe.jpg');
  return { id: 'a', type: 'card', position: { x: 0, y: 0 }, data: { ...data, layerSplit: SHOE, ...extra } as CardNode['data'] };
}
const view = (patch: Partial<LayerRedrawView>): LayerRedrawView => ({ id: 'j1', kind: 'layer-redraw', status: 'succeeded', error: null,
  redraw: { from: 'w1', work: 'w9' }, ...patch });

describe('图层重绘纯逻辑', () => {
  it('卡自己的层：原地换图，位置不变；别卡加进来的层：新加一层，位置记成摆的地方', () => {
    const own = initialLayers(SHOE)[0];
    expect(applyRedraw(SHOE, redrawPending('j1', own), 'w9').items).toEqual([{ ...SHOE.items[0], work: 'w9' }]);
    const added = { ...importLayer({ cardId: 'b', title: 'b', split: STRIPES }, 0, SHOE, []), x: 300, y: 400 };
    const pending = redrawPending('j2', added);
    expect(pending.box).toEqual([Math.round(300 - added.w / 2), Math.round(400 - added.h / 2), Math.round(300 + added.w / 2), Math.round(400 + added.h / 2)]);
    const next = applyRedraw(SHOE, pending, 'v9');
    expect(next.items.length).toBe(2);
    expect(next.items[1]).toEqual({ work: 'v9', name: '三条斜杠 重绘', box: pending.box });
    // 同一层再重绘一次：已经在卡上了，原地换，不重复加。
    expect(applyRedraw(next, { ...pending, from: 'v9' }, 'v10').items.map(item => item.work)).toEqual(['w1', 'v10']);
  });

  it('收单：成功换上新图层、清掉单号；失败写提示；没跑完不动', () => {
    const pending = redrawPending('j1', initialLayers(SHOE)[0]);
    const node = card({ layerRedraw: pending });
    const done = absorbRedrawViews([node], [view({})])[0].data;
    expect(done.kind === 'image' && done.layerRedraw).toBeFalsy();
    expect(done.kind === 'image' && done.layerSplit?.items[0].work).toBe('w9');
    expect(absorbRedrawViews([node], [view({ status: 'running' })])[0]).toBe(node);
    const failed = absorbRedrawViews([node], [view({ status: 'failed', error: '火山没接（400）：x', redraw: null })])[0].data;
    expect(failed.note).toBe('图层重绘没成：火山没接（400）：x');
    expect(failed.kind === 'image' && failed.layerSplit?.items[0].work).toBe('w1');
    expect(absorbRedrawViews([node], [{ id: 'j1', kind: 'layers', status: 'succeeded', error: null }])[0], '图层分离单不算').toBe(node);
  });

  it('编辑界面换图：能换的才换；换图不算「调整过」（重绘已存在卡上）', () => {
    const initial = initialLayers(SHOE);
    const swapped = swapRedrawn(initial, 'w1', 'w9')!;
    expect(swapped[0].work).toBe('w9');
    expect(swapRedrawn(initial, 'nope', 'w9')).toBeNull();
    expect(changedCount(initial, swapped)).toBe(0);
    expect(redrawResults([view({}), view({ id: 'j2', status: 'failed', redraw: null })])).toEqual([{ from: 'w1', work: 'w9' }]);
  });

  it('在跑的重绘单进存档、读回来一样；坏的丢掉；复制出的副本不带', () => {
    const pending = { job: 'j1', from: 'w1', name: '标', box: [1, 2, 3, 4] as [number, number, number, number] };
    expect(readLayerRedraw(pending)).toEqual(pending);
    expect(readLayerRedraw({ ...pending, box: [3, 2, 1, 4] })).toBeUndefined();
    expect(readLayerRedraw({ ...pending, job: '' })).toBeUndefined();
    const node = card({ layerRedraw: pending });
    const saved = toDoc({ id: 'c', name: 'c' }, [node], []).nodes[0];
    const back = readCard(JSON.parse(JSON.stringify(saved.data)));
    expect(back?.kind === 'image' && back.layerRedraw).toEqual(pending);
    const copy = pasteClipboard(copySelection([{ ...node, selected: true }], []), null).nodes[0].data;
    expect(copy.kind === 'image' && copy.layerRedraw).toBeFalsy();
    expect(copy.kind === 'image' && copy.layerSplit).toEqual(SHOE);
  });
});
