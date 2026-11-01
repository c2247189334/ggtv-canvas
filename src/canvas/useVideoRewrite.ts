import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useReactFlow, type Edge } from '@xyflow/react';
import { api } from '@/api';
import { startVideoRewrite, prepareRewriteCards, addRewriteBackground, rewriteSourceProblem, rewriteStartProblem } from '@/domain/videoRewrite';
import { restoreRewriteProgress, rewriteCharge } from '@/domain/rewriteProgress';
import { currentResult, DEFAULT_GEN } from '@/domain/cards';
import { estimateYuan, formatSpent, formatYuan } from '@/domain/pricing';
import { localMediaProblem } from '@/domain/localMedia';
import { retryRewriteMedia } from '@/domain/rewriteMedia';
import { rightOf } from '@/domain/placement';
import type { RewriteColumn } from '@/domain/videoRewriteLayout';
import type { AssetRef, CardNode, VideoCardData } from '@/types';
import type { Notify } from '@/common/Toast';
import type { VideoRewriteState } from '@/videoRewriteTypes';
import type { MotionReference } from '@/domain/motionReference';

type Deps = { canvasId: string; nodes?: CardNode[]; setNodes: (update: (nodes: CardNode[]) => CardNode[]) => void;
  setEdges: (update: (edges: Edge[]) => Edge[]) => void; takeNumber: () => number; notify: Notify;
  layout?: (id: string, column: RewriteColumn) => void; focus?: (id: string) => void; send?: (id: string) => Promise<void> };
type MediaGraph = { nodes: CardNode[]; edges: Edge[]; depthId?: string };
const makeId = () => `card-${crypto.randomUUID().slice(0, 8)}`;
// 页面存活期间保留；切换画布重建组件也能取回，刷新页面自然清空。
const drafts = new Map<string, string>();
const pending = new Set<string>(), pendingListeners = new Set<() => void>();
const activeSources = new Set<string>();
let pendingVersion = 0;
const subscribePending = (listener: () => void) => { pendingListeners.add(listener); return () => { pendingListeners.delete(listener); }; };
const pendingSnapshot = () => pendingVersion;
const refreshPending = () => { pendingVersion++; for (const listener of pendingListeners) listener(); };
const clearStatus = ({ rewriteStatus: _status, rewriteBusy: _busy, ...data }: VideoCardData): VideoCardData => data;
const clearBusy = ({ rewriteBusy: _busy, ...data }: VideoCardData): VideoCardData => data;

export function useVideoRewrite({ canvasId, nodes, setNodes, setEdges, takeNumber, notify, layout, focus, send }: Deps) {
  const flow = useReactFlow<CardNode, Edge>();
  const mediaPending = useRef(new Set<string>());
  const openedSource = useRef<string | null>(null);
  const [inputId, setInputId] = useState<string | null>(null);
  useSyncExternalStore(subscribePending, pendingSnapshot, pendingSnapshot);
  const activeCanvas = useRef(canvasId);
  const alive = useRef(true);
  activeCanvas.current = canvasId;
  const isActive = () => alive.current && activeCanvas.current === canvasId;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const sourceKey = (id: string) => {
    const asset = currentResult(flow.getNode(id)?.data ?? { results: [], page: 0 });
    return asset ? `${asset.type}:${asset.id}` : id;
  };
  const draftKey = (id: string) => `${canvasId}:${sourceKey(id)}`;
  useEffect(() => {
    if (inputId && nodes && (nodes.filter(node => node.selected).length !== 1 || !nodes.find(node => node.id === inputId)?.selected ||
      sourceKey(inputId) !== openedSource.current)) setInputId(null);
  }, [nodes, inputId]);
  useEffect(() => { setInputId(null); }, [canvasId]);
  const updateSource = (id: string, change: (data: VideoCardData) => VideoCardData, videoId?: string) => {
    if (!isActive()) return;
    setNodes(list => list.map(node => (node.id === id || node.id === videoId) && node.data.kind === 'video' ? { ...node, data: change(node.data) } : node));
  };
  const start = (sourceId: string) => {
    const source = flow.getNode(sourceId);
    const problem = source?.data.kind === 'video' ? rewriteSourceProblem(currentResult(source.data)) : '先选一张有结果的视频卡。';
    if (problem) { notify(problem); return; }
    if (!pending.has(sourceKey(sourceId))) updateSource(sourceId, data => data.rewriteStatus ? clearStatus(data) : data);
    openedSource.current = sourceKey(sourceId); setInputId(sourceId);
  };
  const dispatchMedia = async (node: CardNode, source: AssetRef) => {
    if (mediaPending.current.has(node.id)) return;
    mediaPending.current.add(node.id);
    const patch = (values: Record<string, unknown>) => {
      if (isActive()) setNodes(list => list.map(item => item.id === node.id ? { ...item, data: { ...item.data, ...values } } : item));
    };
    patch({ startedAt: new Date().toISOString(), note: null });
    try {
      const kind = node.data.source === 'mesh' ? 'mesh' : 'depth';
      const problem = localMediaProblem(await api.health(), kind);
      if (problem) throw Error(problem);
      if (!isActive()) return;
      const request = { canvasId, cardId: node.id, source: { type: source.type, id: source.id } };
      const job = kind === 'mesh' ? await api.submitMeshJob(request) : await api.submitDepthJob({ ...request, resolution: '480p' });
      patch({ depthJobId: job.id });
    } catch (error) { patch({ note: (error as Error).message, startedAt: undefined }); }
    finally { mediaPending.current.delete(node.id); }
  };
  /** 第 2 列按「深度 → 第一帧」一起排；分两处排会互相避让、次序不定。 */
  const trackMedia = (batchId: string, origin: { x: number; y: number }, ids: Array<string | undefined>, movableIds: string[]) =>
    layout?.(batchId, { ids: ids.filter((value): value is string => Boolean(value)), movableIds, origin });
  /** 新建或要重试的深度卡放进第 2 列并开始本机处理；返回这次新建的卡。 */
  const addMedia = (graph: MediaGraph, batchId: string, origin: { x: number; y: number }, source: AssetRef) => {
    const currentNodes = flow.getNodes(), currentEdges = flow.getEdges();
    const added = graph.nodes.filter(node => !currentNodes.some(item => item.id === node.id));
    const links = graph.edges.filter(edge => !currentEdges.some(item => item.id === edge.id));
    if (added.length) setNodes(current => [...current, ...added.map(node => ({ ...node, selected: false }))]);
    if (links.length) setEdges(current => [...current, ...links]);
    const addedMedia = added.filter(node => node.id === graph.depthId);
    trackMedia(batchId, origin, [graph.depthId], addedMedia.map(node => node.id));
    for (const node of graph.nodes.filter(node => node.id === graph.depthId &&
      (added.some(item => item.id === node.id) || retryRewriteMedia(node.data)))) void dispatchMedia(node, source);
    return addedMedia.map(node => node.id);
  };
  /** 背景卡和其它卡一起铺好后自动点一次发送；卡和截帧连线进画布要等一轮渲染。失败原话写在背景卡上。 */
  const generateBackground = async (id: string) => {
    try {
      for (let wait = 0; wait < 60 && !(flow.getNode(id) && flow.getEdges().some(edge => edge.target === id)); wait++) await new Promise(done => setTimeout(done, 50));
      await send?.(id);
    } catch (error) {
      if (isActive()) setNodes(list => list.map(node => node.id === id ? { ...node, data: { ...node.data, note: (error as Error).message } } : node));
    }
  };
  const run = async (sourceId: string, userText: string, keepBackground = true, motionReference: MotionReference = 'depth') => {
    const key = sourceKey(sourceId);
    if (pending.has(key) || !userText.trim()) return;
    const source = flow.getNode(sourceId);
    if (!source) return;
    pending.add(key); refreshPending();
    let graph: ReturnType<typeof startVideoRewrite>;
    try {
      const problem = rewriteStartProblem(await api.health(), motionReference);
      if (!isActive() || sourceKey(sourceId) !== key) { pending.delete(key); refreshPending(); return; }
      if (problem) { pending.delete(key); refreshPending(); return problem; }
      graph = startVideoRewrite({ source, nodes: flow.getNodes(), edges: flow.getEdges(), takeNumber, makeId, userText, motionReference });
    } catch (error) { pending.delete(key); refreshPending(); return (error as Error).message; }
    drafts.set(draftKey(sourceId), userText); setInputId(null);
    const batchId = graph.batchId, origin = rightOf(source.position);
    activeSources.add(sourceId);
    const videoId = graph.state.videoId!;
    activeSources.add(videoId);
    const mediaAdded = addMedia(graph, batchId, origin, graph.state.source);
    const output = graph.nodes.find(node => node.id === videoId)!;
    updateSource(videoId, () => output.data as VideoCardData);
    updateSource(sourceId, data => ({ ...data, rewriteBusy: 'analyzing', rewriteStatus: { status: 'pending' } }), videoId);
    let charge = { yuan: 0, costUnknown: false }, awaitingCharge = false;
    let state: VideoRewriteState = graph.state;
    try {
      // 背景默认用原视频第一帧：先截（本机、不花钱），第一帧卡和背景卡跟深度一起出现，背景马上开始去人出图。
      // 没勾「背景和原片保持一致」：第一帧照截、连着当机位参考，背景卡留空等用户上传或生成（10-30 用户定）。
      const frame = await api.extractFrame({ source: { type: state.source.type, id: state.source.id }, second: 0 });
      if (!isActive()) return;
      const backdrop = addRewriteBackground({ state, frame: { type: 'upload', id: frame.id }, nodes: flow.getNodes(), edges: flow.getEdges(), takeNumber, makeId, newScene: !keepBackground });
      state = backdrop.state;
      setNodes(current => [...current, ...backdrop.nodes.filter(node => node.id === backdrop.frameId || node.id === backdrop.backgroundId)]);
      setEdges(current => [...current, ...backdrop.edges.filter(edge => edge.target === backdrop.backgroundId)]);
      trackMedia(batchId, origin, [state.depthId, backdrop.frameId], [...mediaAdded, backdrop.frameId]);
      if (keepBackground) void generateBackground(backdrop.backgroundId);
      awaitingCharge = true;
      const analyzed = await api.analyzeVideo({ cardId: batchId, source: state.source, userText });
      awaitingCharge = false; charge = rewriteCharge(charge, analyzed);
      if (!isActive()) return;
      state = { ...state, plan: analyzed.plan, duration: analyzed.duration, targetDuration: analyzed.targetDuration, ratio: analyzed.ratio,
        hasAudio: analyzed.hasAudio, source: { ...state.source, hasAudio: analyzed.hasAudio } };
      if (state.backgroundId && !flow.getNode(state.backgroundId)) state = { ...state, backgroundId: undefined };
      const currentNodes = flow.getNodes(), currentEdges = flow.getEdges();
      const prepared = prepareRewriteCards({ state, nodes: currentNodes, edges: currentEdges, takeNumber, makeId });
      const outputs = prepared.nodes.filter(node => !currentNodes.some(item => item.id === node.id));
      const video = prepared.nodes.find(node => node.id === prepared.videoId)!;
      const references = prepared.edges.filter(edge => !currentEdges.some(item => item.id === edge.id));
      setNodes(current => [...current.map(node => node.id === prepared.videoId ? { ...node, data: video.data, selected: true }
        : node.selected ? { ...node, selected: false } : node), ...outputs.map(node => ({ ...node, selected: node.id === prepared.videoId }))]);
      setEdges(current => [...current, ...references]);
      if (prepared.imageColumn.movableIds.length) layout?.(`${batchId}:images`, prepared.imageColumn);
      updateSource(sourceId, clearStatus);
      focus?.(prepared.videoId);
      const backgroundNote = !state.backgroundId ? '' : state.newScene ? '；背景卡等你上传或生成' : `；背景图另算${formatYuan(estimateYuan(DEFAULT_GEN.model, 1))}`;
      const missingImages = prepared.edges.filter(edge => edge.target === prepared.videoId).filter(edge => {
        const node = prepared.nodes.find(item => item.id === edge.source);
        return node?.data.kind === 'image' && !currentResult(node.data);
      }).length;
      notify(`图片卡已铺好：补完 ${missingImages} 张图后，在视频卡点「生成提示词」；已花 ${formatSpent(charge.yuan)}${charge.costUnknown ? '；另有费用待确认' : ''}${backgroundNote}`);
    } catch (error) {
      if (awaitingCharge) charge = rewriteCharge(charge, error);
      const message = (error as Error).message;
      updateSource(sourceId, data => ({ ...data, rewriteStatus: { status: 'failed', error: message, ...charge } }), videoId);
      notify(`视频改写没成功：${message}（已花 ${formatSpent(charge.yuan)}${charge.costUnknown ? '，另有费用待确认' : ''}）`);
    } finally {
      updateSource(sourceId, clearBusy, videoId);
      activeSources.delete(sourceId); activeSources.delete(videoId); pending.delete(key); refreshPending();
    }
  };
  return { inputId, start, close: () => setInputId(null), run, restore: (list: CardNode[]) => restoreRewriteProgress(list, activeSources),
    textFor: (id: string) => drafts.get(draftKey(id)) ?? '', remember: (id: string, text: string) => drafts.set(draftKey(id), text),
    isPending: (id: string) => pending.has(sourceKey(id)) };
}
