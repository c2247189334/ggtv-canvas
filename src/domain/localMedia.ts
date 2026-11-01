import type { Edge } from "@xyflow/react";
import { newAudioCard, newVideoCard, isFinished, currentResult } from "./cards";
import { linkId } from "./refs";
import { CARD_WIDTH, rightOf } from "./placement";
import { rewriteNodeHeight, rewriteSpot } from "./videoRewriteLayout";
import { missingDepthConfig, meshConfigProblem } from "./health";
import type { CardData, CardNode, DepthJobView, Health } from "@/types";

export type LocalAction = "depth" | "mesh" | "audio";

/** 确认前拦截本机配置问题；不显示任何路径或配置值。 */
export function localMediaProblem(health: Health, action: LocalAction): string | null {
  if (health.fake) return null;
  if (!health.ffmpegFound) return "没找到 ffmpeg，请先配置 ffmpeg，再重试。";
  if (action === "audio") return null;
  if (action === 'mesh') return meshConfigProblem(health.mesh);
  if (!health.ffprobeFound) return "没找到 ffprobe，请先安装含 ffprobe 的 ffmpeg 并加入 PATH，再重试。";
  const missing = missingDepthConfig(health.depth);
  return missing.length ? `深度动作捕捉缺少或找不到 ${missing.join("、")}，请填在项目根目录的 .env.local。` : null;
}

/** 深度 / 白模卡出片前就按来源比例预留高度，免得出片后卡变高压到下面那张。 */
function plannedHeight(node: CardNode): number {
  const media = node.data.mediaSource;
  const planned = node.data.kind === "video" && media?.width && media.height ? Math.ceil(CARD_WIDTH * media.height / media.width) + 40 : 0;
  return Math.max(rewriteNodeHeight(node), planned);
}

/** 一次创建卡和来源线，交给React同一批更新，历史只记录一步；10-31 用户：连点几次新卡不许叠在一起，右边占了就往下排。 */
export function localChild(source: CardNode, action: LocalAction, number: number, id: string, startedAt: string,
  nodes: readonly CardNode[] = []): { node: CardNode; edge: Edge } {
  const data: CardData = action === "audio" ? newAudioCard("extracted", number) : newVideoCard(action, number);
  const asset = currentResult(source.data);
  if (asset) data.mediaSource = { ...asset };
  data.startedAt = startedAt;
  data.note = action === "audio" ? "提取中…" : null;
  const node: CardNode = { id, type: "card", position: rightOf(source.position), selected: true, data };
  const taken = nodes.map(item => ({ ...item, measured: { ...item.measured, height: plannedHeight(item) } }));
  node.position = rewriteSpot(node.position, taken, plannedHeight(node));
  return { node,
    edge: { id: linkId(source.id, id), source: source.id, target: id } };
}

export function settleDepth(card: CardData, job: DepthJobView): CardData {
  if (card.depthJobId !== job.id || !isFinished(job.status)) return card;
  const { depthJobId: _id, startedAt: _time, ...rest } = card;
  const fresh = job.works.filter(id => !card.results.some(ref => ref.id === id)).map(id => {
    const meta = job.workMeta?.find(item => item.id === id);
    return { type: "work" as const, id, media: "video" as const, ...(job.kind === 'mesh' ? { mesh: true } : { depth: true }),
      ...(meta ? { seconds: meta.duration, width: meta.width, height: meta.height, hasAudio: meta.hasAudio, fps: meta.fps } : {}) };
  });
  return { ...rest, results: [...card.results, ...fresh], page: fresh.length ? card.results.length : card.page, note: job.error };
}

/** 还在生成的深度 / 白模单号（有单号就是交出去还没收尾的）。 */
export function busyLocalJobs(nodes: readonly CardNode[]): string[] {
  return nodes.flatMap(node => node.data.depthJobId ? [node.data.depthJobId] : []);
}

export function stopConfirmText(count: number): string {
  return `${count > 1 ? `有 ${count} 张卡` : "这张卡"}还在生成，删掉会同时停止后台，确定吗？`;
}
