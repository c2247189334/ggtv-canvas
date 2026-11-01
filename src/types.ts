import type { Node } from "@xyflow/react";
import type { AspectId } from "@/domain/aspects";
import type { ModelId } from "@/domain/pricing";
import type { Resolution } from "@/domain/imageSize";
import type { VideoSettings } from "@/domain/videoModels";
import type { RewriteItem, RewritePlan, RewriteStatus } from './videoRewriteTypes';

/** 一张图在哪：传的图（数据/上传）还是作品（数据/作品）。 */
export type AssetRef = { type: "upload" | "work"; id: string; media?: "video" | "audio"; seconds?: number; width?: number; height?: number;
  hasAudio?: boolean; fps?: number | null; depth?: boolean; mesh?: boolean };

/** 卡片从哪来：传的图、从作品库拿的、生成卡。只有生成卡有提示词面板、收参考图。 */
export type CardSource = "upload" | "work" | "generate" | "extracted" | "depth" | "mesh";

export type GenSettings = {
  model: ModelId;
  resolution: Resolution;
  /** 0 = 用下面的 aspect；N = 跟参考图 N 的比例走。默认 1。 */
  sizeFrom: number;
  aspect: AspectId;
  /** 1~4 张。 */
  count: number;
};

/** 卡片上存的全部东西（画布存档里就是这个）。type 写法而不是 interface：画布库要求能当 Record 用。 */
type CardBase = {
  source: CardSource;
  /** 卡片标题的 N，每次打开画布从 1 数，所有类型共用；新上传卡为 0，不占号。 */
  number: number;
  /** 上传原文件名（带后缀）或副本标题；旧存档没有时按来源和编号显示。 */
  title?: string;
  /** 卡里显示的图（传的图只有一张；生成卡每出一次往后追加）。 */
  results: AssetRef[];
  /** 当前翻到第几张（从 0 数）。 */
  page: number;
  prompt: string;
  /** 交出去还没收回来的单号。 */
  jobs: string[];
  /** 最近一单没出成 / 只出了一部分时的原话。 */
  note: string | null;
  blocked?: number[];
  depthJobId?: string;
  startedAt?: string;
  /** 深度 / 原声实际取自哪条结果；来源卡翻页后也不改变。 */
  mediaSource?: AssetRef;
  /** 仅运行时显示，toDoc 明确排除。 */
  phase?: JobPhase;
  /** 火山查单网络提示，仅运行时显示，不作为失败。 */
  jobWarning?: string | null;
  rewriteBusy?: 'analyzing';
  rewriteStatus?: RewriteStatus;
};

export type VideoGenSettings = VideoSettings & { count: 1 | 2 | 4 };
export type ImageCardData = CardBase & { kind: "image"; gen: GenSettings; video?: never; assetId?: string;
  rewriteId?: string; rewriteItemId?: string; rewriteItem?: RewriteItem;
  /** 改写背景卡：用户没勾「背景和原片保持一致」，背景换成新场景（素材用途和深度职责跟着变）。 */
  rewriteNewScene?: true };
export type VideoCardData = CardBase & { kind: "video"; video: VideoGenSettings; gen?: never; assetId?: never; rewriteId?: string; rewriteSourceId?: string; rewriteSource?: AssetRef; rewriteChangeSeconds?: number[];
  rewritePlan?: RewritePlan; rewriteUserText?: string; rewriteWarnings?: string[]; rewriteMotionReference?: 'depth' | 'mesh' };
export type AudioCardData = CardBase & { kind: "audio"; gen?: never; video?: never; assetId?: never };
export type CardData = ImageCardData | VideoCardData | AudioCardData;
export type CardPatch = Partial<Omit<CardBase, "source" | "number">> & { gen?: GenSettings; video?: VideoGenSettings; assetId?: string;
  rewriteItem?: RewriteItem; rewritePlan?: RewritePlan; rewriteUserText?: string; rewriteWarnings?: string[] };

export type CardNode = Node<CardData, "card">;

export type CanvasDoc = {
  id: string;
  name: string;
  nodes: Array<{ id: string; x: number; y: number; data: CardData }>;
  edges: Array<{ id: string; source: string; target: string }>;
  createdAt?: string;
  updatedAt?: string;
  /** 历史存档缺少时按0读取；保存另带baseVersion作冲突检查。 */
  version?: number;
};
export type CanvasSave = CanvasDoc & { baseVersion: number };

export type CanvasSummary = { id: string; name: string; updatedAt: string };

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "uncertain" | "missing";

export type JobPhase = "uploading" | "submitting" | "waiting" | "downloading" | null;
export type JobView = { id: string; kind?: "image" | "video"; status: JobStatus; phase?: JobPhase; warning?: string | null; blocked?: number[]; createdAt: string; count: number; works: string[]; error: string | null; workMeta?: Array<{ id: string; duration: number; width: number; height: number; hasAudio?: boolean; fps?: number | null }> };
export type DepthJobView = Omit<JobView, "kind" | "phase"> & { kind: "depth" | "mesh"; phase: "processing" | null;
  errorCode: string | null; source: LocalMediaSource; resolution: "480p" | "720p" };
export type LocalJobView = DepthJobView & { cardId: string };

export type WorkView = {
  id: string;
  kind: "image" | "video";
  createdAt: string;
  canvasId: string | null;
  prompt: string;
  model: string;
  yuan: number;
  width: number | null;
  height: number | null;
  duration?: number | null;
  hasAudio?: boolean;
  fps?: number | null;
  depth?: boolean;
  mesh?: boolean;
  source?: LocalMediaSource;
  resolution?: string;
  elapsedSeconds?: number;
};

export type ConfigPresence = { filled: boolean; found: boolean };
export type Health = { ok: boolean; fake: boolean; keyReady: boolean; tosReady: boolean; todayYuan: number; uncertainToday: number;
  depth?: { python: ConfigPresence; modelDir: ConfigPresence; extraPackages: ConfigPresence };
  mesh?: { ready?: boolean; url: ConfigPresence; directory: ConfigPresence }; ffmpegFound?: boolean; ffprobeFound?: boolean };

export type LocalMediaSource = { type: "upload" | "work"; id: string };
export type LocalMediaRequest = { source: LocalMediaSource; canvasId?: string; cardId?: string };
export type DepthJobRequest = LocalMediaRequest & { resolution: "480p" | "720p" };
export type FrameRequest = LocalMediaRequest & { second: number };
export type VideoClipRequest = LocalMediaRequest & { start: number; end: number };
export type VideoClipUpload = { id: string; kind: 'video'; duration: number; width: number; height: number; fps: number | null; hasAudio: boolean };
export type AudioWorkView = Omit<WorkView, "kind" | "width" | "height" | "duration"> & {
  kind: "audio"; duration: number; format: "wav"; contentType: "audio/wav";
  channels: number; sampleRate: number; bitsPerSample: 16; bytes: number;
};
export type MediaWorkView = WorkView | AudioWorkView;
export type RewriteResult = { text: string; model: string; usage: { input_tokens: number; output_tokens: number }; yuan: number };

export type VideoJobRequest = VideoSettings & { canvasId: string; cardId: string; prompt: string; taskType?: 'reference';
  /** 出好后配回这条视频的声音（改写视频关着生成音频时）。 */
  soundtrack?: { type: "upload" | "work"; id: string };
  refs: Array<{ type: "upload" | "work"; id: string; asset?: string }> };

export type JobRequest = {
  canvasId: string;
  cardId: string;
  model: ModelId;
  prompt: string;
  size: string;
  count: number;
  refs: AssetRef[];
};
