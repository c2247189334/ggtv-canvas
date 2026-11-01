import { describe, expect, it } from "vitest";
import { absorbJobViews } from "./jobResults";
import { newCard, newVideoCard } from "./cards";
import type { CardNode, JobView } from "@/types";

const node = (id: string, data: CardNode["data"]): CardNode => ({ id, type: "card", position: { x: 0, y: 0 }, data });
const job: JobView = { id: "j", kind: "video", status: "failed", createdAt: "", count: 1, works: [], error: "参考 2 被火山拦下：原话", blocked: [2] };
const nodes = [
  node("image", newCard("upload", 4)),
  node("video", newVideoCard("upload", 3)),
  node("target", { ...newVideoCard("generate", 5), jobs: ["j"] })
];
const edges = [{ source: "video", target: "target" }, { source: "image", target: "target" }];

describe("收单时对齐被拦参考称呼", () => {
  it("使用连线顺序而非节点顺序，保留红框原线序编号", () => {
    const next = absorbJobViews(nodes, edges, [job]);
    expect(next[2].data).toMatchObject({ note: "图片1 被火山拦下：原话", blocked: [2], jobs: [] });
    expect(next[0]).toBe(nodes[0]);
    expect(next[1]).toBe(nodes[1]);
  });
  it("图片卡继续保留小服务原话", () => {
    const target = node("target", { ...newCard("generate", 5), jobs: ["j"] });
    expect(absorbJobViews([...nodes.slice(0, 2), target], edges, [job])[2].data.note).toBe(job.error);
  });
  it("先失败再成功时保留已转换的原话和被拦编号", () => {
    const target = node("target", { ...newVideoCard("generate", 5), jobs: ["j", "good"] });
    const success = { ...job, id: "good", status: "succeeded" as const, works: ["w"], blocked: [], error: null };
    expect(absorbJobViews([...nodes.slice(0, 2), target], edges, [job, success])[2].data)
      .toMatchObject({ note: "图片1 被火山拦下：原话", blocked: [2], jobs: [] });
  });
});
