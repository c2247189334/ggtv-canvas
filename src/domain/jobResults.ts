import { absorbJob, currentResult } from "./cards";
import { refSources, type LinkEdge } from "./refs";
import { blockedReferenceMessage } from "./videoPanel";
import type { CardNode, JobView } from "@/types";

/** 收单时按当前连线顺序对齐视频参考称呼；图片收单保持原样。 */
export function absorbJobViews(nodes: CardNode[], edges: readonly Pick<LinkEdge, "source" | "target">[], views: readonly JobView[]): CardNode[] {
  return nodes.map(node => {
    const types = refSources(edges, node.id).map(source => {
      const upstream = nodes.find(item => item.id === source);
      const media = upstream && currentResult(upstream.data)?.media;
      return upstream?.data.kind === "audio" || media === "audio" ? "audio" as const
        : upstream?.data.kind === "video" || media === "video" ? "video" as const : "image" as const;
    });
    let data = views.reduce((card, view) => absorbJob(card,
      card.kind === "video" && view.error && view.blocked?.length
        ? { ...view, error: blockedReferenceMessage(view.error, view.blocked, types) }
        : view), node.data);
    const warning = views.find(view => data.jobs.includes(view.id) && view.warning)?.warning;
    if (data.kind === 'video' && warning && data.jobWarning !== warning) data = { ...data, jobWarning: warning };
    return data === node.data ? node : { ...node, data };
  });
}
