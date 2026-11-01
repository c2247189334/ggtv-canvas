/**
 * 卡片上的纯逻辑：新建、标题、当前那张、翻页、把出好的单子收进卡片。
 * 卡片就是结果：生成卡每出一次，新图往翻页后面追加，旧的不丢。
 */
import { FLASH_MODEL } from "@/domain/pricing";
import { DEFAULT_VIDEO_SETTINGS } from "./videoModels";
import type { AssetRef, AudioCardData, CardData, CardSource, GenSettings, ImageCardData, VideoCardData, JobStatus, JobView } from "@/types";

export const DEFAULT_GEN: GenSettings = { model: FLASH_MODEL, resolution: "2K", sizeFrom: 1, aspect: "16:9", count: 1 };

export function cardCounter(): () => number {
  let number = 0;
  return () => ++number;
}

export function newCard(source: CardSource, number: number, results: AssetRef[] = []): ImageCardData {
  return { kind: "image", source, number, results, page: 0, prompt: "", gen: { ...DEFAULT_GEN }, jobs: [], note: null };
}

export function newVideoCard(source: CardSource, number: number, results: AssetRef[] = []): VideoCardData {
  return { kind: "video", source, number, results, page: 0, prompt: "", video: { ...DEFAULT_VIDEO_SETTINGS, count: 1 }, jobs: [], note: null };
}

export function newAudioCard(source: CardSource, number: number, results: AssetRef[] = []): AudioCardData {
  return { kind: "audio", source, number, results, page: 0, prompt: "", jobs: [], note: null };
}

/** 新上传卡用原文件名、不取号；0 表示未占编号，旧卡的正数保持原样。 */
export function newCanvasCard(source: CardSource, takeNumber: () => number, results: AssetRef[], kind: CardData["kind"], title?: string): CardData {
  const namedUpload = source === "upload" && Boolean(title);
  const create = kind === "audio" ? newAudioCard : kind === "video" ? newVideoCard : newCard;
  const card = create(source, namedUpload ? 0 : takeNumber(), results);
  return namedUpload ? { ...card, title } : card;
}

const SOURCE_LABEL: Record<CardSource, string> = { upload: "传的图", work: "作品库", generate: "", extracted: "原声", depth: "深度", mesh: "白模" };

export function cardTitle(card: Pick<CardData, "number" | "source" | "title"> & { kind?: CardData["kind"] }): string {
  if (card.title) return card.title;
  const video = card.kind === "video";
  const label = video && card.source === "upload" ? "传的视频" : SOURCE_LABEL[card.source];
  const title = `${video ? "视频" : card.kind === "audio" ? "音频" : "图片"} ${card.number}`;
  return label ? `${title} · ${label}` : title;
}

/** 当前翻到的那张。翻页数越界就夹回来；没图返回 null。 */
export function currentResult(card: Pick<CardData, "results" | "page">): AssetRef | null {
  if (!card.results.length) return null;
  const page = Math.min(Math.max(0, Math.floor(card.page)), card.results.length - 1);
  return card.results[page] ?? null;
}

/** ◀ ▶ 翻页。到头不动，返回原对象（调用方靠 === 判断没变）。 */
export function turnPage(card: CardData, delta: number): CardData {
  const last = card.results.length - 1;
  if (last < 1) return card;
  const page = Math.min(Math.max(0, card.page + delta), last);
  return page === card.page ? card : { ...card, page };
}

export function assetUrl(ref: AssetRef): string {
  const id = encodeURIComponent(ref.id);
  return ref.type === "upload" ? `/api/uploads/file?id=${id}` : `/api/works/file?id=${id}`;
}

/** 卡上工具条「下载」用：让浏览器存成文件而不是打开。 */
export function assetDownloadUrl(ref: AssetRef): string {
  return `${assetUrl(ref)}&download=1`;
}

/** 只有小服务明确回 404 才当作删除，断网和其他响应都允许重试。 */
export function imageFailure(status: number | null): "missing" | "retry" {
  return status === 404 ? "missing" : "retry";
}

const FINISHED: ReadonlySet<JobStatus> = new Set(["succeeded", "failed", "uncertain", "missing"]);

export function isFinished(status: JobStatus): boolean {
  return FINISHED.has(status);
}

/**
 * 把一单的结果收进卡片：新图追加到翻页最后、翻到第一张新图、单号划掉；
 * 失败 / 只出了一部分的原话写进 note。没跑完、不是这张卡的单子，原样返回。
 */
export function absorbJob(card: CardData, job: JobView): CardData {
  if (card.kind === "audio" || card.source !== "generate") return card;
  if (!card.jobs.includes(job.id)) return card;
  if (!isFinished(job.status)) {
    if (card.kind !== "video" || card.phase === job.phase && (card.jobWarning ?? null) === (job.warning ?? null)) return card;
    return { ...card, phase: job.phase, jobWarning: job.warning ?? null };
  }
  const have = new Set(card.results.filter((r) => r.type === "work").map((r) => r.id));
  const fresh = job.works.filter((id) => !have.has(id)).map((id): AssetRef => {
    if (card.kind !== "video") return { type: "work", id };
    const meta = job.workMeta?.find(work => work.id === id);
    return { type: "work", id, media: "video", ...(meta ? { seconds: meta.duration, width: meta.width, height: meta.height,
      ...(typeof meta.hasAudio === "boolean" ? { hasAudio: meta.hasAudio } : {}), ...(meta.fps !== undefined ? { fps: meta.fps } : {}) } : {}) };
  });
  const { phase: _phase, jobWarning: _jobWarning, ...settled } = card;
  return {
    ...settled,
    results: [...card.results, ...fresh],
    page: fresh.length ? card.results.length : card.page,
    jobs: card.jobs.filter((id) => id !== job.id),
    note: job.error ?? (fresh.length && card.kind === "image" ? null : card.note),
    ...(job.blocked?.length ? { blocked: [...new Set([...(card.blocked ?? []), ...job.blocked])] } : {})
  };
}
