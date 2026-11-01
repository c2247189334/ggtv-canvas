import type { AssetRef } from "./types";
import type { RewritePlan, RewriteMaterial } from "./videoRewriteTypes";
import type { VideoRatio } from "./domain/videoModels";

export type RewriteCharge = { yuan: number; costUnknown: boolean };
export type AnalyzeVideoRequest = { cardId: string; source: AssetRef; userText: string };
export type RewriteVideoMeta = {
  duration: number; targetDuration: number; ratio: VideoRatio; hasAudio: boolean;
};
export type AnalyzeVideoResult = RewriteCharge & RewriteVideoMeta & { plan: RewritePlan };
export type WriteVideoRequest = { cardId: string; plan: RewritePlan; userText: string;
  duration: number; sourceDuration?: number; ratio: string; materials: RewriteMaterial[] };
/** 小服务按模板拼；连了要换的人物图会先看一次图，yuan 是那次看图的花费（没有就是 0）；warnings 是拆解没把握的地方和画面里其他东西的名字。 */
export type WriteVideoResult = RewriteCharge & { videoPrompt: string; issues: string[]; warnings: string[] };
export type CheckVideoRequest = { cardId: string; videoPrompt: string; materials: RewriteMaterial[]; duration: number; changeSeconds: number[] };
