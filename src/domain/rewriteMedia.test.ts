import { expect, it } from "vitest";
import { localChild } from "./localMedia";
import { newVideoCard, newAudioCard } from "./cards";
import { startVideoRewrite } from "./videoRewrite";
import { retryRewriteMedia } from "./rewriteMedia";
import { fromDoc, toDoc } from "./canvasDoc";
import type { CardNode } from "@/types";
const a = { type: "upload" as const, id: "A", media: "video" as const, seconds: 6, hasAudio: true };
const b = { ...a, id: "B" };
const source: CardNode = { id: "source", type: "card", position: { x: 0, y: 0 }, data: newVideoCard("generate", 1, [a, b]) };
it("深度和原声保存各自来源，翻到B页不会拿A的衍生卡当B复用", () => {
  const depth = localChild(source, "depth", 2, "depthA", "time");
  const audio = localChild(source, "audio", 3, "audioA", "time");
  expect(depth.node.data).toMatchObject({ mediaSource: a }); expect(audio.node.data).toMatchObject({ mediaSource: a });
  const flipped = { ...source, data: { ...source.data, page: 1 } };
  const graph = { nodes: [flipped, depth.node, audio.node], edges: [depth.edge, audio.edge] };
  let serial = 0;
  const created = startVideoRewrite({ ...graph, source: flipped, userText: '换人', takeNumber: () => 5, makeId: () => `new-${++serial}` });
  expect(created.depthId).not.toBe("depthA");
  expect(created.nodes.find(n => n.id === created.depthId)?.data).toMatchObject({ mediaSource: b });
  expect(fromDoc(toDoc({ id: "c", name: "n" }, created.nodes, created.edges)).nodes.find(n => n.id === "depthA")?.data)
    .toMatchObject({ mediaSource: a });
});
it("未知来源的旧衍生卡，不能靠多结果上游的当前页猜；单结果旧卡仍能复用", () => {
  const depth: CardNode = { id: "d", type: "card", position: { x: 0, y: 500 }, data: newVideoCard("depth", 2) };
  const args = { source, userText: '换人', nodes: [source, depth], edges: [{ id: "sd", source: "source", target: "d" }], takeNumber: () => 4, makeId: () => crypto.randomUUID() };
  expect(startVideoRewrite(args).depthId).not.toBe("d");
  const single = { ...source, data: newVideoCard("upload", 1, [a]) };
  expect(startVideoRewrite({ ...args, source: single, nodes: [single, depth] }).depthId).toBe("d");
});
it("只在用户重试时挑选已经失败且没有任务/结果的深度卡；原声卡改写不再用", () => {
  const data = { ...newVideoCard("depth", 1), note: "ffmpeg没找到" };
  expect(retryRewriteMedia(data)).toBe(true);
  expect(retryRewriteMedia({ ...data, startedAt: "running" })).toBe(false);
  expect(retryRewriteMedia({ ...data, results: [{ type: "work", id: "ok", media: "video" }] })).toBe(false);
  expect(retryRewriteMedia({ ...data, depthJobId: "pending" })).toBe(false);
  expect(retryRewriteMedia(newVideoCard("depth", 2))).toBe(false);
  expect(retryRewriteMedia({ ...newAudioCard("extracted", 3), note: "ffmpeg没找到" })).toBe(false);
});
