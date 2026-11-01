import type { CardData } from "@/types";

/** 原视频和改写视频卡一起复制时，副本的来源指向原视频的副本；单独复制保留来源快照。 */
export function copyRewriteData(data: CardData, ids: ReadonlyMap<string, string>, original: CardData = data): CardData {
  return data.kind === "video" && data.rewriteSourceId ? { ...data, rewriteSourceId: ids.get(data.rewriteSourceId) ?? data.rewriteSourceId,
    ...(!data.rewritePlan && original.rewriteStatus ? { rewriteStatus: { status: 'interrupted' as const } } : {}) } : data;
}
