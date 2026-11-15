import type { CardNode, VideoCardData } from '@/types';
/** 两种拆解共用：历史恢复不能把另一种仍在跑的单标成中断。 */
export const activeRewriteSources = new Set<string>();

/** 新输出卡还在等拆解：只是在等、不算出错，面板用灰字（11-04）。 */
export function rewriteWaiting(data: VideoCardData): boolean {
  return Boolean(data.rewriteId && !data.rewritePlan && !data.productPlan && (data.rewriteBusy || data.rewriteStatus?.status === 'pending'));
}

/** 新输出卡拆解结束前，写词和发送共用同一个拦截原因。 */
export function rewriteOutputProblem(data: VideoCardData): string | null {
  if (!data.rewriteId || data.rewritePlan || data.productPlan) return null;
  if (rewriteWaiting(data)) return '正在拆解视频，图片卡铺好后再补图';
  if (data.rewriteStatus?.status === 'failed') return `拆解失败：${data.rewriteStatus.error}。请在原视频卡重新开始。`;
  if (data.rewriteStatus?.status === 'interrupted') return '上次没做完，请在原视频卡重新开始视频改写。';
  return null;
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
