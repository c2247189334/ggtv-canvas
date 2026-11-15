import { expect, it } from "vitest";
import { fromDoc, readCard } from "./canvasDoc";
import type { CanvasDoc } from "@/types";

// 11-15 本地跑（本机 H3）挪去本地版：旧画布视频卡上的 localRun 字段照常能打开，读的时候丢掉，卡和连线都还在。
it("旧档视频卡带本地跑字段：照常读出来，本地跑字段丢掉，卡、连线、提示词不受影响", () => {
  const video = { kind: "video", source: "generate", number: 2, prompt: "鞋子走路", results: [], resultIndex: 0,
    video: { model: "doubao-seedance-2-0-260128", mode: "reference", ratio: "9:16", resolution: "480p", duration: 5, audio: false, count: 1 },
    localRun: { prompt: "本地词", sound: "source", jobId: "job-1", status: "running", collapsed: true, warnings: ["旧提醒"] } };
  const card = readCard(video) as Record<string, unknown> | null;
  expect(card).not.toBeNull();
  expect(card!.prompt).toBe("鞋子走路");
  expect(Object.hasOwn(card!, "localRun")).toBe(false);
  const doc = { id: "c", name: "旧画布", nodes: [{ id: "a", x: 0, y: 0, data: { kind: "image", source: "generate", number: 1, prompt: "", results: [], resultIndex: 0 } },
    { id: "b", x: 300, y: 0, data: video }], edges: [{ source: "a", target: "b" }] } as unknown as CanvasDoc;
  const back = fromDoc(doc);
  expect(back.nodes.map(node => node.id)).toEqual(["a", "b"]);
  expect(back.nodes.every(node => !node.hidden)).toBe(true);
  expect(back.edges).toHaveLength(1);
  expect(Object.hasOwn(back.nodes[1].data, "localRun")).toBe(false);
});
