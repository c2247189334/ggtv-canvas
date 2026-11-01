import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadMedia } from "./uploadMedia";
import { api } from "@/api";
import { prepareUpload } from "@/domain/imagePrep";
import { videoDuration } from "@/common/videoDuration";

vi.mock("@/api", () => ({ api: { upload: vi.fn() } }));
vi.mock("@/domain/imagePrep", () => ({ prepareUpload: vi.fn() }));
vi.mock("@/common/videoDuration", () => ({ videoDuration: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("uploadMedia", () => {
  it("缩图改名后仍携带用户原文件名；失败文件不挤错后续名字", async () => {
    const files = ["坏图.png", "测试 猫.png", "source_10s.mp4"].map(name =>
      new File([name], name, { type: name.endsWith("mp4") ? "video/mp4" : "image/png" }));
    vi.mocked(prepareUpload).mockRejectedValueOnce(new Error("坏图")).mockResolvedValue(new File(["small"], "renamed.jpg"));
    vi.mocked(api.upload).mockResolvedValueOnce({ id: "image", kind: "image" }).mockResolvedValueOnce({ id: "video", kind: "video" });
    const notify = vi.fn();
    const refs = await uploadMedia(files, true, notify);
    expect(refs).toMatchObject([{ id: "image", fileName: "测试 猫.png" }, { id: "video", fileName: "source_10s.mp4" }]);
    expect(notify).toHaveBeenCalledExactlyOnceWith("「坏图.png」没传上：坏图");
  });
  it("先读视频时长，超900秒不上传；900秒和读不出仍交小服务", async () => {
    const file = new File(["v"], "v.mp4", { type: "video/mp4" });
    const notify = vi.fn();
    vi.mocked(videoDuration).mockResolvedValue(901);
    expect(await uploadMedia([file], true, notify)).toEqual([]);
    expect(api.upload).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("「v.mp4」没传上：请上传小于 1.5G 且时长在 15 分钟以内的视频。");
    vi.mocked(api.upload).mockResolvedValue({ id: "v", kind: "video", duration: 2 });
    for (const seconds of [900, null]) {
      vi.mocked(videoDuration).mockResolvedValue(seconds);
      expect(await uploadMedia([file], true, notify)).toHaveLength(1);
    }
    expect(api.upload).toHaveBeenCalledTimes(2);
  });
  it("上传视频保留有无音轨与fps，给工具条和存档使用", async () => {
    vi.mocked(api.upload).mockResolvedValue({ id: "silent", kind: "video", duration: 2, hasAudio: false, fps: 30 });
    const refs = await uploadMedia([new File(["v"], "v.mp4", { type: "video/mp4" })], true, () => {});
    expect(refs[0]).toMatchObject({ hasAudio: false, fps: 30 });
  });
  it("视频原字节上传，缺MIME补齐，不走图片缩放", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "clip.mov");
    vi.mocked(api.upload).mockResolvedValue({ id: "v", kind: "video", duration: 5, width: 640, height: 360 });
    const refs = await uploadMedia([file], true, () => {});
    expect(prepareUpload).not.toHaveBeenCalled();
    const body = vi.mocked(api.upload).mock.calls[0][0];
    expect(body.type).toBe("video/quicktime");
    expect(new Uint8Array(await body.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(refs).toEqual([{ type: "upload", id: "v", fileName: "clip.mov", media: "video", seconds: 5, width: 640, height: 360 }]);
  });
  it("图片照旧先缩，失败原话通知，图片入口不发视频", async () => {
    const file = new File(["img"], "x.png", { type: "image/png" });
    const prepared = new File(["small"], "small.jpg", { type: "image/jpeg" });
    vi.mocked(prepareUpload).mockResolvedValue(prepared);
    vi.mocked(api.upload).mockResolvedValue({ id: "i", kind: "image" });
    const notify = vi.fn();
    expect(await uploadMedia([file, new File(["v"], "v.mp4")], false, notify)).toEqual([{ type: "upload", id: "i", fileName: "x.png" }]);
    expect(api.upload).toHaveBeenCalledExactlyOnceWith(prepared);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("只收"));
    vi.mocked(api.upload).mockRejectedValue(new Error("服务原话"));
    expect(await uploadMedia([file], false, notify)).toEqual([]);
    expect(notify).toHaveBeenCalledWith("「x.png」没传上：服务原话");
  });
});
