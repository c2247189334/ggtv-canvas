import type { Node } from "@xyflow/react";
import type { AspectId } from "@/domain/aspects";
import type { ModelId } from "@/domain/pricing";
import type { Resolution } from "@/domain/imageSize";
import type { VideoSettings } from "@/domain/videoModels";
import type { RewriteItem, RewritePlan, RewriteStatus } from './videoRewriteTypes';
import type { ProductPlan, ProductRole } from './productRemakeTypes';

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
export type CardGroup = { id: string; name: string; characterId?: string; productId?: string; videoId?: string };

type CardBase = {
  group?: CardGroup;
  source: CardSource;
  /** 卡片标题的 N，每次打开画布从 1 数，所有类型共用；新上传卡和人物库卡为 0，不占号。 */
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
  rewriteTask?: 'product';
  rewriteStatus?: RewriteStatus;
  /** 最近一次发送时的输入（11-08「输入已更新」用），见 `domain/staleInputs.ts`。 */
  sentInputs?: SentInputs;
};
/** refs：按连线顺序每张参考当时那张（`upload:编号` / `work:编号` / `none`）；prompt：当时的提示词。 */
export type SentInputs = { refs: string[]; prompt: string };

/** 11-16 图层分离的结果：拆的是哪张图、底图（零件拿走后补好的）和各层（都是作品），box 是在底图上的像素位置（左上右下）。 */
export type LayerItem = { work: string; name: string; box: [number, number, number, number] };
export type LayerSplit = { source: AssetRef; base: string; width: number; height: number; items: LayerItem[] };
/** 11-16 图层重绘在跑的单：from 是送去重绘的那层作品，box / name 是出好后落回卡上用的（box 在这张卡的底图像素上）。 */
export type LayerRedrawPending = { job: string; from: string; name: string; box: [number, number, number, number] };

export type VideoGenSettings = VideoSettings & { count: 1 | 2 | 4 };
export type ImageCardData = CardBase & { kind: "image"; gen: GenSettings; video?: never; assetId?: string;
  productRole?: ProductRole;
  rewriteId?: string; rewriteItemId?: string; rewriteItem?: RewriteItem;
  /** 改写背景卡：用户没勾「背景和原片保持一致」，背景换成新场景（素材用途和深度职责跟着变）。 */
  rewriteNewScene?: true;
  /** 改写背景卡对应拆解单里哪个场景；原片只有一个地方时没有。 */
  rewriteSceneId?: string;
  /** 11-11：还没图时卡框的宽高比（宽 ÷ 高），和左边的原片截图一样大；有图后照图的比例。 */
  emptyAspect?: number;
  /** 11-13 改写背景卡「不出图，用文字」：开着时线剪掉、卡上写的字（rewriteSceneText）交给本机 agent 结合原片写；改回用图后字留着。11-16 起衣服卡、东西卡也用这两个字段。 */
  rewriteTextOn?: boolean; rewriteSceneText?: string;
  /** 11-16 图层分离：在拆的单号；拆好的结果留在卡上，下次点开直接摆，不用再花钱。 */
  layerJob?: string; layerSplit?: LayerSplit; layerRedraw?: LayerRedrawPending };
/** 11-13 生成提示词时 agent 对每张背景卡的字怎么理解（text 是当时卡上的字，用来发现之后又改过）。 */
export type SceneRead = { title: string; text: string; read: string; cardId?: string };
export type VideoCardData = CardBase & { kind: "video"; video: VideoGenSettings; gen?: never; assetId?: never; rewriteId?: string; rewriteSourceId?: string; rewriteSource?: AssetRef; rewriteChangeSeconds?: number[];
  rewriteKind?: 'product'; productPlan?: ProductPlan;
  productAutoPosition?: { x: number; y: number };
  rewritePlan?: RewritePlan; rewriteUserText?: string; rewriteWarnings?: string[]; rewriteMotionReference?: 'depth' | 'mesh';
  /** 勾了「衣服和原片保持一致」：衣服卡删了也不穿人物图那身，退回文字描述。 */
  rewriteKeepClothes?: true;
  rewriteSceneReads?: SceneRead[] };
export type AudioCardData = CardBase & { kind: "audio"; gen?: never; video?: never; assetId?: never };
export type CardData = ImageCardData | VideoCardData | AudioCardData;
export type CardPatch = Partial<Omit<CardBase, "source" | "number">> & { gen?: GenSettings; video?: VideoGenSettings; assetId?: string;
  rewriteItem?: RewriteItem; rewritePlan?: RewritePlan; rewriteUserText?: string; rewriteWarnings?: string[]; productPlan?: ProductPlan;
  rewriteTextOn?: boolean; rewriteSceneText?: string; rewriteSceneReads?: SceneRead[];
  layerJob?: string; layerSplit?: LayerSplit; layerRedraw?: LayerRedrawPending };

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
export type LayerJobView = { id: string; kind: "layers"; status: JobStatus; error: string | null; errorCode?: string | null;
  source?: AssetRef; layers?: Omit<LayerSplit, "source"> | null };
export type LayerRedrawView = { id: string; kind: "layer-redraw"; status: JobStatus; error: string | null; errorCode?: string | null;
  redraw?: { from: string; work: string } | null };
export type LayerRedrawRequest = { canvasId: string; cardId: string; layer: string; name: string; text: string };
export type LayerJobRequest = { canvasId: string; cardId: string; source: { type: "upload" | "work"; id: string };
  origin: { type: "upload" | "work"; id: string }; text: string;
  boxes: Array<[number, number, number, number]> };
export type JobView = { id: string; kind?: "image" | "video"; status: JobStatus; phase?: JobPhase; warning?: string | null; blocked?: number[]; createdAt: string; count: number; works: string[]; error: string | null; errorCode?: string | null; workMeta?: Array<{ id: string; duration: number; width: number; height: number; hasAudio?: boolean; fps?: number | null }> };
export type DepthJobView = Omit<JobView, "kind" | "phase"> & { kind: "depth" | "mesh"; phase: "processing" | null;
  errorCode: string | null; source: LocalMediaSource; resolution: "480p" | "720p" };
export type LocalJobView = DepthJobView & { cardId: string };
/** 小服务接了、画布存档里还没记下的付费单（见 domain/paidRecovery.ts）。 */
export type OrphanJob = { id: string; cardId: string; kind: "image" | "video" };

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
  /** 11-16 图层分离存的底图 / 图层（作品库不显示）。 */
  layer?: { role: "base" | "layer" };
};

export type ConfigPresence = { filled: boolean; found: boolean };
export type Health = { ok: boolean; fake: boolean; keyReady: boolean; tosReady: boolean; todayYuan: number; uncertainToday: number;
  depth?: { python: ConfigPresence; modelDir: ConfigPresence; extraPackages: ConfigPresence };
  mesh?: { ready?: boolean; url: ConfigPresence; directory: ConfigPresence }; ffmpegFound?: boolean; ffprobeFound?: boolean;
  /** 本机 agent（拆解 / 看图 / 定稿提示词）：.env.local 的 AGENT_ENGINE 选，默认 Claude；agentProblem 是没配好时给人看的话；假模式按就绪。 */
  agent?: string; agentName?: string; agentReady?: boolean; agentModel?: string; agentProblem?: string | null };

export type LocalMediaSource = { type: "upload" | "work"; id: string };
export type LocalMediaRequest = { source: LocalMediaSource; canvasId?: string; cardId?: string };
export type DepthJobRequest = LocalMediaRequest & { resolution: "480p" | "720p" };
export type FrameRegion = 'top' | 'bottom' | 'left' | 'right';
export type FrameRequest = LocalMediaRequest & { second: number; region?: FrameRegion };
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
