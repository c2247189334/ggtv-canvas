import type { Edge } from '@xyflow/react';
import type { CardNode, CardPatch, VideoCardData } from '@/types';
import type { WriteVideoRequest, WriteVideoResult } from '@/videoRewriteApiTypes';
import type { Notify } from '@/common/Toast';
import { cardTitle, currentResult } from './cards';
import { videoRewriteMaterials } from './videoRewrite';
import { rewriteCharge, rewriteOutputProblem } from './rewriteProgress';
import { formatSpent } from './pricing';

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
  if (!images.length) return '请先连入背景、人物或衣服图片，再生成提示词。';
  const missing = images.filter(node => !currentResult(node.data));
  return missing.length ? `还差 ${missing.length} 张图：${missing.map(node => cardTitle(node.data)).join('、')}` : null;
}
export function lookPromptRequest(state: LookPromptState): WriteVideoRequest {
  if (!state.data.rewritePlan) throw Error('这张卡没存拆解结果，请重新做一次视频改写');
  const nodes = inputs(state);
  const materials = videoRewriteMaterials(state.nodes, state.edges, state.id).map((material, index) => {
    const asset = nodes[index].data.kind === 'image' ? currentResult(nodes[index].data) : null;
    return asset ? { ...material, asset: { ...asset } } : material;
  });
  return { cardId: state.id, plan: structuredClone(state.data.rewritePlan), userText: state.data.rewriteUserText ?? '',
    duration: state.data.video.duration, sourceDuration: state.data.rewriteSource?.seconds ?? state.data.video.duration,
    ratio: state.data.video.ratio, materials };
}
/** 连了要换的人物图：小服务要先看一次图（花钱），和 server/videoRewrite/lookPeople.mjs 的 personMaterials 同一个判断。 */
export function lookPromptPaid(state: LookPromptState): boolean {
  const plan = state.data.rewritePlan;
  if (!plan) return false;
  return videoRewriteMaterials(state.nodes, state.edges, state.id).some(material => material.tag.startsWith('@图片') && material.itemId
    && plan.replace.includes(material.itemId) && plan.items.find(item => item.id === material.itemId)?.kind === '人物');
}
const fingerprint = (state: LookPromptState) => JSON.stringify([state.data.prompt, lookPromptRequest(state)]);
const spent = (value: unknown) => {
  const charge = rewriteCharge({ yuan: 0, costUnknown: false }, value);
  return `已花 ${formatSpent(charge.yuan)}${charge.costUnknown ? '；另有费用待确认' : ''}`;
};
type Options = { getState: () => LookPromptState | null; apply: (patch: CardPatch) => void;
  request: (input: WriteVideoRequest) => Promise<WriteVideoResult>; notify: Notify;
  onError: (message: string | null) => void; onLoading?: (value: boolean) => void; now?: () => number };

/** 仅显式点击才请求；跨面板重建防连点。响应与撤销都保护后来编辑的内容。连了人物图要先看图（花钱），提示里写已花多少。 */
export function createLookPromptAction(options: Options) {
  const now = options.now ?? Date.now;
  return async () => {
    const state = options.getState();
    if (!state || lookPromptProblem(state)) return;
    const before = fingerprint(state), prompt = state.data.prompt, warnings = [...state.data.rewriteWarnings ?? []];
    const paid = lookPromptPaid(state);
    pending.set(state.id, now()); changed(); options.onLoading?.(true); options.onError(null);
    try {
      const result = await options.request(lookPromptRequest(state));
      const current = options.getState();
      if (!current || fingerprint(current) !== before) {
        options.notify(`生成期间素材或提示词已变动，已保留当前内容。${paid ? spent(result) : ''}`);
        return;
      }
      options.apply({ prompt: result.videoPrompt, rewriteWarnings: [...result.warnings] });
      const deadline = now() + 10000;
      options.notify(paid ? `提示词已生成，${spent(result)}` : '提示词已生成（不花钱）', { label: '撤销', run: () => {
        const latest = options.getState();
        if (now() < deadline && latest?.data.prompt === result.videoPrompt) options.apply({ prompt, rewriteWarnings: warnings });
      } }, 10000);
    } catch (error) {
      const message = `生成提示词没成功：${(error as Error).message}${paid ? `（${spent(error)}）` : ''}`;
      options.onError(message); options.notify(message);
    } finally {
      pending.delete(state.id); changed(); options.onLoading?.(false);
    }
  };
}
