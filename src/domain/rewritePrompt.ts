import type { Edge } from '@xyflow/react';
import type { CardNode, CardPatch, VideoCardData } from '@/types';
import type { FinalSettings, WriteVideoRequest, WriteVideoResult } from '@/videoRewriteApiTypes';
import type { Notify } from '@/common/Toast';
import { cardTitle, currentResult } from './cards';
import { videoRewriteMaterials } from './videoRewrite';
import { rewriteOutputProblem } from './rewriteProgress';
import { talkingLinesProblem } from './rewriteLines';
import { attachReadCards, canUseText, cardTextsOf, itemTextsOf, SCENE_TEXT_HINT, sceneTextProblem, sceneTextsOf } from './rewriteTextScene';

export type LookPromptState = { id: string; data: VideoCardData; nodes: readonly CardNode[]; edges: readonly Pick<Edge, 'source' | 'target'>[] };
const pending = new Map<string, number>(), listeners = new Set<() => void>();
let version = 0;
const changed = () => { version++; for (const listener of listeners) listener(); };
export const subscribeLookPrompt = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const lookPromptVersion = () => version;
export const lookPromptStartedAt = (id: string) => pending.get(id);

function inputs(state: LookPromptState) {
  return state.edges.filter(edge => edge.target === state.id).flatMap(edge => {
    const node = state.nodes.find(candidate => candidate.id === edge.source);
    return node ? [node] : [];
  });
}
export function lookPromptProblem(state: LookPromptState, loading = pending.has(state.id)): string | null {
  if (loading) return '正在生成提示词，请稍等。';
  const problem = rewriteOutputProblem(state.data);
  if (problem) return problem;
  if (!state.data.rewritePlan || !state.data.rewriteUserText?.trim()) return '这张卡是旧版做的，没存拆解结果，请重新做一次视频改写';
  const images = inputs(state).filter(node => node.data.kind === 'image');
  // 至少要一张图（小服务也这么拦）：背景全改成用文字、别的图又没连时，说清怎么救回来。
  if (!images.length) return itemTextsOf(state.nodes, state.data, state.edges).length
    ? '卡都改成用文字了，一张图也没连。生成提示词至少要一张图：连一张人物图，或者选一张卡点「改回用图」。'
    : sceneTextsOf(state.nodes, state.data).length
      ? '背景都改成用文字了，一张图也没连。生成提示词至少要一张图：连一张人物或衣服图，或者选一张背景卡点「改回用图」。'
      : '请先连入背景、人物或衣服图片，再生成提示词。';
  const missing = images.filter(node => !currentResult(node.data));
  // 11-13：缺的是背景卡（11-16 起衣服卡、东西卡也算）就顺带说一句可以不出图、改用文字；只连着这一张图时不说（改了就一张图都没有了）。
  if (missing.length) return `还差 ${missing.length} 张图：${missing.map(node => cardTitle(node.data)).join('、')}`
    + (images.length > 1 && missing.some(node => canUseText(node.data)) ? `；${SCENE_TEXT_HINT}` : '');
  return talkingLinesProblem(state.data) ?? sceneTextProblem(cardTextsOf(state.nodes, state.data, state.edges));
}
export function lookPromptRequest(state: LookPromptState): WriteVideoRequest {
  if (!state.data.rewritePlan) throw Error('这张卡没存拆解结果，请重新做一次视频改写');
  const nodes = inputs(state);
  // 11-08：动作参考视频也带引用，看图定稿要抽它的帧和原片对照（真页面漏了，Claude 说结尾核实不了）。
  const materials = videoRewriteMaterials(state.nodes, state.edges, state.id).map((material, index) => {
    const kind = nodes[index].data.kind, ref = kind === 'image' || kind === 'video' ? currentResult(nodes[index].data) : null;
    const asset = ref && kind === 'video' ? { type: ref.type, id: ref.id } : ref;
    return asset ? { ...material, asset: { ...asset } } : material;
  });
  const sceneTexts = sceneTextsOf(state.nodes, state.data), itemTexts = itemTextsOf(state.nodes, state.data, state.edges);
  return { cardId: state.id, plan: structuredClone(state.data.rewritePlan), userText: state.data.rewriteUserText ?? '',
    duration: state.data.video.duration, sourceDuration: state.data.rewriteSource?.seconds ?? state.data.video.duration,
    ratio: state.data.video.ratio, materials, ...(state.data.rewriteKeepClothes ? { keepClothes: true } : {}),
    ...(state.data.rewriteSource ? { source: { ...state.data.rewriteSource } } : {}), settings: finalSettings(state.data),
    ...(sceneTexts.length ? { sceneTexts } : {}), ...(itemTexts.length ? { itemTexts } : {}),
    ...(state.data.rewriteTalking ? { talking: true, ...(state.data.rewriteVoice?.trim() ? { voice: state.data.rewriteVoice.trim() } : {}) } : {}) };
}
/** 11-08 看图定稿要的视频设置（写进提问，不进存档）。 */
export function finalSettings(data: VideoCardData): FinalSettings {
  const { model, ratio, resolution, duration, audio } = data.video;
  return { model, ratio, resolution, duration, audio };
}
/** 连了要换的人物图：小服务要先看一次图（花钱），和 server/videoRewrite/lookPeople.mjs 的 personMaterials 同一个判断。 */
export function lookPromptPaid(state: LookPromptState): boolean {
  const plan = state.data.rewritePlan;
  if (!plan) return false;
  return videoRewriteMaterials(state.nodes, state.edges, state.id).some(material => material.tag.startsWith('@图片') && material.itemId
    && plan.replace.includes(material.itemId) && plan.items.find(item => item.id === material.itemId)?.kind === '人物');
}
type Options<Request> = { getState: () => LookPromptState | null; apply: (patch: CardPatch) => void;
  request: (input: Request) => Promise<WriteVideoResult>; notify: Notify;
  onError: (message: string | null) => void; onLoading?: (value: boolean) => void; now?: () => number };

/** 仅显式点击才请求；跨面板重建防连点。响应与撤销都保护后来编辑的内容。连了人物图要先看图。 */
export function createLookPromptAction(options: Options<WriteVideoRequest>) {
  // 11-13：背景卡的字怎么理解的回显按卡名对回卡的编号，之后改了哪张卡的字才认得出。
  const request = async (input: WriteVideoRequest) => {
    const result = await options.request(input);
    return { ...result, sceneReads: attachReadCards(result.sceneReads, [...input.sceneTexts ?? [], ...input.itemTexts ?? []]) };
  };
  return createPromptAction({ ...options, request, problem: lookPromptProblem, input: lookPromptRequest, paid: lookPromptPaid });
}
/** 两种卡共用响应保护、点击锁和十秒撤销。 */
export function createPromptAction<Request>(options: Options<Request> & {
  problem: (state: LookPromptState, loading?: boolean) => string | null;
  input: (state: LookPromptState) => Request; paid: (state: LookPromptState) => boolean;
}) {
  const now = options.now ?? Date.now;
  // 11-08：看图定稿要一两分钟，等的时候改分辨率、声音这些设置不算素材变动，不丢结果。
  const fingerprint = (state: LookPromptState) => {
    const { settings: _settings, ...input } = options.input(state) as Request & { settings?: unknown };
    return JSON.stringify([state.data.prompt, input]);
  };
  return async () => {
    const state = options.getState();
    if (!state || pending.has(state.id) || options.problem(state)) return;
    const before = fingerprint(state), prompt = state.data.prompt, warnings = [...state.data.rewriteWarnings ?? []], reads = state.data.rewriteSceneReads;
    const paid = options.paid(state);
    pending.set(state.id, now()); changed(); options.onLoading?.(true); options.onError(null);
    try {
      const result = await options.request(options.input(state));
      const current = options.getState();
      if (!current || fingerprint(current) !== before) {
        options.notify(`生成期间素材或提示词已变动，已保留当前内容。`);
        return;
      }
      options.apply({ prompt: result.videoPrompt, rewriteWarnings: [...result.warnings], rewriteSceneReads: result.sceneReads?.length ? result.sceneReads : undefined });
      const deadline = now() + 10000;
      const changed = result.changes?.length ?? 0;
      const done = result.finalized ? `提示词已生成：看图核对过，${changed ? `改了 ${changed} 处` : '没改'}` : paid ? '提示词已生成' : '提示词已生成（免费）';
      options.notify(done, { label: '撤销', run: () => {
        const latest = options.getState();
        if (now() < deadline && latest?.data.prompt === result.videoPrompt) options.apply({ prompt, rewriteWarnings: warnings, rewriteSceneReads: reads });
      } }, 10000);
    } catch (error) {
      const message = `生成提示词没成功：${(error as Error).message}`;
      options.onError(message); options.notify(message);
    } finally {
      pending.delete(state.id); changed(); options.onLoading?.(false);
    }
  };
}
