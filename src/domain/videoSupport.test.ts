import { describe, expect, it } from "vitest";
import { newCard, newVideoCard, cardTitle, absorbJob } from "./cards";
import { fromDoc, readCard, toDoc } from "./canvasDoc";
import { checkLink } from "./refs";
import { addMenuItems } from "./menus";
import { insertMention, numberMediaRefs } from "./mention";
import { toVideoPrompt } from "./videoPrompt";
import { videoSummary, videoEstimate, videoProblems, validAssetId, videoAspect, phaseLabel, durationLabel } from "./videoPanel";
import { DEFAULT_VIDEO_SETTINGS, estimateVideo } from "./videoModels";
import type { CardNode, JobView } from "@/types";

describe("视频数据与收单", () => {
  it("共用编号，按来源显示视频标题", () => {
    expect(cardTitle(newCard("generate", 1))).toBe("图片 1");
    expect(cardTitle(newVideoCard("generate", 2))).toBe("视频 2");
    expect(cardTitle(newVideoCard("upload", 3))).toBe("视频 3 · 传的视频");
    expect(cardTitle(newVideoCard("work", 4))).toBe("视频 4 · 作品库");
  });
  it("视频收真实元数据，被拦序号保留，终态清阶段", () => {
    const card = { ...newVideoCard("generate", 1), jobs: ["j"], phase: "waiting" as const };
    const job: JobView = { id: "j", kind: "video", status: "succeeded", createdAt: "", count: 1, works: ["w"], workMeta: [{ id: "w", duration: 5, width: 320, height: 180 }], error: null };
    const next = absorbJob(card, job);
    expect(next.results).toEqual([{ type: "work", id: "w", media: "video", seconds: 5, width: 320, height: 180 }]);
    expect(next.jobs).toEqual([]);
    expect(next.phase).toBeUndefined();
    expect(absorbJob(card, { ...job, works: [], status: "failed", error: "原话", blocked: [2] })).toMatchObject({ note: "原话", blocked: [2] });
  });
  it("阶段更新只影响运行中的视频，存档不变", () => {
    const card = { ...newVideoCard("generate", 1), jobs: ["j"] };
    const node: CardNode = { id: "v", type: "card", position: { x: 0, y: 0 }, data: card };
    const meta = { id: "c", name: "画布" };
    const next = absorbJob(card, { id: "j", kind: "video", status: "running", phase: "uploading", createdAt: "", count: 1, works: [], error: null });
    expect(next.phase).toBe("uploading");
    expect(toDoc(meta, [{ ...node, data: next }], [])).toEqual(toDoc(meta, [node], []));
  });
  it("视频存档往返，旧格式图片原样读入", () => {
    const old = { kind: "image", source: "upload", number: 2, results: [{ type: "upload", id: "u" }], page: 0, prompt: "", gen: { model: "doubao-seedream-5-0-flash-260915", resolution: "2K", sizeFrom: 1, aspect: "16:9", count: 1 }, jobs: [], note: null };
    expect(readCard(old)).toEqual(old);
    const data = { ...newVideoCard("work", 3, [{ type: "work", id: "v", media: "video", seconds: 6, width: 640, height: 360 }]), blocked: [1] };
    const node: CardNode = { id: "v", type: "card", position: { x: 1, y: 2 }, data };
    expect(fromDoc(toDoc({ id: "c", name: "画布" }, [node], [])).nodes[0].data).toEqual(data);
    expect(readCard({ ...old, assetId: "person-1" })).toMatchObject({ assetId: "person-1" });
  });
  it("多单先失败再成功仍保留失败原话与被拦序号", () => {
    const card = { ...newVideoCard("generate", 1), jobs: ["bad", "good"] };
    const base: JobView = { id: "bad", status: "failed", createdAt: "", count: 1, works: [], error: "参考被拦原话", blocked: [2] };
    const failed = absorbJob(card, base);
    const settled = absorbJob(failed, { ...base, id: "good", status: "succeeded", works: ["w"], error: null, blocked: [] });
    expect(settled.note).toBe("参考被拦原话");
    expect(settled.blocked).toEqual([2]);
    expect(settled.results[0].id).toBe("w");
  });
});

describe("视频连线、菜单与引用", () => {
  const base = { edges: [], source: "a", target: "b", targetSource: "generate" as const };
  it("图片卡拒绝视频，视频卡接两种素材", () => {
    expect(checkLink({ ...base, sourceKind: "video", targetKind: "image" })).toEqual({ ok: false, reason: "出图不能拿视频当参考，连到视频卡上。" });
    expect(checkLink({ ...base, sourceKind: "video", targetKind: "video" })).toEqual({ ok: true });
    expect(checkLink({ ...base, sourceKind: "image", targetKind: "video" })).toEqual({ ok: true });
  });
  it("菜单有视频动作，上游视频时图片灰掉", () => {
    const action = () => {};
    const commands = { image: action, video: action, upload: action, work: action };
    expect(addMenuItems("blank", commands)[2]).toMatchObject({ label: "视频", onSelect: action });
    expect(addMenuItems("downstream", commands, "video")[1]).toMatchObject({ label: "图片", disabled: true });
  });
  it("按媒体各数各的，插入视频引用", () => {
    expect(numberMediaRefs([{ media: "video" }, {}, { media: "video" }, {}])).toEqual([
      { media: "video", number: 1 }, { media: "image", number: 1 }, { media: "video", number: 2 }, { media: "image", number: 2 }
    ]);
    expect(insertMention("前@后", 1, 2, "video")).toEqual({ text: "前@视频2 后", caret: 6 });
  });
});

describe("视频提示词", () => {
  it("只转图片token，不加图片总数说明", () => {
    expect(toVideoPrompt("  @图片2 参考 @视频1  ", 2, 1)).toBe("@图像2 参考 @视频1");
    expect(toVideoPrompt("天空", 0, 0)).toBe("天空");
  });
  it("空词和不存在的两类引用给人话", () => {
    expect(() => toVideoPrompt(" ", 0, 0)).toThrow("先写一句你想要什么。");
    expect(() => toVideoPrompt("@视频2", 1, 1)).toThrow("只连了 1 段参考视频");
    expect(() => toVideoPrompt("@图片1", 0, 0)).toThrow("还没连参考图");
    expect(() => toVideoPrompt("@视频0", 0, 1)).toThrow("@视频0");
  });
});

describe("视频面板纯逻辑", () => {
  const settings = { ...DEFAULT_VIDEO_SETTINGS, count: 2 as const };
  it("摘要含Auto、大写P、时长和数量", () => {
    expect(videoSummary(settings)).toBe("16:9 · 480P · 5s · 2个");
    expect(videoSummary({ ...settings, ratio: "adaptive", count: 4 })).toBe("Auto · 480P · 5s · 4个");
  });
  it("估价乘数量且保留原note，参考视频秒数参与", () => {
    const estimate = estimateVideo({ ...settings, refVideoSeconds: 3 });
    expect(videoEstimate(settings, [{ type: "work", id: "v", media: "video", seconds: 3 }])).toEqual({ ...estimate, yuan: estimate.yuan * 2 });
  });
  it("发送前检查首帧与TOS，假模式无需TOS", () => {
    const refs = [{ type: "work" as const, id: "v", media: "video" as const, seconds: 3 }];
    expect(videoProblems(settings, refs, { fake: false, tosReady: false })).toContain("参考视频要先传到火山存储：.env.local 里还没填 TOS_ACCESS_KEY_ID、TOS_SECRET_ACCESS_KEY、TOS_BUCKET，填好不用重启。");
    expect(videoProblems(settings, refs, { fake: true, tosReady: false })).toEqual([]);
    expect(videoProblems({ ...settings, mode: "first_frame" }, refs, { fake: true, tosReady: true })).toContain("首帧模式不能带视频。");
  });
  it("素材编号严格限制，比例及阶段文案", () => {
    expect(validAssetId("person_1.A-b")).toBe(true);
    for (const bad of ["", "a b", "a/1", "a".repeat(129)]) expect(validAssetId(bad)).toBe(false);
    expect(videoAspect(settings)).toBe("16 / 9");
    expect(videoAspect({ ...settings, ratio: "adaptive" })).toBe("16 / 9");
    expect(phaseLabel("uploading")).toBe("传参考视频…");
    expect(phaseLabel(undefined)).toBe("排队中");
    expect(phaseLabel("submitting")).toBe("提交中…");
    expect(phaseLabel("waiting")).toBe("正在生成中…");
    expect(phaseLabel("downloading")).toBe("下载中…");
    expect(durationLabel(65)).toBe("1:05");
  });
});
