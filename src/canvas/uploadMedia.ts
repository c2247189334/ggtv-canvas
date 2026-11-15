import { api } from "@/api";
import { prepareUpload } from "@/domain/imagePrep";
import { uploadKind, VIDEO_UPLOAD_MESSAGE } from "@/domain/media";
import { videoDuration } from "@/common/videoDuration";
import type { Notify } from "@/common/Toast";
import type { AssetRef } from "@/types";
import { bumpWorks } from "@/library/worksEvents";

/** 图片沿用缩图；视频直接交原字节，大小和可读时长先在页面检查。带原文件名上传 = 进「我上传的」。 */
export async function uploadMedia(files: File[], includeVideo: boolean, notify: Notify): Promise<Array<AssetRef & { fileName: string }>> {
  const refs: Array<AssetRef & { fileName: string }> = [];
  for (const file of files) {
    try {
      const { kind, mime } = uploadKind(file, includeVideo);
      if (kind === "video" && (await videoDuration(file) ?? 0) > 900) throw new Error(VIDEO_UPLOAD_MESSAGE);
      const body = kind === "video" ? file.type ? file : file.slice(0, file.size, mime) : await prepareUpload(file);
      const result = await api.upload(body, file.name);
      refs.push({ type: "upload", id: result.id, fileName: file.name, ...(kind === "video" ? {
        media: "video", seconds: result.duration, width: result.width, height: result.height,
        ...(result.hasAudio !== undefined ? { hasAudio: result.hasAudio } : {}), ...(result.fps !== undefined ? { fps: result.fps } : {})
      } : {}) });
    } catch (err) {
      notify(`「${file.name}」没传上：${(err as Error).message}`);
    }
  }
  if (refs.length) bumpWorks();
  return refs;
}
