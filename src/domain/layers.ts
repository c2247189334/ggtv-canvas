/**
 * 11-16 图层分离（设计 docs/specs/2026-11-16-图层分离换标-design.md）的纯逻辑。
 * 坐标一律用「底图像素」：x、y 是图层中心，w、h 是在底图上显示多大（火山给的图层文件比框大好几倍，按框的大小显示）。
 */
import type { AssetRef, CardNode, LayerJobView, LayerRedrawView, LayerSplit } from '@/types';
import { newCanvasCard } from './cards';
import { rightOf } from './placement';
import { stackedFrameSpot } from './videoFrame';

export type Box = [number, number, number, number];
export type EditLayer = { key: string; work: string; name: string; x: number; y: number; w: number; h: number;
  rotation: number; flipX: boolean; flipY: boolean; hidden: boolean;
  /** 从别的卡加进来的（添加图层）记来源卡标题，清单里显示。 */
  from?: string };
export type Order = 'up' | 'down' | 'top' | 'bottom';

/** 拆分按拆出的张数算钱（底图也算一张）。单价和上限跟小服务一致：server/pricing.mjs 的 Flash 单价、server/layerSplit.mjs 的 MAX_LAYER_IMAGES，改了两边一起改。 */
export const LAYER_YUAN = 0.12, MAX_LAYER_IMAGES = 17;
const maxYuan = (LAYER_YUAN * MAX_LAYER_IMAGES).toFixed(2);

/** 页面上写的原话（用户定照参考软件），集中放这里，测试和界面共用。 */
export const LAYER_TEXT = {
  input: '描述或框选希望拆分的图层，留空将自动识别并拆分',
  // 设计第 5、6 节：交单前写明最多花多少（留空全拆比点名拆贵好几倍）。
  splitHint: `框选或描述要拆出来的东西。拆出几张图算几张的钱（底图也算，每张约 ¥${LAYER_YUAN}）；留空自动拆最多 ${MAX_LAYER_IMAGES} 张，约 ¥${maxYuan}`,
  splitting: '图层分离中',
  // 参考软件写「不消耗积分」「消耗 1 次分离额度」；这里没有积分，改成说花不花钱。
  editHint: '调整图层位置或尺寸，合并生成新图片（本机合成，不花钱）',
  resplitTitle: '重新分离图层？',
  resplit: `会重新提交一次分离任务并覆盖当前图层与排版，要再付一次拆分的钱（按拆出的张数算，最多约 ¥${maxYuan}）。`,
  discardTitle: '放弃本次图层调整？',
  discard: (count: number) => `已调整 ${count} 个图层且尚未生成，关闭后不会保留。已分离的图层会保留在原节点，下次可直接打开。`,
  merged: '图层合并完成'
};

export const MAX_SELECTIONS = 16;
const MIN_SIZE = 4;

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isBox = (raw: unknown): raw is Box => Array.isArray(raw) && raw.length === 4 && raw.every(isNum) && raw[2] > raw[0] && raw[3] > raw[1];

/** 读存档 / 小服务回的图层结果；坏的整个丢掉。 */
export function readLayerSplit(raw: unknown, source?: AssetRef): LayerSplit | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Record<string, unknown>;
  const from = (d.source ?? source) as AssetRef | undefined;
  if (!from || (from.type !== 'upload' && from.type !== 'work') || typeof from.id !== 'string') return undefined;
  if (typeof d.base !== 'string' || !isNum(d.width) || !isNum(d.height) || d.width <= 0 || d.height <= 0 || !Array.isArray(d.items)) return undefined;
  const items = d.items.flatMap(item => {
    const i = (item ?? {}) as Record<string, unknown>;
    return typeof i.work === 'string' && isBox(i.box) ? [{ work: i.work, name: typeof i.name === 'string' && i.name ? i.name : '图层', box: [...i.box] as Box }] : [];
  });
  return { source: { type: from.type, id: from.id }, base: d.base, width: d.width, height: d.height, items };
}

/** 拆好后的初始排版：每层放回它在原图上的位置。 */
export function initialLayers(split: LayerSplit): EditLayer[] {
  return split.items.map((item, index) => {
    const [x1, y1, x2, y2] = item.box;
    return { key: `L${index + 1}-${item.work}`, work: item.work, name: item.name, x: (x1 + x2) / 2, y: (y1 + y2) / 2,
      w: x2 - x1, h: y2 - y1, rotation: 0, flipX: false, flipY: false, hidden: false };
  });
}

/** 和初始排版比，动过几个图层（关掉前的确认框用）；加进来的、删掉的都算。换了图（图层重绘）不算：重绘结果已经存在卡上。 */
export function changedCount(initial: readonly EditLayer[], current: readonly EditLayer[]): number {
  const before = new Map(initial.map(layer => [layer.key, layer]));
  const kept = current.filter(layer => before.has(layer.key));
  const keptBefore = initial.filter(layer => kept.some(item => item.key === layer.key));
  // 删掉的 + 新加的 + 原有的里面改过或相互前后顺序变了的（新加一层放最底下，不算把原有的都挪了）。
  let count = initial.length - kept.length + current.length - kept.length;
  kept.forEach((layer, index) => {
    const same = JSON.stringify({ ...before.get(layer.key), work: '' }) === JSON.stringify({ ...layer, work: '' });
    if (!same || keptBefore[index].key !== layer.key) count += 1;
  });
  return count;
}

export const patchLayer = (list: readonly EditLayer[], key: string, patch: Partial<EditLayer>) =>
  list.map(layer => layer.key === key ? { ...layer, ...patch } : layer);

/** 按比例缩放（拖角）：以中心为准，不小于 4 像素。 */
export function scaleLayer(layer: EditLayer, factor: number): Partial<EditLayer> {
  const safe = Math.max(factor, MIN_SIZE / Math.min(layer.w, layer.h));
  return { w: layer.w * safe, h: layer.h * safe };
}

/** 适配画布：按比例放满底图（不裁）、居中、转正。 */
export function fitLayer(layer: EditLayer, width: number, height: number): Partial<EditLayer> {
  const factor = Math.min(width / layer.w, height / layer.h);
  return { x: width / 2, y: height / 2, w: layer.w * factor, h: layer.h * factor, rotation: 0 };
}

/** 上移 / 下移一层、置顶 / 置底。数组后面的盖在上面。 */
export function reorder(list: readonly EditLayer[], key: string, order: Order): EditLayer[] {
  const index = list.findIndex(layer => layer.key === key);
  if (index < 0) return [...list];
  const rest = list.filter(layer => layer.key !== key), layer = list[index];
  const to = order === 'top' ? rest.length : order === 'bottom' ? 0
    : Math.min(rest.length, Math.max(0, index + (order === 'up' ? 1 : -1)));
  return [...rest.slice(0, to), layer, ...rest.slice(to)];
}

/** 拖动角度：鼠标相对中心的角度换成度数，按住 Shift 吸到 15 度。 */
export function angleOf(center: { x: number; y: number }, point: { x: number; y: number }, snap = false): number {
  const degrees = Math.atan2(point.x - center.x, center.y - point.y) * 180 / Math.PI;
  return snap ? Math.round(degrees / 15) * 15 : Math.round(degrees * 10) / 10;
}

/** 框选（底图像素，可能是反着拖的）换成火山要的 0~1000 归一化整数框；太小（不到 1 个单位）的丢掉。 */
export function normalizedBoxes(rects: readonly Box[], width: number, height: number): Box[] {
  return rects.flatMap(([ax, ay, bx, by]) => {
    const clamp = (v: number, max: number) => Math.min(1000, Math.max(0, Math.round(v / max * 1000)));
    const box: Box = [clamp(Math.min(ax, bx), width), clamp(Math.min(ay, by), height), clamp(Math.max(ax, bx), width), clamp(Math.max(ay, by), height)];
    return box[2] > box[0] && box[3] > box[1] ? [box] : [];
  });
}

/** 「添加图层」能加的：画布上别的卡拆出来的图层。 */
export type LayerSourceCard = { cardId: string; title: string; split: LayerSplit };
export function layerSources(nodes: readonly CardNode[], cardId: string, titleOf: (node: CardNode) => string): LayerSourceCard[] {
  return nodes.flatMap(node => node.id !== cardId && node.data.kind === 'image' && node.data.layerSplit?.items.length
    ? [{ cardId: node.id, title: titleOf(node), split: node.data.layerSplit }] : []);
}

/** 把别的卡的一层加进来：按两张底图的宽度比换算大小（同一只鞋拍得差不多大时，标也差不多大），放在正中、最上面。 */
export function importLayer(source: LayerSourceCard, index: number, target: { width: number; height: number }, taken: readonly EditLayer[]): EditLayer {
  const item = source.split.items[index];
  const scale = target.width / source.split.width;
  const [x1, y1, x2, y2] = item.box;
  let n = 1;
  while (taken.some(layer => layer.key === `add${n}-${item.work}`)) n += 1;
  return { key: `add${n}-${item.work}`, work: item.work, name: item.name, x: target.width / 2, y: target.height / 2,
    w: (x2 - x1) * scale, h: (y2 - y1) * scale, rotation: 0, flipX: false, flipY: false, hidden: false, from: source.title };
}

/** 查到跑完的图层单：成功把结果放上卡（覆盖上次拆的），失败把原话写进卡的提示；没跑完、不是这张卡的原样返回。 */
export function absorbLayerViews(nodes: CardNode[], views: readonly (LayerJobView | LayerRedrawView)[]): CardNode[] {
  return nodes.map(node => {
    const data = node.data;
    if (data.kind !== 'image' || !data.layerJob) return node;
    const view = views.find((item): item is LayerJobView => item.kind === 'layers' && item.id === data.layerJob);
    if (!view || view.status === 'queued' || view.status === 'running') return node;
    const { layerJob: _layerJob, ...rest } = data;
    const split = view.status === 'succeeded' && view.layers ? readLayerSplit({ ...view.layers, source: view.source }) : undefined;
    if (split) return { ...node, data: { ...rest, layerSplit: split, note: null } };
    return { ...node, data: { ...rest, note: `图层分离没成：${view.error ?? '结果不明，没有自动重发。'}` } };
  });
}

/** 合并出的新图：不占编号的上传图片卡，放在原卡右边（被占就往右下错开），标题「原名 图层合并」。 */
export function mergedChild(source: CardNode, uploadId: string, id: string, title: string, nodes: readonly CardNode[]): CardNode {
  const data = newCanvasCard('upload', () => 0, [{ type: 'upload', id: uploadId }], 'image', `${title} 图层合并`);
  return { id, type: 'card', position: stackedFrameSpot(rightOf(source.position), nodes), selected: false, data };
}

/** 卡片当前那张图和拆过的是不是同一张（翻页后要重新拆）。 */
export function splitMatches(split: LayerSplit | undefined, current: AssetRef | null): split is LayerSplit {
  return Boolean(split && current && split.source.type === current.type && split.source.id === current.id);
}
