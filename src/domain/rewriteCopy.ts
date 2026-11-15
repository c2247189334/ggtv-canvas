import type { CardData } from "@/types";

/** 原视频和改写视频卡一起复制时，副本的来源指向原视频的副本；单独复制保留来源快照。 */
export function copyRewriteData(data: CardData, ids: ReadonlyMap<string, string>, original: CardData = data, offset = { x: 0, y: 0 }): CardData {
  const grouped = data.group?.videoId ? { ...data, group: { ...data.group, videoId: ids.get(data.group.videoId) ?? data.group.videoId } } : data;
  if (grouped.kind === 'image' && grouped.productRole) return { ...grouped, productRole: { ...grouped.productRole,
    videoId: ids.get(grouped.productRole.videoId) ?? grouped.productRole.videoId } };
  return grouped.kind === "video" && grouped.rewriteSourceId ? { ...grouped, rewriteSourceId: ids.get(grouped.rewriteSourceId) ?? grouped.rewriteSourceId,
    ...(grouped.productAutoPosition ? { productAutoPosition: { x: grouped.productAutoPosition.x + offset.x, y: grouped.productAutoPosition.y + offset.y } } : {}),
    ...(!grouped.rewritePlan && !grouped.productPlan && original.rewriteStatus ? { rewriteStatus: { status: 'interrupted' as const } } : {}) } : grouped;
}
