import { useCallback, useEffect, useMemo, useState } from 'react';
import { useReactFlow, type Edge } from '@xyflow/react';
import { api } from '@/api';
import { assetUrl, cardTitle, currentResult } from '@/domain/cards';
import { absorbLayerViews, mergedChild, normalizedBoxes, LAYER_TEXT, type Box, type EditLayer } from '@/domain/layers';
import { absorbRedrawViews, redrawPending, redrawResults } from '@/domain/layerRedraw';
import type { CardNode, LayerSplit } from '@/types';
import type { Notify } from '@/common/Toast';
import { requireKey } from '@/common/keyNeeded';
import { composeLayers, pngIfNeeded } from './composeLayers';

const POLL_MS = 2000;
const workUrl = (id: string) => assetUrl({ type: 'work', id });

type Deps = { canvasId: string; nodes: CardNode[]; setNodes: (update: (nodes: CardNode[]) => CardNode[]) => void; notify: Notify };

/**
 * 11-16 图层分离：开 / 关编辑界面、交单、每 2 秒查在拆的单、合并出新图。
 * 单号存在卡上（layerJob），刷新、关了再开都会接着查；拆好的结果留在卡上（layerSplit）。
 */
export function useLayers({ canvasId, nodes, setNodes, notify }: Deps) {
  const flow = useReactFlow<CardNode, Edge>();
  const [openId, setOpenId] = useState<string | null>(null);
  /** 查到的重绘结果（from → work），编辑界面开着时拿去换图。 */
  const [redrawn, setRedrawn] = useState<Array<{ from: string; work: string }>>([]);
  const key = useMemo(() => nodes.flatMap(node => node.data.kind !== 'image' ? []
    : [node.data.layerJob, node.data.layerRedraw?.job].filter((id): id is string => Boolean(id))).join(','), [nodes]);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    const tick = async () => {
      try {
        const views = await api.getLayerJobs(key.split(','));
        if (!alive) return;
        setNodes(list => absorbRedrawViews(absorbLayerViews(list, views), views));
        const done = redrawResults(views);
        if (done.length) setRedrawn(list => [...list, ...done.filter(item => !list.some(old => old.work === item.work))]);
      } catch { /* 小服务暂时连不上，下一轮再问 */ }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [key, setNodes]);

  /** 交一单。rects 是在原图像素上框的（可能反着拖）；出错抛人话，界面显示。 */
  const split = useCallback(async (cardId: string, text: string, rects: Box[], size: { width: number; height: number }) => {
    const card = flow.getNode(cardId);
    const current = card?.data.kind === 'image' ? currentResult(card.data) : null;
    if (!card || !current) throw new Error('这张卡上没有图。');
    await requireKey();
    const png = await pngIfNeeded(assetUrl(current));
    const source = png ? { type: 'upload' as const, id: (await api.upload(png)).id } : { type: current.type, id: current.id };
    const { id } = await api.submitLayerJob({ canvasId, cardId, source, origin: { type: current.type, id: current.id }, text,
      boxes: normalizedBoxes(rects, size.width, size.height) });
    setNodes(list => list.map(node => node.id === cardId && node.data.kind === 'image' ? { ...node, data: { ...node.data, layerJob: id, note: null } } : node));
  }, [canvasId, flow, setNodes]);

  /** 图层重绘：选中的一层 + 一句话交给火山；单号和落回去的位置记在卡上。出错抛人话，界面显示。 */
  const redraw = useCallback(async (cardId: string, layer: EditLayer, text: string) => {
    await requireKey();
    const { id } = await api.submitLayerRedraw({ canvasId, cardId, layer: layer.work, name: layer.name, text });
    setNodes(list => list.map(node => node.id === cardId && node.data.kind === 'image'
      ? { ...node, data: { ...node.data, layerRedraw: redrawPending(id, layer), note: null } } : node));
  }, [canvasId, setNodes]);

  /** 合并：本机按原尺寸合成，存成上传图，原卡右边放一张新卡。 */
  const merge = useCallback(async (cardId: string, layerSplit: LayerSplit, layers: readonly EditLayer[]) => {
    const blob = await composeLayers(workUrl(layerSplit.base), layerSplit.width, layerSplit.height, layers, workUrl);
    const { id: uploadId } = await api.upload(blob);
    const source = flow.getNode(cardId);
    if (!source) throw new Error('原卡已经不在画布上了。');
    const id = `card-${crypto.randomUUID().slice(0, 8)}`;
    setNodes(list => [...list, mergedChild(source, uploadId, id, cardTitle(source.data), list)]);
    notify(LAYER_TEXT.merged);
  }, [flow, setNodes, notify]);

  return { openId, open: setOpenId, close: () => setOpenId(null), split, merge, redraw, redrawn };
}
