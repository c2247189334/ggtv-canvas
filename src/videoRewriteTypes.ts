import type { AssetRef } from './types';
import type { VideoRatio } from './domain/videoModels';
import type { MotionReference } from './domain/motionReference';

export type RewriteItemKind = '人物' | '衣服' | '场景' | '道具' | '遮挡物' | '其他';
/** person：衣服是谁的；where：分屏时这个人在哪块；sameAs：隔一段穿回的同一套，指向第一次穿的那项。 */
export type RewriteItem = { id: string; kind: RewriteItemKind; desc: string; from: number; to: number; frame: number; person?: string; where?: string; sameAs?: string };
export type RewritePlan = { summary: string; items: RewriteItem[]; changes: Array<{ second: number; how: string }>;
  actions: Array<{ from: number; to: number; desc: string }>; replace: string[]; unsure: string[] };
export type RewriteMaterial = { tag: string; purpose: string; itemId?: string; originalDesc?: string; asset?: AssetRef };
export type RewriteStatus = { status: 'pending' | 'interrupted' } |
  { status: 'failed'; error: string };
/** 一次运行的内存快照，不进画布存档。 */
export type VideoRewriteState = {
  batchId: string; sourceId: string; source: AssetRef; sourcePosition: { x: number; y: number };
  userText: string; plan: RewritePlan | null; ratio: VideoRatio; duration: number; targetDuration: number;
  hasAudio: boolean; depthId?: string; motionReference?: MotionReference;
  /** 原片截图卡和由它去人出图的背景卡；截图没人时没有截图卡；newScene 时背景换新场景，也没有截图卡。 */
  frameId?: string; backgroundId?: string; newScene?: boolean;
  /** 原片换了地方时，第 2 个场景起的背景卡，顺序和拆解单的场景一致。 */
  extraBackgroundIds?: string[];
  /** 勾了「衣服和原片保持一致」：没写要换的衣服从原片抽成图。 */
  keepClothes?: boolean;
  videoId?: string;
};
