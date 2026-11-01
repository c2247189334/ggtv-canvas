import { describe, expect, it } from "vitest";
import { blockedReferenceMessage, videoModeLabel } from "./videoPanel";

describe("视频模式按钮文字", () => {
  it("图生视频没接素材也显示图生视频", () => {
    expect(videoModeLabel("first_frame", 0)).toBe("图生视频");
    expect(videoModeLabel("first_frame", 1)).toBe("图生视频");
  });
  it("全能参考接了素材显示全能参考", () => {
    expect(videoModeLabel("reference", 2)).toBe("全能参考");
  });
  it("全能参考没接素材显示文生视频", () => {
    expect(videoModeLabel("reference", 0)).toBe("文生视频");
  });
});

describe("被拦原话的参考编号", () => {
  it("单个图片参考使用缩略图称呼", () => {
    expect(blockedReferenceMessage("参考 1 被火山拦下：原话。", [1], ["image"]))
      .toBe("图片1 被火山拦下：原话。");
  });
  it("多个参考只替换开头，保留后面的原话", () => {
    expect(blockedReferenceMessage("参考 1、参考 3 被火山拦下：参考 3 有问题。", [1, 3], ["image", "image", "image"]))
      .toBe("图片1、图片3 被火山拦下：参考 3 有问题。");
  });
  it("混排时按类型编号，第 2 根线是图片1", () => {
    expect(blockedReferenceMessage("参考 2 被火山拦下：原话", [2], ["video", "image"]))
      .toBe("图片1 被火山拦下：原话");
    expect(blockedReferenceMessage("参考 1、参考 3、参考 4 被火山拦下：原话", [1, 3, 4], ["video", "image", "video", "image"]))
      .toBe("视频1、视频2、图片2 被火山拦下：原话");
  });
  it("没有这种开头时原样返回", () => {
    expect(blockedReferenceMessage("火山原话：参考 1 不合规", [1], ["image"]))
      .toBe("火山原话：参考 1 不合规");
  });
  it("没有被拦编号或编号无法对应时保留原话", () => {
    const message = "参考 2 被火山拦下：原话";
    expect(blockedReferenceMessage(message, [], ["video", "image"])).toBe(message);
    expect(blockedReferenceMessage(message, [2], ["video"])).toBe(message);
    expect(blockedReferenceMessage(message, [1], ["video", "image"])).toBe(message);
  });
});
