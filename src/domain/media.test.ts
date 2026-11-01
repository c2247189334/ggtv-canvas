import { describe, expect, it } from "vitest";
import { uploadKind, workRef, readWorkDrag, IMAGE_ACCEPT, MEDIA_ACCEPT } from "./media";
import { collectSendRefs, patchCard } from "./sendRefs";
import { submitVideoBatch } from "./videoSend";
import { newCard, newVideoCard } from "./cards";
import { emptyHistory, observeHistory, undoHistory, redoHistory, type Graph } from "./history";
import { pasteClipboard } from "./clipboard";
import { selectionLink } from "./selection";
import { dropLinkHint } from "./refs";
import type { CardNode, VideoJobRequest, WorkView } from "@/types";

const node = (id: string, data = newCard("upload", 1)): CardNode => ({ id, data, type: "card", position: { x: 0, y: 0 } });
const work: WorkView = { id: "w", kind: "video", createdAt: "", canvasId: null, prompt: "", model: "", yuan: 0, duration: 5, width: 640, height: 360 };

describe("媒体输入", () => {
  it("MIME缺失按mp4/mov扩展补，不压缩视频", () => {
    expect(uploadKind({ name: "a.MP4", type: "", size: 60 * 1024 * 1024 }, true)).toEqual({ kind: "video", mime: "video/mp4" });
    expect(uploadKind({ name: "b.mov", type: "", size: 1 }, true)).toEqual({ kind: "video", mime: "video/quicktime" });
    expect(uploadKind({ name: "x.png", type: "image/png", size: 1 }, false)).toEqual({ kind: "image", mime: "image/png" });
    expect(IMAGE_ACCEPT).not.toContain("video");
    expect(MEDIA_ACCEPT).toContain(".mov");
  });
  it("视频允许到1.5G，超限提示写清大小和时长；图片入口拒视频", () => {
    expect(uploadKind({ name: "v.mp4", type: "video/mp4", size: 1610612736 }, true).kind).toBe("video");
    expect(() => uploadKind({ name: "v.mp4", type: "video/mp4", size: 1610612737 }, true)).toThrow("请上传小于 1.5G 且时长在 15 分钟以内的视频。");
    expect(() => uploadKind({ name: "v.mp4", type: "video/mp4", size: 1 }, false)).toThrow("只收");
  });
  it("作品拖入保留视频元数据，兼容旧的仅编号拖入", () => {
    expect(workRef(work)).toEqual({ type: "work", id: "w", media: "video", seconds: 5, width: 640, height: 360 });
    expect(readWorkDrag(JSON.stringify(work))).toEqual(workRef(work));
    expect(readWorkDrag("old-id")).toEqual({ type: "work", id: "old-id" });
    expect(readWorkDrag('{"id":4}')).toBeNull();
  });
  it('白模作品经过选择或拖入仍保留白模标记', () => {
    expect(workRef({ ...work, mesh: true })).toMatchObject({ mesh: true });
    expect(readWorkDrag(JSON.stringify({ ...work, mesh: true }))).toMatchObject({ mesh: true });
  });
});

describe("参考与安全更新", () => {
  it("按连线顺序取当前翻页，只对视频单带asset", () => {
    const a = node("a", { ...newCard("upload", 1, [{ type: "upload", id: "u1" }, { type: "upload", id: "u2" }]), page: 1, assetId: "person.1" });
    const b: CardNode = { ...node("b"), data: newVideoCard("work", 2, [workRef(work)]) };
    const edges = [{ source: "b", target: "g" }, { source: "a", target: "g" }];
    expect(collectSendRefs([a, b], edges, "g", "video")).toEqual([workRef(work), { type: "upload", id: "u2", asset: "person.1" }]);
    expect(collectSendRefs([a], [{ source: "a", target: "g" }], "g", "image")).toEqual([{ type: "upload", id: "u2" }]);
    expect(() => collectSendRefs([a, b], edges, "g", "image")).toThrow("出图不能拿视频当参考");
    expect(() => collectSendRefs([a], edges, "g", "video")).toThrow("还没有结果");
    expect(() => collectSendRefs([b], [{ source: "b", target: "g" }], "g", "video", () => true)).toThrow("作品已经删了");
  });
  it("补丁不会把图片和视频设置串在一起，生成图不能填asset", () => {
    const image = newCard("upload", 1);
    const video = newVideoCard("generate", 2);
    expect(patchCard(video, { gen: image.gen })).toEqual(video);
    expect(patchCard(image, { video: video.video })).toEqual(image);
    expect(patchCard(image, { assetId: "person" }).assetId).toBe("person");
    expect(patchCard(newCard("generate", 3), { assetId: "person" }).assetId).toBeUndefined();
  });
  it("快捷键连线与拖线失败提示也执行媒体限制", () => {
    const a: CardNode = { ...node("a"), data: newVideoCard("work", 1, [workRef(work)]) };
    const image = node("image", newCard("generate", 2));
    const video: CardNode = { ...node("video"), data: newVideoCard("generate", 3) };
    expect(selectionLink(["a", "image"], [a, image], []).message).toBe("出图不能拿视频当参考，连到视频卡上。");
    expect(selectionLink(["a", "video"], [a, video], []).edge).toMatchObject({ source: "a", target: "video" });
    expect(dropLinkHint({ edges: [], source: "a", target: "image", targetSource: "generate", sourceKind: "video", targetKind: "image" })).toBe("出图不能拿视频当参考，连到视频卡上。");
  });
});

describe("视频依次交单", () => {
  it("页面交单前拦2.0/2.5参考时长边界、2.0段数和总秒数，不发送请求", async () => {
    const submit = async () => { throw new Error("不该发送请求"); };
    const base = { canvasId: "c", cardId: "g", health: { fake: true, tosReady: false }, submit, clear() {}, submitted() {} };
    for (const [model, max] of [["doubao-seedance-2-0-mini-260615", 15], ["doubao-seedance-2-5-260628", 30]] as const) {
      for (const seconds of [1.99, max + 0.01]) {
        const card = newVideoCard("generate", 1);
        card.prompt = "天空"; card.video.model = model;
        await expect(submitVideoBatch({ ...base, card, refs: [{ ...workRef(work), seconds }] })).rejects.toThrow(new RegExp(`2 到 ${max} 秒`));
      }
    }
    const card = { ...newVideoCard("generate", 1), prompt: "天空" };
    await expect(submitVideoBatch({ ...base, card, refs: Array(4).fill(workRef(work)) })).rejects.toThrow("最多 3 段");
    await expect(submitVideoBatch({ ...base, card, refs: Array(3).fill({ ...workRef(work), seconds: 6 }) })).rejects.toThrow("加起来不能超 15 秒");
  });
  it("每单立即记号，中途拒单保留前单，发送前清被拦标记", async () => {
    const card = { ...newVideoCard("generate", 1), prompt: "@图片1 随 @视频1", video: { ...newVideoCard("generate", 1).video, count: 4 as const }, blocked: [2] };
    const requests: VideoJobRequest[] = [];
    const ids: string[] = [];
    let cleared = false;
    const promise = submitVideoBatch({ card, canvasId: "c", cardId: "g", refs: [{ type: "upload", id: "a", asset: "p" }, workRef(work)], health: { fake: true, tosReady: false },
      clear: () => { cleared = true; }, submitted: id => ids.push(id), submit: async request => {
        expect(cleared).toBe(true);
        requests.push(request);
        if (requests.length === 3) throw new Error("第三单被拒");
        return { id: `j${requests.length}` };
      } });
    await expect(promise).rejects.toThrow("第三单被拒");
    expect(ids).toEqual(["j1", "j2"]);
    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({ prompt: "@图像1 随 @视频1", refs: [{ type: "upload", id: "a", asset: "p" }, { type: "work", id: "w" }] });
    expect(requests[0]).not.toHaveProperty("count");
  });
  it("TOS或提示词不合格不会交任何单", async () => {
    let calls = 0;
    const args = { card: { ...newVideoCard("generate", 1), prompt: "天空" }, canvasId: "c", cardId: "g", refs: [workRef(work)], health: { fake: false, tosReady: false }, clear: () => {}, submitted: () => {}, submit: async () => { calls++; return { id: "j" }; } };
    await expect(submitVideoBatch(args)).rejects.toThrow("TOS_ACCESS_KEY_ID");
    await expect(submitVideoBatch({ ...args, refs: [], card: { ...args.card, prompt: " " } })).rejects.toThrow("先写一句");
    expect(calls).toBe(0);
  });
});

describe("真人素材撤销与副本", () => {
  it("填/改/清除都记步，撤销编号保留最新提示词及结果，重做恢复", () => {
    const before: Graph = { nodes: [node("a")], edges: [] };
    let frame = observeHistory({ history: emptyHistory(), baseline: null }, before);
    const after: Graph = { ...before, nodes: [node("a", { ...newCard("upload", 1), assetId: "person" })] };
    frame = observeHistory(frame, after);
    expect(frame.history.past).toHaveLength(1);
    const now: Graph = { ...after, nodes: after.nodes.map(n => ({ ...n, data: { ...n.data, prompt: "最新", jobs: ["j"] } })) };
    const undone = undoHistory(frame.history, now);
    expect(undone.graph.nodes[0].data.assetId).toBeUndefined();
    expect(undone.graph.nodes[0].data.prompt).toBe("最新");
    expect(undone.graph.nodes[0].data.jobs).toEqual(["j"]);
    expect(redoHistory(undone.history, undone.graph).graph.nodes[0].data.assetId).toBe("person");
    const copy = pasteClipboard({ nodes: after.nodes, edges: [] }, null, () => "copy");
    expect(copy.nodes[0].data.assetId).toBe("person");
  });
  it("改编号和清除编号各占一步，都能撤销重做", () => {
    const graph = (assetId?: string): Graph => ({ nodes: [node("a", { ...newCard("work", 1), ...(assetId ? { assetId } : {}) })], edges: [] });
    let frame = observeHistory({ history: emptyHistory(), baseline: null }, graph("one"));
    frame = observeHistory(frame, graph("two"));
    frame = observeHistory(frame, graph());
    expect(frame.history.past).toHaveLength(2);
    const back = undoHistory(frame.history, graph());
    expect(back.graph.nodes[0].data.assetId).toBe("two");
    expect(undoHistory(back.history, back.graph).graph.nodes[0].data.assetId).toBe("one");
    expect(redoHistory(back.history, back.graph).graph.nodes[0].data.assetId).toBeUndefined();
  });
});
