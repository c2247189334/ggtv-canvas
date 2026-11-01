import { describe, expect, it } from "vitest";
import { cardTitle, newCard, newVideoCard, newAudioCard, absorbJob } from "./cards";
import { readCard, toDoc } from "./canvasDoc";
import { checkLink, referenceLimitReached } from "./refs";
import { insertMention, numberMediaRefs } from "./mention";
import { addMenuItems } from "./menus";
import { workRef, readWorkDrag } from "./media";
import { collectSendRefs, patchCard } from "./sendRefs";
import { toVideoPrompt } from "./videoPrompt";
import { blockedReferenceMessage, videoProblems, videoEstimate } from "./videoPanel";
import { absorbJobViews } from "./jobResults";
import { copySelection, pasteClipboard } from "./clipboard";
import { DEFAULT_VIDEO_SETTINGS } from "./videoModels";
import { submitVideoBatch } from "./videoSend";
import { selectionLink } from "./selection";
import { emptyHistory, recordHistory, undoHistory } from "./history";
import type { AssetRef, CardData, CardNode } from "@/types";

const audio: AssetRef = { type: "work", id: "voice", media: "audio", seconds: 5 };
const node = (id: string, data: CardData): CardNode => ({ id, type: "card", data, position: { x: 0, y: 0 } });
const audioCard = (): CardData => ({ kind: "audio", source: "extracted", number: 1, results: [audio], page: 0, prompt: "", jobs: [], note: null });

describe("声音卡与参考", () => {
  it("声音、深度卡有独立标题且声音没有生成设置", () => {
    expect(cardTitle(audioCard())).toBe("音频 1 · 原声");
    expect(cardTitle({ ...audioCard(), source: "work" })).toBe("音频 1 · 作品库");
    expect(cardTitle({ ...newVideoCard("work", 3), source: "depth" })).toBe("视频 3 · 深度");
    expect(newAudioCard("extracted", 2, [audio])).toEqual({ kind: "audio", source: "extracted", number: 2,
      results: [audio], page: 0, prompt: "", jobs: [], note: null });
  });
  it("声音和深度任务完整存档，运行阶段不存", () => {
    const voice = { ...audioCard(), depthJobId: "depth-1", startedAt: "2026-10-22", phase: "waiting" as const };
    const depth = { ...newVideoCard("work", 2, [{ type: "work", id: "d", media: "video", seconds: 4,
      width: 864, height: 480, hasAudio: false, fps: 30, depth: true }]), source: "depth" as const,
      depthJobId: "depth-2", startedAt: "2026-10-22" };
    const doc = toDoc({ id: "c", name: "c" }, [node("a", voice), node("d", depth)], []);
    expect(doc.nodes[0].data).not.toHaveProperty("phase");
    expect(readCard(doc.nodes[0].data)).toEqual({ ...voice, phase: undefined });
    expect(readCard(doc.nodes[1].data)).toEqual(depth);
    expect(readCard({ ...voice, kind: "unknown" })).toBeNull();
  });
  it("声音不能用于出图，也不收上游参考", () => {
    expect(checkLink({ edges: [], source: "a", target: "i", sourceKind: "audio", targetKind: "image", targetSource: "generate" }))
      .toEqual({ ok: false, reason: "出图不能拿声音当参考" });
    expect(checkLink({ edges: [], source: "i", target: "a", sourceKind: "image", targetKind: "audio", targetSource: "extracted" }).ok).toBe(false);
    const commands = { image() {}, video() {}, upload() {}, work() {} };
    const menu = addMenuItems("downstream", commands, "audio");
    expect(menu.find(item => typeof item === "object" && "label" in item && item.label === "图片")).toMatchObject({ disabled: true });
    expect(menu.find(item => typeof item === "object" && "label" in item && item.label === "视频")).toMatchObject({ onSelect: commands.video });
  });
  it("三类引用分别编号并插入音频提及", () => {
    expect(numberMediaRefs([audio, {}, { media: "video" }, audio, {}])).toEqual([
      { media: "audio", number: 1 }, { media: "image", number: 1 }, { media: "video", number: 1 },
      { media: "audio", number: 2 }, { media: "image", number: 2 }
    ]);
    expect(insertMention("@", 0, 2, "audio")).toEqual({ text: "@音频2 ", caret: 5 });
  });
  it("作品引用和拖入保留声音及视频完整元数据", () => {
    expect(workRef({ id: "voice", kind: "audio", duration: 5 })).toEqual(audio);
    expect(readWorkDrag(JSON.stringify({ id: "voice", kind: "audio", duration: 5 }))).toEqual(audio);
    const video = { id: "v", kind: "video" as const, duration: 4, width: 864, height: 480, hasAudio: true, fps: 30, depth: false };
    expect(workRef(video)).toEqual({ type: "work", id: "v", media: "video", seconds: 4, width: 864, height: 480, hasAudio: true, fps: 30, depth: false });
  });
  it("发送参考安全保留声音类型，声音卡补丁不混入生成设置", () => {
    const voice = audioCard();
    const nodes = [node("a", voice), node("v", newVideoCard("generate", 1))];
    const edges = [{ source: "a", target: "v" }];
    expect(collectSendRefs(nodes, edges, "v", "video")).toEqual([audio]);
    expect(() => collectSendRefs(nodes, edges, "v", "image")).toThrow("出图不能拿声音当参考");
    const patched = patchCard(newAudioCard("work", 1, [audio]), { gen: newCard("generate", 1).gen, video: newVideoCard("generate", 1).video, assetId: "bad", prompt: "p" });
    expect(patched).toMatchObject({ kind: "audio", prompt: "p" });
    expect(patched).not.toHaveProperty("gen");
    expect(patched).not.toHaveProperty("video");
    expect(patched).not.toHaveProperty("assetId");
  });
  it("提示词检查音频越界并保留合法音频提及", () => {
    expect(() => toVideoPrompt("@音频2", 1, 1, 1)).toThrow("只连了 1 段参考音频");
    expect(() => toVideoPrompt("@音频0", 1, 1, 1)).toThrow("@音频0");
    expect(toVideoPrompt("@音频1 @图片1 @视频1", 1, 1, 1)).toBe("@音频1 @图像1 @视频1");
  });
  it("视频面板按声音数、时长和模型限制禁发，音频不计视频估价", () => {
    expect(videoProblems(DEFAULT_VIDEO_SETTINGS, [audio], { fake: false, tosReady: false }))
      .toEqual(["这个模型带音频时至少还要 1 张参考图或 1 段参考视频。"]);
    const model25 = { ...DEFAULT_VIDEO_SETTINGS, model: "doubao-seedance-2-5-260628" as const };
    expect(videoProblems(model25, [audio], { fake: false, tosReady: false })).toEqual([]);
    expect(videoProblems(model25, [{ ...audio, seconds: 31 }], null).join(" ")).toContain("@音频1");
    expect(videoProblems({ ...model25, mode: "first_frame" }, [{ type: "work", id: "i" }, audio], null)).toContain("首帧模式不能带音频。");
    const settings = { ...DEFAULT_VIDEO_SETTINGS, count: 1 as const };
    expect(videoEstimate(settings, [audio])).toEqual(videoEstimate(settings, []));
  });
  it("声音被拒按原连线定位，文案按声音独立编号", () => {
    expect(blockedReferenceMessage("参考 3 被拒", [3], ["audio", "image", "audio"])).toBe("音频2 被拒");
    const nodes = [node("a", audioCard()), node("i", newCard("work", 1, [{ type: "work", id: "i" }])),
      node("v", { ...newVideoCard("generate", 1), jobs: ["j"] })];
    const [,, target] = absorbJobViews(nodes, [{ source: "a", target: "v" }, { source: "i", target: "v" }],
      [{ id: "j", status: "failed", createdAt: "now", count: 1, works: [], blocked: [1], error: "参考 1 被拒" }]);
    expect(target.data.note).toBe("音频1 被拒");
    expect(target.data.blocked).toEqual([1]);
  });
  it("生成视频收单保留原声和帧率，声音卡不收生成单", () => {
    const job = { id: "j", status: "succeeded" as const, createdAt: "now", count: 1, works: ["v"], error: null,
      workMeta: [{ id: "v", duration: 5, width: 864, height: 480, hasAudio: true, fps: 30 }] };
    expect(absorbJob({ ...newVideoCard("generate", 1), jobs: ["j"] }, job).results[0]).toMatchObject({ hasAudio: true, fps: 30 });
    const voice = { ...audioCard(), jobs: ["j"] };
    expect(absorbJob(voice, job)).toBe(voice);
  });
  it("复制深度卡不会沿用正在执行的任务", () => {
    const depth = { ...newVideoCard("depth", 1), depthJobId: "depth-1", startedAt: "now", phase: "waiting" as const };
    const copy = pasteClipboard(copySelection([{ ...node("d", depth), selected: true }], []), null, () => "copy").nodes[0].data;
    expect(copy).not.toHaveProperty("depthJobId");
    expect(copy).not.toHaveProperty("startedAt");
    expect(copy).not.toHaveProperty("phase");
    expect(copy.source).toBe("depth");
  });
  it("视频交单按三类数量校验提示词并保留原连线顺序", async () => {
    const card = newVideoCard("generate", 1);
    card.video.model = "doubao-seedance-2-5-260628";
    card.prompt = "@音频1";
    const sent: unknown[] = [];
    await submitVideoBatch({ card, canvasId: "c", cardId: "v", refs: [audio], health: { fake: false, tosReady: false },
      submit: async request => { sent.push(request); return { id: "j" }; }, clear() {}, submitted() {} });
    expect(sent).toMatchObject([{ prompt: "@音频1", refs: [{ type: "work", id: "voice" }] }]);
    card.prompt = "@图片1";
    await expect(submitVideoBatch({ card, canvasId: "c", cardId: "v", refs: [audio], health: { fake: true, tosReady: false },
      submit: async () => { throw new Error("不该交单"); }, clear() {}, submitted() {} })).rejects.toThrow("还没连参考图");
  });
  it("选择连线沿用声音限制，撤销保留深度任务和声音结果", () => {
    const voice = node("a", audioCard());
    const video = node("v", { ...newVideoCard("depth", 1), depthJobId: "depth-1", startedAt: "now" });
    expect(selectionLink(["a", "i"], [voice, node("i", newCard("generate", 1))], []).message).toBe("出图不能拿声音当参考");
    expect(selectionLink(["a", "v"], [voice, node("v", newVideoCard("generate", 1))], []).edge).toMatchObject({ source: "a", target: "v" });
    const before = { nodes: [voice, video], edges: [] };
    const after = { nodes: [voice], edges: [] };
    const restored = undoHistory(recordHistory(emptyHistory(), before, after), after).graph;
    expect(restored.nodes.map(item => item.data)).toEqual([voice.data, video.data]);
  });
  it("声音独立于八个图视频上限，读档不丢第九个被拒索引", () => {
    const kinds = ["image", "image", "image", "image", "image", "image", "image", "image"] as const;
    const edges = kinds.map((_, i) => ({ id: String(i), source: String(i), target: "v" }));
    expect(checkLink({ source: "a", sourceKind: "audio", target: "v", targetKind: "video", targetSource: "generate", edges }).ok).toBe(true);
    expect(referenceLimitReached(kinds, "audio")).toBe(false);
    expect(referenceLimitReached(kinds, "image")).toBe(true);
    expect(referenceLimitReached([...kinds.slice(0, 7), "audio"], "video")).toBe(false);
    expect(checkLink({ source: "new", sourceKind: "image", target: "v", targetKind: "video", targetSource: "generate", edges,
      referenceKinds: [...kinds.slice(0, 7), "audio"] }).ok).toBe(true);
    expect(readCard({ ...newVideoCard("generate", 1), blocked: [1, 9, 11, 0, -1, 1.5] })?.blocked).toEqual([1, 9, 11]);
    const nodes = [...kinds.map((_, i) => node(String(i), newCard("work", i + 1))), node("a", audioCard()), node("v", newVideoCard("generate", 1))];
    expect(selectionLink(["a", "v"], nodes, edges).edge).not.toBeNull();
  });
});
