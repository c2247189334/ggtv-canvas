import type { MediaWorkView } from "@/types";

/** 作品库顶上的筛选。 */
export type WorkKindFilter = "all" | "image" | "video" | "audio";

export function filterWorks(works: readonly MediaWorkView[], kind: WorkKindFilter, onlyCanvasId: string | null): MediaWorkView[] {
  return works.filter((w) => (kind === "all" || w.kind === kind) && (!onlyCanvasId || w.canvasId === onlyCanvasId));
}

/**
 * 作品的标题：发出去的提示词去掉开头那行编号说明（见 prompt.ts），
 * 视频的 @图像N 换回面板里的 @图片N（见 videoPrompt.ts），截 60 字；空的叫「作品」。
 */
export function workTitle(work: Pick<MediaWorkView, "prompt"> & { kind?: MediaWorkView["kind"] }): string {
  let text = work.prompt.replace(/^(只有 1 张图，就是图1。|一共 \d+ 张图，按顺序是[^。]*。)\s*/, "").trim();
  if (work.kind === "video") text = text.replace(/@图像(\d+)/g, "@图片$1");
  return text.slice(0, 60) || "作品";
}
