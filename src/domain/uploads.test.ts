import { describe, expect, it } from "vitest";
import { filterUploads, pickedAsset, uploadDeleteText, uploadDragData, uploadRef, uploadsSummary } from "./uploads";
import { readDragName, readWorkDrag } from "./media";
import type { UploadView } from "@/uploadTypes";
import type { CharacterView } from "@/characterTypes";

const video: UploadView = { id: "v1", kind: "video", name: "跳舞.mp4", bytes: 10, duration: 5, width: 720, height: 1280, hasAudio: true, fps: 30,
  createdAt: "t", uploadedAt: "t", canvases: ["c1"] };
const image: UploadView = { id: "i1", kind: "image", name: "猫.png", bytes: 3, createdAt: "t", uploadedAt: "t", canvases: [] };

describe("我上传的", () => {
  it("当成上传素材放上画布，视频带时长宽高，标题用原文件名", () => {
    expect(uploadRef(video)).toEqual({ type: "upload", id: "v1", fileName: "跳舞.mp4", media: "video", seconds: 5, width: 720, height: 1280, hasAudio: true, fps: 30 });
    expect(uploadRef(image)).toEqual({ type: "upload", id: "i1", fileName: "猫.png" });
    expect(pickedAsset({ source: "upload", upload: image })).toEqual({ source: "upload", ref: uploadRef(image), kind: "image" });
  });

  it("拖动数据读回来还是上传素材、不带深度白模，带原文件名；作品拖动不受影响", () => {
    const text = uploadDragData(video);
    expect(readWorkDrag(text)).toEqual({ type: "upload", id: "v1", media: "video", seconds: 5, width: 720, height: 1280, hasAudio: true, fps: 30 });
    expect(readDragName(text)).toBe("跳舞.mp4");
    expect(readWorkDrag(uploadDragData(image))).toEqual({ type: "upload", id: "i1" });
    expect(readWorkDrag(JSON.stringify({ from: "upload", id: "a", kind: "audio" }))).toBeNull();
    expect(readDragName(JSON.stringify({ id: "w", kind: "image" }))).toBeUndefined();
    expect(readDragName("old-id")).toBeUndefined();
  });

  it("删除原话分图 / 视频，人物用了这张图时多一句", () => {
    const characters = [{ name: "小李", images: [{ ref: { type: "upload", id: "i1" } }] }, { name: "别人", images: [{ ref: { type: "work", id: "i1" } }] }] as unknown as CharacterView[];
    expect(uploadDeleteText(image, characters)).toBe("删掉这个上传的素材？硬盘上的文件会一起删掉，画布上用到它的卡片会显示「这张图找不到了」。它是人物「小李」的图，人物里也会少这张。");
    expect(uploadDeleteText(video, [])).toContain("「这段视频找不到了」");
  });

  it("占用大小和按画布筛选", () => {
    expect(uploadsSummary(2, 500)).toBe("共 2 个 · 占 500 B");
    expect(uploadsSummary(3, 1.25 * 1024 ** 3)).toBe("共 3 个 · 占 1.3 GB");
    expect(uploadsSummary(1, 50 * 1024 ** 2)).toBe("共 1 个 · 占 50 MB");
    expect(filterUploads([video, image], "c1")).toEqual([video]);
    expect(filterUploads([video, image], null)).toEqual([video, image]);
  });
});
