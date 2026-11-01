import { checkVideoRefs, estimateVideo, type VideoSettings } from "./videoModels";
import { numberMediaRefs, type RefMedia } from "./mention";
import type { AssetRef, Health, JobPhase, VideoGenSettings } from "@/types";

export function videoModeLabel(mode: VideoSettings["mode"], refCount: number): string {
  return mode === "first_frame" ? "图生视频" : refCount ? "全能参考" : "文生视频";
}

export function blockedReferenceMessage(message: string, blocked: readonly number[], referenceTypes: readonly RefMedia[]): string {
  const prefix = message.match(/^参考\s*\d+(?:、参考\s*\d+)*(?=\s|被|[:：]|$)/)?.[0];
  if (!prefix || !blocked.length) return message;
  const refs = numberMediaRefs(referenceTypes.map(media => ({ media })));
  const indices = [...prefix.matchAll(/参考\s*(\d+)/g)].map(match => Number(match[1]));
  if (indices.some(index => !blocked.includes(index) || !refs[index - 1])) return message;
  const label = prefix.replace(/参考\s*(\d+)/g, (_, index: string) => {
    const ref = refs[Number(index) - 1];
    return `${ref.media === "video" ? "视频" : ref.media === "audio" ? "音频" : "图片"}${ref.number}`;
  });
  return label + message.slice(prefix.length);
}

export function videoSummary(settings: VideoGenSettings): string {
  return `${settings.ratio === "adaptive" ? "Auto" : settings.ratio} · ${settings.resolution.toUpperCase()} · ${settings.duration}s · ${settings.count}个`;
}

export function videoEstimate(settings: VideoGenSettings, refs: readonly AssetRef[]) {
  const refVideoSeconds = refs.reduce((total, ref) => total + (ref.media === "video" ? ref.seconds ?? 0 : 0), 0);
  const estimate = estimateVideo({ ...settings, refVideoSeconds });
  return { ...estimate, yuan: estimate.yuan * settings.count };
}

export const TOS_PROBLEM = "参考视频要先传到火山存储：.env.local 里还没填 TOS_ACCESS_KEY_ID、TOS_SECRET_ACCESS_KEY、TOS_BUCKET，填好不用重启。";
export function videoProblems(settings: VideoSettings, refs: readonly AssetRef[], health: Pick<Health, "fake" | "tosReady"> | null): string[] {
  const videos = refs.filter(ref => ref.media === "video");
  const audios = refs.filter(ref => ref.media === "audio");
  const problems = checkVideoRefs({ ...settings, images: refs.length - videos.length - audios.length,
    videos: videos.map(ref => ref.seconds ?? NaN), audios: audios.map(ref => ref.seconds ?? NaN) });
  if (videos.length && health?.fake === false && !health.tosReady) problems.push(TOS_PROBLEM);
  return problems;
}

export function validAssetId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

export function videoAspect(settings: VideoSettings, ref?: AssetRef | null): string {
  if (ref?.width && ref.height) return `${ref.width} / ${ref.height}`;
  return (settings.ratio === "adaptive" ? "16:9" : settings.ratio).replace(":", " / ");
}

export function phaseLabel(phase: JobPhase | undefined): string {
  return phase ? { uploading: "传参考视频…", submitting: "提交中…", waiting: "正在生成中…", downloading: "下载中…" }[phase] : "排队中";
}

export function durationLabel(seconds?: number | null): string {
  const value = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
