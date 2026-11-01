import { cardTitle, currentResult } from "./cards";
import { refSources, type LinkEdge } from "./refs";
import type { AssetRef, CardData, CardNode, CardPatch } from "@/types";

export type SendRef = AssetRef & { asset?: string };

export function collectSendRefs(nodes: readonly CardNode[], edges: readonly Pick<LinkEdge, "source" | "target">[], cardId: string, kind: "image" | "video", deleted: (id: string) => boolean = () => false): SendRef[] {
  return refSources(edges, cardId).map(sourceId => {
    const upstream = nodes.find(node => node.id === sourceId);
    const name = upstream ? cardTitle(upstream.data) : "有一张参考卡";
    const ref = upstream ? currentResult(upstream.data) : null;
    if (!ref) throw new Error(`${name} ${kind === "image" ? "还没有图" : "还没有结果"}，等它出好或者断开再发。`);
    if (ref.type === "work" && deleted(ref.id)) throw new Error(`${name} 的作品已经删了，断开它再发。`);
    if (kind === "image" && (upstream?.data.kind === "audio" || ref.media === "audio")) throw new Error("出图不能拿声音当参考");
    if (kind === "image" && (upstream?.data.kind === "video" || ref.media === "video")) throw new Error("出图不能拿视频当参考，连到视频卡上。");
    return { ...ref, ...(kind === "video" && upstream?.data.kind === "image" && upstream.data.source !== "generate" && upstream.data.assetId ? { asset: upstream.data.assetId } : {}) };
  });
}

/** 保持判别联合：不能把另一种生成设置混进当前卡片。 */
export function patchCard(card: CardData, patch: CardPatch): CardData {
  const { gen, video, assetId, rewriteItem, ...common } = patch;
  if (card.kind === "audio") return { ...card, ...common };
  if (card.kind === "video") return { ...card, ...common, ...(video ? { video } : {}) };
  return { ...card, ...common, ...(gen ? { gen } : {}),
    ...(rewriteItem ? { rewriteItem } : {}),
    ...(card.source !== "generate" && Object.hasOwn(patch, "assetId") ? { assetId } : {}) };
}
