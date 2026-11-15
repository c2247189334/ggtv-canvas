import type { Edge } from '@xyflow/react';
import type { AssetRef, CardNode } from '@/types';
import type { ProductMaterial, ProductPromptRequest, ProductRole } from '@/productRemakeTypes';
import { cardTitle, currentResult } from './cards';
import { createPromptAction, finalSettings, type LookPromptState } from './rewritePrompt';
import { rewriteOutputProblem } from './rewriteProgress';
export function productSourceProblem(state: LookPromptState): string | null {
  const sources = state.edges.filter(e => e.target === state.id).flatMap(e => {
    const node = state.nodes.find(n => n.id === e.source);
    return node?.data.kind === 'video' ? [node] : [];
  });
  const original = sources.find(n => n.id === state.data.rewriteSourceId);
  if (!original || !state.data.rewriteSource) return '请把原视频重新连入这张视频卡，作为 @视频1。';
  return sources[0]?.id === original.id ? null : '原视频必须是 @视频1：请先剪掉其他视频线，再连原视频。';
}

export function productIdentity(node: CardNode, videoId: string): ProductRole | undefined {
  if (node.data.kind !== 'image') return undefined;
  const group = node.data.group;
  if (group?.productId && group.videoId === videoId) return { role: 'product', productId: group.productId, videoId,
    name: group.name.replace(/^商品[A-Z]+(?: · )?/, '').replace(/（[^）]*）$/, '') || '商品' };
  const identity = node.data.productRole;
  return identity?.videoId === videoId && (!group?.videoId || group.videoId === videoId) ? identity : undefined;
}
/** 原视频翻页后仍然取这张输出卡开始时记录的结果。 */
export function productReference(node: CardNode, output: CardNode['data']): AssetRef | null {
  return output.kind === 'video' && output.rewriteKind === 'product' && node.id === output.rewriteSourceId ? output.rewriteSource ?? null : currentResult(node.data);
}
export function productMaterials(nodes: readonly CardNode[], edges: readonly Pick<Edge, 'source' | 'target'>[], videoId: string): ProductMaterial[] {
  const output = nodes.find(n => n.id === videoId)?.data;
  const counts = { image: 0, video: 0, audio: 0 };
  return edges.filter(e => e.target === videoId).flatMap(edge => {
    const node = nodes.find(n => n.id === edge.source);
    if (!node) return [];
    const identity = productIdentity(node, videoId), kind = node.data.kind;
    const tag = `@${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}${++counts[kind]}`;
    const product = output?.kind === 'video' ? output.productPlan?.products.find(p => p.id === identity?.productId) : undefined;
    const asset = output ? productReference(node, output) : currentResult(node.data);
    const purpose = identity?.role === 'background' ? '背景' : identity?.role === 'product' ? `商品${identity.productId}` : kind === 'video' ? '参考视频' : '图片参考';
    return [{ tag, purpose, ...(identity ? { role: identity.role, ...(identity.productId ? { productId: identity.productId } : {}) } : {}),
      ...(product?.look ? { originalDesc: product.look } : {}), ...(asset ? { asset: { ...asset } } : {}) }];
  });
}
export function productPromptProblem(state: LookPromptState, loading = false): string | null {
  if (loading) return '正在生成提示词，请稍等。';
  const problem = rewriteOutputProblem(state.data);
  if (problem) return problem;
  if (!state.data.productPlan) return '这张卡没存拆解结果，请在原视频重新拆解（无人物）';
  const sourceProblem = productSourceProblem(state);
  if (sourceProblem) return sourceProblem;
  const images = state.edges.filter(e => e.target === state.id).flatMap(e => {
    const node = state.nodes.find(n => n.id === e.source);
    return node?.data.kind === 'image' ? [node] : [];
  });
  const missing = images.filter(n => !currentResult(n.data));
  const groups = productGroupsOnCanvas(state.nodes, state.id);
  const sameHint = groups.size > 1 && missing.some(n => productIdentity(n, state.id)?.role === 'product') ? '；和别的组同款同色的，可以点组上的「跟哪组一样」' : '';
  if (missing.length) return `还差 ${missing.length} 张图：${missing.map(n => cardTitle(n.data)).join('、')}${sameHint}`;
  if (!images.some(n => productIdentity(n, state.id)?.role === 'product')) return '请先连入商品组的实物照，再生成提示词。';
  // 11-04 晚：拆解认出的每组都要有图或「跟哪组一样」，否则原片里那组会原样留着。
  const ready = new Set(images.flatMap(n => currentResult(n.data) ? [productIdentity(n, state.id)?.productId] : []));
  const empty = state.data.productPlan.products.filter(p => groups.has(p.id) && !ready.has(p.id) && !(groups.get(p.id) && ready.has(groups.get(p.id)!)));
  return empty.length ? `${empty.map(p => `商品${p.id}${p.where ? `（${p.where}）` : ''}`).join('、')}还没传图：传图，或点组上的「跟哪组一样」` : null;
}
/** 画布上属于这张视频卡的商品组：编号 → 最终照哪组的图（跟的组又在跟别人就顺下去；没设为空串）。 */
function productGroupsOnCanvas(nodes: readonly CardNode[], videoId: string): Map<string, string> {
  const direct = new Map<string, string>();
  for (const node of nodes) {
    const role = productIdentity(node, videoId), sameAs = node.data.kind === 'image' ? node.data.productRole?.sameAs : undefined;
    if (role?.role === 'product' && role.productId) direct.set(role.productId, direct.get(role.productId) || sameAs || '');
  }
  return new Map([...direct].map(([id, first]) => {
    const seen = new Set([id]);
    let target = first;
    while (target && direct.get(target) && !seen.has(target)) { seen.add(target); target = direct.get(target)!; }
    return [id, seen.has(target) ? '' : target];
  }));
}
export function productPromptRequest(state: LookPromptState): ProductPromptRequest {
  if (!state.data.productPlan) throw Error('这张卡没存拆解结果，请重新拆解（无人物）');
  const materials = productMaterials(state.nodes, state.edges, state.id);
  const ids = [...new Set(materials.filter(m => m.role === 'product').map(m => m.productId!))];
  const plan = structuredClone(state.data.productPlan);
  const groups = productGroupsOnCanvas(state.nodes, state.id);
  const same = [...groups].filter(([id, target]) => target && !ids.includes(id) && ids.includes(target)).map(([id]) => id);
  const gone = plan.products.filter(p => !groups.has(p.id));
  plan.unsure.push(...gone.map(p => `商品${p.id}${p.where ? `（${p.where}）` : ''}不在画布上了，原片里那组可能换不掉`));
  const order = (id: string) => { const index = plan.products.findIndex(p => p.id === id); return index < 0 ? Infinity : index; };
  plan.products = [...ids, ...same].sort((a, b) => order(a) - order(b))
    .map(id => ({ ...(plan.products.find(p => p.id === id) ?? { id, name: '商品', look: '', pairs: 0, pieces: 0, layout: '数量和摆位照参考视频' }),
      ...(same.includes(id) ? { sameAs: groups.get(id)! } : {}) }));
  return { cardId: state.id, plan, userText: state.data.rewriteUserText ?? '', duration: state.data.video.duration,
    sourceDuration: state.data.rewriteSource?.seconds ?? state.data.video.duration, ratio: state.data.video.ratio, model: state.data.video.model, materials,
    settings: finalSettings(state.data) };
}
export function createProductPromptAction(options: Omit<Parameters<typeof createPromptAction<ProductPromptRequest>>[0], 'problem' | 'input' | 'paid'>) {
  return createPromptAction({ ...options, problem: productPromptProblem, input: productPromptRequest, paid: () => true });
}
