import { useEffect, useRef, useState } from 'react';
import { useReactFlow, type Edge } from '@xyflow/react';
import { api } from '@/api';
import { currentResult } from '@/domain/cards';
import { clipChild, type ClipRange } from '@/domain/videoClip';
import { localMediaProblem } from '@/domain/localMedia';
import type { AssetRef, CardNode } from '@/types';
import type { Notify } from '@/common/Toast';

export type ClipSession = { cardId: string; asset: AssetRef; duration: number; source: CardNode };
type Deps = { canvasId: string; nodes: CardNode[]; setNodes: (update: (nodes: CardNode[]) => CardNode[]) => void;
  setEdges: (update: (edges: Edge[]) => Edge[]) => void; notify: Notify };

/** 会话放在画布层，处理期间取消选中仍等待同一结果；失败保留原选区。 */
export function useVideoClip({ canvasId, nodes, setNodes, setEdges, notify }: Deps) {
  const flow = useReactFlow<CardNode, Edge>();
  const [session, setSession] = useState<ClipSession | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<ClipSession | null>(null);
  const pending = useRef(false);
  const checking = useRef(false);
  const close = () => {
    if (pending.current) return;
    active.current = null; setSession(null);
  };
  useEffect(() => {
    if (session && !pending.current && (nodes.filter(n => n.selected).length !== 1 || !nodes.find(n => n.id === session.cardId)?.selected)) close();
  }, [nodes, session]);

  const start = async (cardId: string) => {
    if (checking.current || pending.current) return;
    const source = flow.getNode(cardId), asset = source && currentResult(source.data);
    if (!source?.selected || flow.getNodes().filter(n => n.selected).length !== 1 || source.data.kind !== 'video'
      || source.data.source === 'depth' || !asset || asset.depth) return;
    const duration = asset.seconds;
    if (typeof duration !== 'number' || !Number.isFinite(duration)) { notify('还没读到视频时长，请稍后重试。'); return; }
    if (duration < 1) { notify('视频不到 1 秒，不能截取'); return; }
    checking.current = true;
    try {
      const problem = localMediaProblem(await api.health(), 'audio');
      if (problem) { notify(problem); return; }
      const latestSource = flow.getNode(cardId), latestAsset = latestSource && currentResult(latestSource.data);
      if (!latestSource?.selected || flow.getNodes().filter(n => n.selected).length !== 1
        || latestAsset?.type !== asset.type || latestAsset.id !== asset.id) return;
      const next = { cardId, asset: { ...asset }, duration, source };
      active.current = next; setSession(next);
    } catch (error) { notify((error as Error).message); }
    finally { checking.current = false; }
  };
  const confirm = async (range: ClipRange) => {
    const current = active.current;
    if (!current || pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const upload = await api.clipVideo({ source: { type: current.asset.type, id: current.asset.id },
        ...range, canvasId, cardId: current.cardId });
      const created = clipChild(flow.getNode(current.cardId) ?? current.source, current.asset, upload, `card-${crypto.randomUUID().slice(0, 8)}`);
      setNodes(list => [...list.map(node => node.selected ? { ...node, selected: false } : node), created.node]);
      setEdges(list => [...list, created.edge]);
      active.current = null; setSession(null);
    } catch (error) { notify((error as Error).message); }
    finally { pending.current = false; setBusy(false); }
  };
  return { session, busy, start, close, confirm };
}
