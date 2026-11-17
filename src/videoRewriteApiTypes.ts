import type { AssetRef, SceneRead } from "./types";
import type { RewritePlan, RewriteMaterial } from "./videoRewriteTypes";
import type { VideoRatio } from "./domain/videoModels";

export type RewriteCharge = { yuan: number };
export type AnalyzeVideoRequest = { cardId: string; source: AssetRef; userText: string; background?: boolean };
export type RewriteVideoMeta = {
  duration: number; targetDuration: number; ratio: VideoRatio; hasAudio: boolean;
};
/** 背景用原片第几秒；empty 表示这一帧没人，截图直接当背景。 */
export type BackgroundFrame = { second: number; empty: boolean };
/** 11-09：背景跟原片时每个场景一项（顺序同 sceneItems；只有一个场景时就是唯一那张背景）。 */
export type AnalyzeVideoResult = RewriteCharge & RewriteVideoMeta & { plan: RewritePlan; backgroundFrames?: BackgroundFrame[] };
/** 11-08：本机 agent 看图定稿要原片（source）和视频设置（settings）；都只用来核对和写进提问，不进存档。 */
export type FinalSettings = { model: string; ratio: string; resolution: string; duration: number; audio: boolean };
/** 11-13 背景卡「不出图，用文字」：每张开着用文字的卡一条；sceneId 是它管的场景（原片只有一个地方时没有）；cardId 只给页面对回显用。 */
export type SceneText = { title: string; sceneId?: string; text: string; cardId?: string };
/** 11-16 衣服卡 / 东西卡（道具、遮挡物、其他）「不出图，用文字」：每张开着用文字的卡一条；itemId 是拆解单里的那一项。 */
export type ItemText = { title: string; itemId: string; text: string; cardId?: string };
export type WriteVideoRequest = { cardId: string; plan: RewritePlan; userText: string;
  duration: number; sourceDuration?: number; ratio: string; materials: RewriteMaterial[]; keepClothes?: boolean; source?: AssetRef; settings?: FinalSettings;
  sceneTexts?: SceneText[]; itemTexts?: ItemText[] };
export type FinalChange = { before: string; after: string; why: string; evidence: string };
/** 小服务按模板拼底稿；连了要换的人物图会先看一次图，yuan 是那次看图的花费（没有就是 0）。11-08 起本机 agent 就绪时再看图定稿：
 * finalized 为真才是定稿，changes 是改了哪几句；warnings 里有拆解没把握的、看图发现改字解决不了的、退回底稿的原因。 */
export type WriteVideoResult = RewriteCharge & { videoPrompt: string; issues: string[]; warnings: string[]; finalized?: boolean; changes?: FinalChange[];
  sceneReads?: SceneRead[] };
export type CheckVideoRequest = { cardId: string; videoPrompt: string; materials: RewriteMaterial[]; duration: number; changeSeconds: number[] };
