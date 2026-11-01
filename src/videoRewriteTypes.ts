import type { AssetRef } from './types';
import type { VideoRatio } from './domain/videoModels';
import type { MotionReference } from './domain/motionReference';

export type RewriteItemKind = '人物' | '衣服' | '场景' | '道具' | '遮挡物' | '其他';
export type RewriteItem = { id: string; kind: RewriteItemKind; desc: string; from: number; to: number; frame: number };
export type RewritePlan = { summary: string; items: RewriteItem[]; changes: Array<{ second: number; how: string }>;
  actions: Array<{ from: number; to: number; desc: string }>; replace: string[]; unsure: string[] };
export type RewriteMaterial = { tag: string; purpose: string; itemId?: string; originalDesc?: string; asset?: AssetRef };
export type RewriteStatus = { status: 'pending' | 'interrupted' } |
  { status: 'failed'; error: string; yuan: number; costUnknown: boolean };
/** 一次运行的内存快照，不进画布存档。 */
export type VideoRewriteState = {
  batchId: string; sourceId: string; source: AssetRef; sourcePosition: { x: number; y: number };
  userText: string; plan: RewritePlan | null; ratio: VideoRatio; duration: number; targetDuration: number;
  hasAudio: boolean; depthId?: string; motionReference?: MotionReference;
  /** 原视频第一帧卡和由它去人出图的背景卡；newScene 时背景换新场景、第一帧只当机位参考。 */
  frameId?: string; backgroundId?: string; newScene?: boolean;
  videoId?: string;
};
