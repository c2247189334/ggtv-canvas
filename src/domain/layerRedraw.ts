/**
 * 11-16 图层重绘（设计 docs/specs/2026-11-16-图层分离换标-design.md 第 5 节）的纯逻辑：
 * 对选中的一层写一句话，AI 只重画这一层（透明底进、透明底出，一张图的钱）。
 * 出好的图层落回卡上的 layerSplit，关了界面也不丢：
 *  - 卡自己拆出来的层（清单里有这张作品）：原地换成新图，位置不变；
 *  - 从别的卡加进来的层：在这张卡上新加一层，位置记成重绘时摆的地方（旋转、翻转不记，下次打开要再调）。
 */
import type { CardNode, LayerJobView, LayerRedrawPending, LayerRedrawView, LayerSplit } from '@/types';
import type { Box, EditLayer } from './layers';

/** 页面上写的原话：输入框照参考软件「描述你想如何重绘当前图层」。 */
export const REDRAW_TEXT = {
  input: '描述你想如何重绘当前图层',
  button: '图层重绘',
  busy: '图层重绘中',
  cost: '花一张图的钱（Flash 约 ¥0.12）',
  failed: '图层重绘没成'
};
export const MAX_REDRAW_TEXT = 500;

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** 读存档里在跑的重绘单；坏的丢掉。 */
export function readLayerRedraw(raw: unknown): LayerRedrawPending | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Record<string, unknown>;
  const box = d.box;
  if (typeof d.job !== 'string' || !d.job || typeof d.from !== 'string' || !d.from) return undefined;
  if (!Array.isArray(box) || box.length !== 4 || !box.every(isNum) || box[2] <= box[0] || box[3] <= box[1]) return undefined;
  return { job: d.job, from: d.from, name: typeof d.name === 'string' && d.name ? d.name : '图层', box: [...box] as Box };
}

/** 交单时记下的：box 是这一层此刻摆在底图上的范围（不算旋转）。 */
export function redrawPending(job: string, layer: EditLayer): LayerRedrawPending {
  const round = (value: number) => Math.round(value);
  return { job, from: layer.work, name: layer.name,
    box: [round(layer.x - layer.w / 2), round(layer.y - layer.h / 2), round(layer.x + layer.w / 2), round(layer.y + layer.h / 2)] };
}

/** 出好的新图落回卡上的图层清单。 */
export function applyRedraw(split: LayerSplit, pending: LayerRedrawPending, work: string): LayerSplit {
  if (split.items.some(item => item.work === pending.from)) {
    return { ...split, items: split.items.map(item => item.work === pending.from ? { ...item, work } : item) };
  }
  return { ...split, items: [...split.items, { work, name: `${pending.name} 重绘`, box: pending.box }] };
}

type View = LayerJobView | LayerRedrawView;
const isRedraw = (view: View): view is LayerRedrawView => view.kind === 'layer-redraw';

/** 查到跑完的重绘单：成功换上新图层，失败把原话写进卡的提示；没跑完、不是这张卡的原样返回。 */
export function absorbRedrawViews(nodes: CardNode[], views: readonly View[]): CardNode[] {
  return nodes.map(node => {
    const data = node.data;
    if (data.kind !== 'image' || !data.layerRedraw) return node;
    const pending = data.layerRedraw;
    const view = views.find((item): item is LayerRedrawView => isRedraw(item) && item.id === pending.job);
    if (!view || view.status === 'queued' || view.status === 'running') return node;
    const { layerRedraw: _pending, ...rest } = data;
    const work = view.status === 'succeeded' ? view.redraw?.work : undefined;
    if (work) return { ...node, data: { ...rest, ...(rest.layerSplit ? { layerSplit: applyRedraw(rest.layerSplit, pending, work) } : {}), note: null } };
    return { ...node, data: { ...rest, note: `${REDRAW_TEXT.failed}：${view.error ?? '结果不明，没有自动重发。'}` } };
  });
}

/** 这一轮查到的重绘结果（from → work），编辑界面开着时拿去换掉对应的层。 */
export function redrawResults(views: readonly View[]): Array<{ from: string; work: string }> {
  return views.flatMap(view => isRedraw(view) && view.status === 'succeeded' && view.redraw ? [view.redraw] : []);
}

/** 编辑界面里把送去重绘的那层换成新图（记一步，能撤销）；没有这一层返回 null。 */
export function swapRedrawn(layers: readonly EditLayer[], from: string, work: string): EditLayer[] | null {
  if (!layers.some(layer => layer.work === from)) return null;
  return layers.map(layer => layer.work === from ? { ...layer, work } : layer);
}
