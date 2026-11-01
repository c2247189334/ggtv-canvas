import type { CardNode, VideoCardData } from '@/types';

/** 新输出卡拆解结束前，写词和发送共用同一个拦截原因。 */
export function rewriteOutputProblem(data: VideoCardData): string | null {
  if (!data.rewriteId || data.rewritePlan) return null;
  if (data.rewriteBusy || data.rewriteStatus?.status === 'pending') return '正在拆解视频，图片卡铺好后再补图';
  if (data.rewriteStatus?.status === 'failed') return `拆解失败：${data.rewriteStatus.error}。请在原视频卡重新开始。`;
  if (data.rewriteStatus?.status === 'interrupted') return '上次没做完，请在原视频卡重新开始视频改写。';
  return null;
}

/** 没拿到服务端的费用回执，不能把失败显示成零花费。 */
export function rewriteCharge(previous: { yuan: number; costUnknown: boolean }, result: unknown) {
  const value = result as { yuan?: unknown; costUnknown?: unknown } | null;
  return { yuan: previous.yuan + (typeof value?.yuan === 'number' && Number.isFinite(value.yuan) ? value.yuan : 0),
    costUnknown: previous.costUnknown || (typeof value?.costUnknown === 'boolean' ? value.costUnknown : true) };
}

/** 历史快照里原视频卡的「正在改写」只有当前页面仍在跑这条来源时才有效，否则改成「上次没做完」。 */
export function restoreRewriteProgress(nodes: CardNode[], activeSourceIds: ReadonlySet<string>): CardNode[] {
  let changed = false;
  const restored = nodes.map(node => {
    const current = node.data;
    if (current.kind !== 'video' || current.rewriteStatus?.status !== 'pending' || activeSourceIds.has(node.id)) return node;
    changed = true;
    const { rewriteBusy: _rewriteBusy, ...data } = current;
    return { ...node, data: { ...data, rewriteStatus: { status: 'interrupted' as const } } };
  });
  return changed ? restored : nodes;
}
