import { describe, expect, it } from "vitest";
import { absorbJob, assetDownloadUrl, assetUrl, cardCounter, cardTitle, currentResult, imageFailure, newCard, newCanvasCard, turnPage } from "./cards";
import type { AssetRef, JobView } from "@/types";

const work = (id: string): AssetRef => ({ type: "work", id });
const job = (patch: Partial<JobView>): JobView => ({ id: "j1", status: "succeeded", createdAt: "", count: 1, works: [], error: null, ...patch });

describe("cards", () => {
  it("有文件名的上传卡不取号，其余来源和媒体照常共用编号", () => {
    const take = cardCounter();
    const image = newCanvasCard("upload", take, [], "image", "测试 猫.png");
    const video = newCanvasCard("upload", take, [], "video", "source_10s.mp4");
    expect([cardTitle(image), cardTitle(video)]).toEqual(["测试 猫.png", "source_10s.mp4"]);
    expect([image.number, video.number]).toEqual([0, 0]);
    expect([
      newCanvasCard("generate", take, [], "image"), newCanvasCard("generate", take, [], "video"),
      newCanvasCard("work", take, [], "image"), newCanvasCard("work", take, [], "video"),
      newCanvasCard("depth", take, [], "video"), newCanvasCard("extracted", take, [], "audio"),
      newCanvasCard("work", take, [], "audio")
    ].map(cardTitle)).toEqual(["图片 1", "视频 2", "图片 3 · 作品库", "视频 4 · 作品库", "视频 5 · 深度", "音频 6 · 原声", "音频 7 · 作品库"]);
  });
  it("编号每次打开从 1 数，图片 / 视频 / 音频共用一个数", () => {
    const take = cardCounter();
    expect([take(), take(), take()]).toEqual([1, 2, 3]);
    const reopened = cardCounter();
    expect(reopened()).toBe(1);
    expect(take()).toBe(4);
  });
  it("新卡默认16:9；副本自定义标题优先", () => {
    expect(newCard("generate", 1).gen.aspect).toBe("16:9");
    expect(newCard("generate", 1).gen.resolution).toBe("2K");
    expect(cardTitle({ ...newCard("generate", 1), title: "自定义 - 副本" })).toBe("自定义 - 副本");
  });
  it("图片探测只有 404 才算真没了", () => {
    expect(imageFailure(404)).toBe("missing");
  });

  it.each([null, 200, 403, 500, 503])("图片探测 %s 作为暂时失败重试", (status) => {
    expect(imageFailure(status)).toBe("retry");
  });

  it("标题：传的图 / 作品库 / 生成卡", () => {
    expect(cardTitle(newCard("upload", 1))).toBe("图片 1 · 传的图");
    expect(cardTitle(newCard("work", 2))).toBe("图片 2 · 作品库");
    expect(cardTitle(newCard("generate", 3))).toBe("图片 3");
  });

  it("当前那张：翻页越界会夹回来，没图是 null", () => {
    expect(currentResult({ results: [work("a"), work("b")], page: 5 })).toEqual(work("b"));
    expect(currentResult({ results: [work("a"), work("b")], page: -1 })).toEqual(work("a"));
    expect(currentResult({ results: [], page: 0 })).toBeNull();
  });

  it("翻页：到头不动（返回原对象）", () => {
    const card = newCard("generate", 1, [work("a"), work("b")]);
    expect(turnPage(card, 1).page).toBe(1);
    expect(turnPage(card, -1)).toBe(card);
  });

  it("单子没跑完不收；不是这张卡的单子不收", () => {
    const card = { ...newCard("generate", 1), jobs: ["j1"] };
    expect(absorbJob(card, job({ status: "running" }))).toBe(card);
    expect(absorbJob(card, job({ id: "other" }))).toBe(card);
  });

  it("出好了：新图追加到最后、翻到第一张新图、单号划掉、清掉旧的提示", () => {
    const card = { ...newCard("generate", 1, [work("old")]), jobs: ["j1"], note: "上次失败了" };
    const next = absorbJob(card, job({ works: ["n1", "n2"] }));
    expect(next.results.map((r) => r.id)).toEqual(["old", "n1", "n2"]);
    expect(next.page).toBe(1);
    expect(next.jobs).toEqual([]);
    expect(next.note).toBeNull();
  });

  it("失败：原因写在卡上，图不变", () => {
    const card = { ...newCard("generate", 1, [work("old")]), jobs: ["j1"] };
    const next = absorbJob(card, job({ status: "failed", error: "被拒了" }));
    expect(next.note).toBe("被拒了");
    expect(next.results).toEqual(card.results);
    expect(next.jobs).toEqual([]);
  });

  it("同一张作品不会重复加", () => {
    const card = { ...newCard("generate", 1, [work("n1")]), jobs: ["j1"] };
    expect(absorbJob(card, job({ works: ["n1"] })).results).toHaveLength(1);
  });

  it("图片地址区分传的图和作品", () => {
    expect(assetUrl({ type: "upload", id: "u1" })).toBe("/api/uploads/file?id=u1");
    expect(assetUrl({ type: "work", id: "w1" })).toBe("/api/works/file?id=w1");
  });

  it("卡上工具条的下载地址：传的和作品都带 download=1", () => {
    expect(assetDownloadUrl({ type: "upload", id: "u 1" })).toBe("/api/uploads/file?id=u%201&download=1");
    expect(assetDownloadUrl({ type: "work", id: "w1" })).toBe("/api/works/file?id=w1&download=1");
  });
});
