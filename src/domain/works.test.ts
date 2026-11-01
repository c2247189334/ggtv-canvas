import { describe, expect, it } from "vitest";
import { filterWorks, workTitle } from "./works";
import type { AudioWorkView, WorkView } from "@/types";

describe("workTitle", () => {
  it("去掉开头那行编号说明", () => {
    expect(workTitle({ prompt: "只有 1 张图，就是图1。\n\n把图1 换成蓝色" })).toBe("把图1 换成蓝色");
    expect(workTitle({ prompt: "一共 2 张图，按顺序是图1、图2。\n\nx" })).toBe("x");
  });

  it("没连图的原样；空的叫「作品」", () => {
    expect(workTitle({ prompt: "一只猫" })).toBe("一只猫");
    expect(workTitle({ prompt: "" })).toBe("作品");
  });

  it("视频作品把发给火山的 @图像N 换回面板里的 @图片N", () => {
    expect(workTitle({ kind: "video", prompt: "@图像1 和 @图像12 跟着 @视频1 跳舞" })).toBe("@图片1 和 @图片12 跟着 @视频1 跳舞");
    expect(workTitle({ kind: "image", prompt: "@图像1 原样" })).toBe("@图像1 原样");
  });
});

const w = (id: string, canvasId: string, kind: "image" | "video" = "image"): WorkView => ({
  id, kind, canvasId, createdAt: "", prompt: "", model: "", yuan: 0, width: null, height: null
});

describe("filterWorks", () => {
  const works = [w("a", "c1"), w("b", "c2"), w("v", "c1", "video")];

  it("全部", () => {
    expect(filterWorks(works, "all", null)).toHaveLength(3);
  });

  it("只看图片", () => {
    expect(filterWorks(works, "image", null).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("只看这张画布的", () => {
    expect(filterWorks(works, "all", "c1").map((x) => x.id)).toEqual(["a", "v"]);
  });

  it("声音参与全部、声音和画布筛选，不混进图片视频", () => {
    const audio: AudioWorkView = { id: "s", kind: "audio", canvasId: "c1", createdAt: "", prompt: "原声", model: "", yuan: 0,
      duration: 5, format: "wav", contentType: "audio/wav", channels: 1, sampleRate: 44100, bitsPerSample: 16, bytes: 100 };
    const media = [...works, audio];
    expect(filterWorks(media, "all", null).map(x => x.id)).toEqual(["a", "b", "v", "s"]);
    expect(filterWorks(media, "audio", "c1").map(x => x.id)).toEqual(["s"]);
    expect(filterWorks(media, "audio", "c2")).toEqual([]);
    expect(filterWorks(media, "video", null).map(x => x.id)).toEqual(["v"]);
    expect(workTitle(audio)).toBe("原声");
  });
});
