import type { CardData } from "@/types";
import { currentResult } from "./cards";

/** 用户再次点拆解/重写时才允许重新提交已经明确失败的动作参考卡；运行中的不重发。 */
export function retryRewriteMedia(data: CardData): boolean {
  return (data.source === "depth" || data.source === "mesh") && !currentResult(data) && !data.depthJobId &&
    !data.startedAt && Boolean(data.note);
}
