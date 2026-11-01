/**
 * 卡片之间的连线 = 参考图。连进一张生成卡的线，按连的先后编号：先连的是「图片1」。
 * 线在数组里的先后就是编号；断开一根，后面的自动往前补。纯逻辑，能直接单测。
 */
import type { CardData, CardSource } from "@/types";

export const MAX_REFS = 8;

/** 图和视频共用八个名额；声音数和时长由视频模型的规则检查。 */
export function referenceLimitReached(currentKinds: readonly CardData["kind"][], sourceKind: CardData["kind"] = "image"): boolean {
  return sourceKind !== "audio" && currentKinds.filter(kind => kind !== "audio").length >= MAX_REFS;
}

export type LinkEdge = { id: string; source: string; target: string };

export function linkId(source: string, target: string): string {
  return `link:${source}>${target}`;
}

/** 连进这张卡的上游卡，按编号顺序。 */
export function refSources(edges: readonly Pick<LinkEdge, "source" | "target">[], cardId: string): string[] {
  return edges.filter((e) => e.target === cardId).map((e) => e.source);
}

/** 从 from 顺着线往下游走，能不能走到 to。 */
export function reaches(edges: readonly LinkEdge[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const at = stack.pop() as string;
    if (at === to) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const e of edges) if (e.source === at) stack.push(e.target);
  }
  return false;
}

export type LinkCheck = { ok: true } | { ok: false; reason: string };

/** 用户拉了一根线，能不能连上。连不上给一句人话，界面照着提示。 */
export function checkLink(args: {
  edges: readonly LinkEdge[];
  source: string;
  target: string;
  targetSource: CardSource | undefined;
  sourceKind?: CardData["kind"];
  targetKind?: CardData["kind"];
  referenceKinds?: readonly CardData["kind"][];
}): LinkCheck {
  const { edges, source, target, targetSource } = args;
  if (source === target) return { ok: false, reason: "不能自己连自己。" };
  if (targetSource !== "generate") return { ok: false, reason: "传的图和作品库的图不收参考图，线要连进生成卡。" };
  if (args.targetKind === "audio") return { ok: false, reason: "声音卡不收参考，线要连进生成卡。" };
  if (args.sourceKind === "audio" && args.targetKind !== "video") return { ok: false, reason: "出图不能拿声音当参考" };
  if (args.sourceKind === "video" && args.targetKind !== "video") return { ok: false, reason: "出图不能拿视频当参考，连到视频卡上。" };
  const current = refSources(edges, target);
  if (current.includes(source)) return { ok: false, reason: "这两张卡已经连上了。" };
  if (referenceLimitReached(args.referenceKinds ?? current.map(() => "image"), args.sourceKind))
    return { ok: false, reason: `一张卡最多连 ${MAX_REFS} 张参考图。` };
  if (reaches(edges, target, source)) return { ok: false, reason: "这样连会绕成一个圈。" };
  return { ok: true };
}

/** 没连成时的松手提示：空白处、自己身上都安静地取消。 */
export function dropLinkHint(args: {
  edges: readonly LinkEdge[];
  source: string;
  target: string | null;
  targetSource: CardSource | undefined;
  sourceKind?: CardData["kind"];
  targetKind?: CardData["kind"];
  referenceKinds?: readonly CardData["kind"][];
}): string | null {
  const { target } = args;
  if (target === null || target === args.source) return null;
  const check = checkLink({ ...args, target });
  return check.ok ? null : check.reason;
}
