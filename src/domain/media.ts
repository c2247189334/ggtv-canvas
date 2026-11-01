import type { AssetRef, MediaWorkView } from "@/types";

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
/** dragover 不能读取作品 JSON，用类型列表识别图片作品。 */
export const WORK_IMAGE_DRAG_TYPE = 'application/x-canvas-work-image';
export const MEDIA_ACCEPT = `${IMAGE_ACCEPT},video/mp4,video/quicktime,.mp4,.mov`;
export const VIDEO_UPLOAD_MESSAGE = "请上传小于 1.5G 且时长在 15 分钟以内的视频。";

/** 视频直接上传原字节；仅在浏览器没有 MIME 时按扩展名补齐。 */
export function uploadKind(file: { name: string; type: string; size: number }, includeVideo: boolean): { kind: "image" | "video"; mime: string } {
  const mime = file.type || (/\.mp4$/i.test(file.name) ? "video/mp4" : /\.mov$/i.test(file.name) ? "video/quicktime" : "");
  if (/^image\/(png|jpeg|webp)$/.test(mime)) return { kind: "image", mime };
  if (includeVideo && /^video\/(mp4|quicktime)$/.test(mime)) {
    if (file.size > 1610612736) throw new Error(VIDEO_UPLOAD_MESSAGE);
    return { kind: "video", mime };
  }
  throw new Error(includeVideo ? "只收 PNG、JPG、WebP 图片和 MP4、MOV 视频。" : "这里只收 PNG、JPG、WebP 图片。");
}

export function workRef(work: Pick<MediaWorkView, "id" | "kind" | "duration"> & {
  width?: number | null; height?: number | null; hasAudio?: boolean; fps?: number | null; depth?: boolean; mesh?: boolean
}): AssetRef {
  return { type: "work", id: work.id, ...(work.kind === "video" || work.kind === "audio" ? {
    media: work.kind, ...(work.duration != null ? { seconds: work.duration } : {}),
    ...(work.kind === "video" ? { ...(work.width && work.height ? { width: work.width, height: work.height } : {}),
      ...(typeof work.hasAudio === "boolean" ? { hasAudio: work.hasAudio } : {}), ...(work.fps !== undefined ? { fps: work.fps } : {}),
      ...(typeof work.depth === "boolean" ? { depth: work.depth } : {}), ...(typeof work.mesh === 'boolean' ? { mesh: work.mesh } : {}) } : {})
  } : {}) };
}

export function readWorkDrag(text: string): AssetRef | null {
  if (!text) return null;
  // 旧拖入数据只有作品编号；新数据只接收明确的作品元数据。
  if (!text.startsWith("{")) return { type: "work", id: text };
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return null;
    const work = value as MediaWorkView;
    if (typeof work.id !== "string" || (work.kind !== "image" && work.kind !== "video" && work.kind !== "audio")) return null;
    return workRef(work);
  } catch {
    return null;
  }
}
