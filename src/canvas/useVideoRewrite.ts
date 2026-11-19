import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useReactFlow, type Edge } from '@xyflow/react';
import { api } from '@/api';
import { askIfAgentMissing } from '@/common/agentNeeded';
import { startVideoRewrite, prepareRewriteCards, addRewriteBackground, replacementItems, rewriteSourceProblem, rewriteStartProblem, sceneItems } from '@/domain/videoRewrite';
import { compareSecond, type RewriteRow } from '@/domain/rewriteRows';
import { activeRewriteSources, restoreRewriteProgress } from '@/domain/rewriteProgress';
import { currentResult } from '@/domain/cards';
import { localMediaProblem } from '@/domain/localMedia';
import { retryRewriteMedia } from '@/domain/rewriteMedia';
import { clothesFrameRegion, keptClothes } from '@/domain/videoRewriteClothes';
import { rightOf } from '@/domain/placement';
import type { RewriteColumn } from '@/domain/videoRewriteLayout';
import type { AssetRef, CardNode, VideoCardData } from '@/types';
import type { Notify } from '@/common/Toast';
import type { RewriteItem, VideoRewriteState } from '@/videoRewriteTypes';
import type { MotionReference } from '@/domain/motionReference';
import type { RewriteMode } from '@/domain/rewriteMode';

type Deps = { canvasId: string; nodes?: CardNode[]; setNodes: (update: (nodes: CardNode[]) => CardNode[]) => void;
  setEdges: (update: (edges: Edge[]) => Edge[]) => void; takeNumber: () => number; notify: Notify;
  layout?: (id: string, column: RewriteColumn) => void; focus?: (id: string) => void;
  /** 输入面板掉出屏幕时把画布挪一下（`usePanelReveal`）。 */
  reveal?: (id: string) => void };
type MediaGraph = { nodes: CardNode[]; edges: Edge[]; depthId?: string };
const makeId = () => `card-${crypto.randomUUID().slice(0, 8)}`;
// 页面存活期间保留；切换画布重建组件也能取回，刷新页面自然清空。
const drafts = new Map<string, string>();
const pending = new Set<string>(), pendingListeners = new Set<() => void>();
const activeSources = activeRewriteSources;
let pendingVersion = 0;
const subscribePending = (listener: () => void) => { pendingListeners.add(listener); return () => { pendingListeners.delete(listener); }; };
const pendingSnapshot = () => pendingVersion;
const refreshPending = () => { pendingVersion++; for (const listener of pendingListeners) listener(); };
const clearStatus = ({ rewriteStatus: _status, rewriteBusy: _busy, rewriteTask: _task, ...data }: VideoCardData): VideoCardData => data;
const clearBusy = ({ rewriteBusy: _busy, ...data }: VideoCardData): VideoCardData => data;

export function useVideoRewrite({ canvasId, nodes, setNodes, setEdges, takeNumber, notify, layout, focus, reveal }: Deps) {
  const flow = useReactFlow<CardNode, Edge>();
  const mediaPending = useRef(new Set<string>());
  const openedSource = useRef<string | null>(null), openedMode = useRef<Exclude<RewriteMode, 'faceless'>>('face');
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
  /** mode：11-19 三选一里从「不露脸」切回露脸那两种时带上；工具条点「视频改写」一律从默认开始。 */
  const start = (sourceId: string, mode: Exclude<RewriteMode, 'faceless'> = 'face') => {
    const source = flow.getNode(sourceId);
    const problem = source?.data.kind === 'video' ? rewriteSourceProblem(currentResult(source.data)) : '先选一张有结果的视频卡。';
    if (problem) { notify(problem); return; }
    if (activeSources.has(sourceId)) { notify('这条视频正在拆解，做完再来。'); return; }
    if (!pending.has(sourceKey(sourceId))) updateSource(sourceId, data => data.rewriteStatus ? clearStatus(data) : data);
    openedMode.current = mode;
    openedSource.current = sourceKey(sourceId); setInputId(sourceId); reveal?.(sourceId);
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
  /** 第 2 列只放深度卡（11-11 起截图另占一列，和要补的卡一行一对）。 */
  const trackMedia = (batchId: string, origin: { x: number; y: number }, ids: Array<string | undefined>, movableIds: string[]) =>
    layout?.(batchId, { ids: ids.filter((value): value is string => Boolean(value)), movableIds, origin });
  /** 新建或要重试的深度卡放进第 2 列并开始本机处理。 */
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
  };
  /** talking：11-19「露脸 · AI 自己配音」——拆解多读台词，新视频卡开生成音频、不配回原声。 */
  const run = async (sourceId: string, userText: string, keepBackground = true, motionReference: MotionReference = 'depth', keepClothes = true, talking = false) => {
    const key = sourceKey(sourceId);
    if (pending.has(key) || activeSources.has(sourceId) || !userText.trim()) return;
    const source = flow.getNode(sourceId);
    if (!source) return;
    pending.add(key); activeSources.add(sourceId); refreshPending();
    let graph: ReturnType<typeof startVideoRewrite>;
    try {
      const health = await api.health();
      if (!isActive() || sourceKey(sourceId) !== key) { pending.delete(key); activeSources.delete(sourceId); refreshPending(); return; }
      if (askIfAgentMissing(health)) { pending.delete(key); activeSources.delete(sourceId); refreshPending(); return; }
      const problem = rewriteStartProblem(health, motionReference);
      if (problem) { pending.delete(key); activeSources.delete(sourceId); refreshPending(); return problem; }
      graph = startVideoRewrite({ source, nodes: flow.getNodes(), edges: flow.getEdges(), takeNumber, makeId, userText, motionReference, talking });
    } catch (error) { pending.delete(key); activeSources.delete(sourceId); refreshPending(); return (error as Error).message; }
    drafts.set(draftKey(sourceId), userText); setInputId(null);
    const batchId = graph.batchId, origin = rightOf(source.position);
    activeSources.add(sourceId);
    const videoId = graph.state.videoId!;
    activeSources.add(videoId);
    addMedia(graph, batchId, origin, graph.state.source);
    const output = graph.nodes.find(node => node.id === videoId)!;
    updateSource(videoId, () => output.data as VideoCardData);
    updateSource(sourceId, data => ({ ...data, rewriteBusy: 'analyzing', rewriteStatus: { status: 'pending' } }), videoId);
    let state: VideoRewriteState = graph.state;
    try {
      // 11-09 用户定：拆解给每个场景挑一帧当背景（人最少、没被挡、不黑；小服务兜底），拿到才截图（本机、不花钱）；拆解失败就不截图、不铺卡。
      // 勾「背景和原片保持一致」：那一帧没人直接当背景，有人才铺去人的卡。没勾：背景卡留空等用户上传或生成，左边放这一帧给人对照（11-11 用户定）。
      const analyzed = await api.analyzeVideo({ cardId: batchId, source: state.source, userText, ...(talking ? { talking: true } : {}) });
      if (!isActive()) return;
      const plan = analyzed.plan;
      state = { ...state, keepClothes, plan, duration: analyzed.duration, targetDuration: analyzed.targetDuration, ratio: analyzed.ratio,
        hasAudio: analyzed.hasAudio, source: { ...state.source, hasAudio: analyzed.hasAudio } };
      // 11-06 用户定：原片换了地方时每个场景一张背景卡（11-11 起背景换不换都这样）。只有一个场景时 sceneItems 是空的，背景帧取第一项；小服务没回就退回场景截图时刻（单场景第 0 秒）、按有人算。
      const clip = { type: state.source.type, id: state.source.id };
      const scenes = sceneItems(plan), places = scenes.length ? scenes : [undefined];
      const picks = places.map((scene, index) => analyzed.backgroundFrames?.[index] ?? { second: scene?.frame ?? 0, empty: false });
      // 11-06 用户：只写换人时衣服跟原片，截图拿去抽衣服；11-11 用户定：要换的人和衣服也截原片同一刻给人对照（东西没时段不截）。
      // 全在建卡之前截好，有一张失败整次报错，不留半截、不花出图钱。
      const kept = keepClothes ? keptClothes(plan) : [];
      const compared = replacementItems(plan).filter(item => compareSecond(item, plan) !== undefined);
      const snap = (item: RewriteItem, second: number) => {
        const region = clothesFrameRegion(item, plan);
        return api.extractFrame({ source: clip, second, ...(region ? { region } : {}) });
      };
      const [shots, clothesFrames, compareShots] = await Promise.all([Promise.all(picks.map(pick => api.extractFrame({ source: clip, second: pick.second }))),
        Promise.all(kept.map(item => snap(item, item.frame))), Promise.all(compared.map(item => snap(item, compareSecond(item, plan)!)))]);
      if (!isActive()) return;
      const asRef = (shot: { id: string }): AssetRef => ({ type: 'upload', id: shot.id });
      const keptFrames = Object.fromEntries(kept.map((item, index) => [item.id, asRef(clothesFrames[index])]));
      const compareFrames = Object.fromEntries(compared.map((item, index) => [item.id, asRef(compareShots[index])]));
      const currentNodes = flow.getNodes(), currentEdges = flow.getEdges();
      const erasingIds: string[] = [], backgroundRows: RewriteRow[] = [];
      let backdrop: { nodes: CardNode[]; edges: Edge[] } = { nodes: currentNodes, edges: currentEdges };
      places.forEach((scene, index) => {
        const shot = asRef(shots[index]);
        const added = addRewriteBackground({ state, ...(keepBackground ? { frame: shot } : { frame: null, compare: shot }), ...picks[index], scene,
          nodes: backdrop.nodes, edges: backdrop.edges, takeNumber, makeId });
        state = added.state; backdrop = added; backgroundRows.push(added.row);
        if (added.frameId) erasingIds.push(added.backgroundId);
      });
      const prepared = prepareRewriteCards({ state, nodes: backdrop.nodes, edges: backdrop.edges, takeNumber, makeId, keptFrames, compareFrames, backgroundRows });
      const outputs = prepared.nodes.filter(node => !currentNodes.some(item => item.id === node.id));
      const video = prepared.nodes.find(node => node.id === prepared.videoId)!;
      const references = prepared.edges.filter(edge => !currentEdges.some(item => item.id === edge.id));
      setNodes(current => [...current.map(node => node.id === prepared.videoId ? { ...node, data: video.data, selected: true }
        : node.selected ? { ...node, selected: false } : node), ...outputs.map(node => ({ ...node, selected: node.id === prepared.videoId }))]);
      setEdges(current => [...current, ...references]);
      if (prepared.imageColumn.movableIds.length) layout?.(`${batchId}:images`, prepared.imageColumn);
      updateSource(sourceId, clearStatus);
      focus?.(prepared.videoId);
      // 11-09 用户定：去人背景、原片衣服只连好截图、写好词，不自动出图；手里已有素材或想用自己的图时不白花钱，要出就在卡上点生成。
      const ready = [...erasingIds, ...prepared.clothesIds];
      const readyNote = ready.length ? `；其中 ${ready.length} 张已连好截图、写好词，点生成就行` : '';
      const compareNote = compared.length || !keepBackground ? '；左边没连线的截图只给你对照' : '';
      const backgroundNote = (state.backgroundId && state.newScene ? '；背景卡等你上传或生成' : '') + compareNote;
      const missingImages = prepared.edges.filter(edge => edge.target === prepared.videoId).filter(edge => {
        const node = prepared.nodes.find(item => item.id === edge.source);
        return node?.data.kind === 'image' && !currentResult(node.data);
      }).length;
      notify(`图片卡已铺好：补完 ${missingImages} 张图后，在视频卡点「生成提示词」${readyNote}${backgroundNote}`);
    } catch (error) {
      const message = (error as Error).message;
      updateSource(sourceId, data => ({ ...data, rewriteStatus: { status: 'failed', error: message } }), videoId);
      notify(`视频改写没成功：${message}`);
    } finally {
      updateSource(sourceId, clearBusy, videoId);
      activeSources.delete(sourceId); activeSources.delete(videoId); pending.delete(key); refreshPending();
    }
  };
  return { inputId, start, close: () => setInputId(null), run, restore: (list: CardNode[]) => restoreRewriteProgress(list, activeSources), openedMode: () => openedMode.current,
    textFor: (id: string) => drafts.get(draftKey(id)) ?? '', remember: (id: string, text: string) => drafts.set(draftKey(id), text),
    isPending: (id: string) => pending.has(sourceKey(id)) };
}
