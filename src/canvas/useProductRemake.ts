import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useReactFlow, type Edge } from '@xyflow/react';
import { api } from '@/api';
import { askIfAgentMissing } from '@/common/agentNeeded';
import { currentResult } from '@/domain/cards';
import { startProductRemake, prepareProductCards, productStartProblem, addProductImage, addProductGroup, addProductBackground, setProductSameAs } from '@/domain/productRemake';
import { rewriteSourceProblem } from '@/domain/videoRewrite';
import { activeRewriteSources } from '@/domain/rewriteProgress';
import type { RewriteColumn } from '@/domain/videoRewriteLayout';
import type { CardNode, VideoCardData } from '@/types';
import type { Notify } from '@/common/Toast';

type Deps = { canvasId: string; nodes: CardNode[]; setNodes: (update: (nodes: CardNode[]) => CardNode[]) => void;
  setEdges: (update: (edges: Edge[]) => Edge[]) => void; takeNumber: () => number; notify: Notify;
  focus?: (id: string) => void; reveal?: (id: string) => void; layout?: (id: string, column: RewriteColumn) => void };
const pending = new Set<string>(), drafts = new Map<string, string>(), listeners = new Set<() => void>();
let version = 0;
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const snapshot = () => version;
const changed = () => { version++; for (const fn of listeners) fn(); };
const makeId = () => `card-${crypto.randomUUID().slice(0, 8)}`;
const clean = ({ rewriteBusy: _busy, rewriteStatus: _status, rewriteTask: _task, ...data }: VideoCardData): VideoCardData => data;
export function useProductRemake({ canvasId, nodes, setNodes, setEdges, takeNumber, notify, focus, reveal, layout }: Deps) {
  const flow = useReactFlow<CardNode, Edge>();
  const alive = useRef(true), activeCanvas = useRef(canvasId), openedSource = useRef<string | null>(null);
  activeCanvas.current = canvasId;
  const active = () => alive.current && activeCanvas.current === canvasId;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [inputId, setInputId] = useState<string | null>(null);
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const keyOf = (id: string) => {
    const result = currentResult(flow.getNode(id)?.data ?? { results: [], page: 0 });
    return `${canvasId}:${result?.type}:${result?.id ?? id}`;
  };
  useEffect(() => {
    if (inputId && (nodes.filter(n => n.selected).length !== 1 || !nodes.find(n => n.id === inputId)?.selected || keyOf(inputId) !== openedSource.current)) setInputId(null);
  }, [nodes, inputId]);
  useEffect(() => { setInputId(null); }, [canvasId]);
  const patch = (ids: string[], change: (data: VideoCardData) => VideoCardData) => {
    if (active()) setNodes(list => list.map(n => ids.includes(n.id) && n.data.kind === 'video' ? { ...n, data: change(n.data) } : n));
  };
  const start = (id: string) => {
    const node = flow.getNode(id);
    const problem = node?.data.kind === 'video' ? rewriteSourceProblem(currentResult(node.data)) : '先选一张有结果的视频卡。';
    if (problem) { notify(problem); return; }
    if (activeRewriteSources.has(id)) { notify('这条视频正在拆解，做完再来。'); return; }
    openedSource.current = keyOf(id); setInputId(id); reveal?.(id);
  };
  const run = async (sourceId: string, userText: string) => {
    const key = keyOf(sourceId), source = flow.getNode(sourceId);
    if (!source || pending.has(key) || activeRewriteSources.has(sourceId) || source.data.rewriteBusy || !userText.trim()) return;
    pending.add(key); activeRewriteSources.add(sourceId); changed();
    let graph: ReturnType<typeof startProductRemake>;
    try {
      const health = await api.health();
      if (!active() || keyOf(sourceId) !== key) { pending.delete(key); activeRewriteSources.delete(sourceId); changed(); return; }
      if (askIfAgentMissing(health)) { pending.delete(key); activeRewriteSources.delete(sourceId); changed(); return; }
      const problem = productStartProblem(health);
      if (problem) { pending.delete(key); activeRewriteSources.delete(sourceId); changed(); return problem; }
      graph = startProductRemake({ source, userText, nodes: flow.getNodes(), edges: flow.getEdges(), takeNumber, makeId });
    } catch (error) { pending.delete(key); activeRewriteSources.delete(sourceId); changed(); return (error as Error).message; }
    const { videoId, state } = graph;
    const ids = [sourceId, videoId]; ids.forEach(id => activeRewriteSources.add(id));
    drafts.set(key, userText); setInputId(null);
    const output = graph.nodes.find(n => n.id === videoId)!;
    setNodes(list => [...list.filter(n => n.id !== videoId).map(n => ({ ...n, selected: false,
      ...(n.id === sourceId && n.data.kind === 'video' ? { data: { ...n.data, rewriteTask: 'product' as const, rewriteBusy: 'analyzing' as const, rewriteStatus: { status: 'pending' as const } } } : {}) })),
      { ...output, data: { ...output.data, rewriteBusy: 'analyzing' } }]);
    setEdges(list => [...list.filter(e => e.source !== sourceId || e.target !== videoId), ...graph.edges.filter(e => e.source === sourceId && e.target === videoId)]);
    try {
      const result = await api.analyzeProduct({ cardId: state.batchId, source: state.source, userText });
      if (!active()) return;
      if (!flow.getNode(videoId)) { patch([sourceId], clean); notify('拆解已结束，新视频卡已移走'); return; }
      const currentNodes = flow.getNodes(), currentEdges = flow.getEdges();
      const prepared = prepareProductCards({ nodes: currentNodes, edges: currentEdges, state, plan: result.plan, takeNumber, makeId });
      const added = prepared.nodes.filter(n => !currentNodes.some(old => old.id === n.id));
      const video = prepared.nodes.find(n => n.id === videoId)!;
      setNodes(list => [...list.map(n => n.id === videoId ? { ...n, selected: true, data: video.data } : { ...n, selected: false }), ...added]);
      setEdges(list => [...list, ...prepared.edges.filter(e => !currentEdges.some(old => old.id === e.id))]);
      patch([sourceId], clean);
      if (added.length) layout?.(`${state.batchId}:products`, { ids: added.map(n => n.id), movableIds: added.map(n => n.id), origin: added[0].position, gap: 120,
        productVideoId: videoId });
      focus?.(videoId);
      notify(`商品卡已铺好：补完 ${added.length} 张图后，点「生成提示词」`);
    } catch (error) {
      const message = (error as Error).message;
      patch(ids, data => ({ ...data, rewriteStatus: { status: 'failed', error: message } }));
      notify(`拆解没成功：${message}`);
    } finally {
      patch(ids, ({ rewriteBusy: _busy, ...data }) => data);
      ids.forEach(id => activeRewriteSources.delete(id)); pending.delete(key); changed();
    }
  };
  const add = (action: typeof addProductGroup | typeof addProductBackground, videoId: string) => {
    try { const graph = action({ nodes: flow.getNodes(), edges: flow.getEdges(), videoId, takeNumber, makeId }); setNodes(() => graph.nodes); setEdges(() => graph.edges); }
    catch (error) { notify((error as Error).message); }
  };
  const inGroup = (groupId: string, target?: string | null) => {
    const args = { nodes: flow.getNodes(), edges: flow.getEdges(), groupId, takeNumber, makeId };
    try { const graph = target === undefined ? addProductImage(args) : setProductSameAs({ ...args, target }); setNodes(() => graph.nodes); setEdges(() => graph.edges); }
    catch (error) { notify((error as Error).message); }
  };
  const addImage = (groupId: string) => inGroup(groupId);
  return { inputId, start, close: () => setInputId(null), run, isPending: (id: string) => pending.has(keyOf(id)),
    textFor: (id: string) => drafts.get(keyOf(id)) ?? '', remember: (id: string, text: string) => drafts.set(keyOf(id), text),
    addImage, addProduct: (id: string) => add(addProductGroup, id), addBackground: (id: string) => add(addProductBackground, id),
    setSameAs: (groupId: string, target: string | null) => inGroup(groupId, target) };
}
