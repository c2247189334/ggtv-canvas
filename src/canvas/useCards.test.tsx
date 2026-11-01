import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Edge } from "@xyflow/react";
import type { CardNode } from "@/types";
import { cardCounter, cardTitle, newCard } from "@/domain/cards";
import { collectSendRefs } from "@/domain/sendRefs";
import { insertMention, numberMediaRefs } from "@/domain/mention";
import { pickFiles } from "@/common/pickFiles";
import { api } from "@/api";
import { useCards } from "./useCards";

const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[] }));
vi.mock("@xyflow/react", () => ({ useReactFlow: () => ({
  getNodes: () => graph.nodes, getEdges: () => graph.edges,
  getNode: (id: string) => graph.nodes.find(node => node.id === id)
}) }));
vi.mock("@/common/pickFiles", () => ({ pickFiles: vi.fn() }));
vi.mock("@/api", () => ({ api: { upload: vi.fn() } }));
vi.mock("@/domain/imagePrep", () => ({ prepareUpload: async () => new File(["small"], "renamed.jpg") }));
vi.mock("@/common/videoDuration", () => ({ videoDuration: async () => 2 }));

function setup() {
  graph.nodes = []; graph.edges = [];
  let uploads = 0;
  vi.mocked(api.upload).mockImplementation(async () => ({ id: `u-${++uploads}`, kind: "image" }));
  const notify = vi.fn();
  let cards!: ReturnType<typeof useCards>;
  function Harness() {
    cards = useCards({
      setNodes: update => { graph.nodes = update(graph.nodes); },
      setEdges: update => { graph.edges = update(graph.edges); },
      takeNumber: cardCounter(), notify, pickWork: async () => null, onBlankConnect: vi.fn()
    });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  return { cards, notify };
}
const file = (name: string) => new File([name], name, { type: name.endsWith("mp4") ? "video/mp4" : "image/png" });
const titles = () => graph.nodes.map(node => cardTitle(node.data));

describe("上传入口的标题和编号", () => {
  it("空白上传图片、拖入视频均用原文件名，后建图片1、视频2", async () => {
    const { cards } = setup();
    vi.mocked(pickFiles).mockResolvedValueOnce([file("测试 猫.png")]);
    await cards.uploadAt({ x: 0, y: 0 });
    cards.addGenerateCard({ x: 400, y: 0 });
    await cards.dropFiles([file("source_10s.mp4")], { x: 800, y: 0 });
    cards.addGenerateCard({ x: 1200, y: 0 }, "video");
    expect(titles()).toEqual(["测试 猫.png", "图片 1", "source_10s.mp4", "视频 2"]);
    expect(graph.nodes[2].data.kind).toBe("video");
    expect(graph.nodes[0].data.number).toBe(0);
    expect(graph.nodes[0].data.results[0]).not.toHaveProperty("fileName");
  });

  it.each(["image", "video"] as const)("%s生成卡左＋批量上传仍连线、保留顺序且不占号", async kind => {
    const { cards, notify } = setup();
    cards.addGenerateCard({ x: 800, y: 0 }, kind);
    const target = graph.nodes[0].id;
    vi.mocked(pickFiles).mockResolvedValueOnce([file("参考 甲.png"), file(kind === "video" ? "参考 乙.mp4" : "参考 乙.png")]);
    await cards.addReference(target, "upload");
    cards.addGenerateCard({ x: 1200, y: 0 });
    expect(titles()).toEqual([kind === "video" ? "视频 1" : "图片 1", "参考 甲.png", kind === "video" ? "参考 乙.mp4" : "参考 乙.png", "图片 2"]);
    expect(graph.edges.map(edge => [edge.source, edge.target])).toEqual(graph.nodes.slice(1, 3).map(node => [node.id, target]));
    const refs = collectSendRefs(graph.nodes, graph.edges, target, kind);
    expect(refs.map(ref => ref.media ?? "image")).toEqual(["image", kind]);
    expect(numberMediaRefs(refs).map(({ media, number }) => insertMention("@", 0, number, media)?.text))
      .toEqual(["@图片1 ", kind === "video" ? "@视频1 " : "@图片2 "]);
    graph.edges.reverse();
    expect(collectSendRefs(graph.nodes, graph.edges, target, kind)).toEqual([...refs].reverse());
    expect(notify).not.toHaveBeenCalled();
  });

  it("作品库仍占号；没有文件名的旧上传卡仍按原编号显示", () => {
    const { cards } = setup();
    cards.addAssets("work", [{ type: "work", id: "w" }], { x: 0, y: 0 });
    cards.addGenerateCard({ x: 400, y: 0 });
    expect(titles()).toEqual(["图片 1 · 作品库", "图片 2"]);
    expect(cardTitle(newCard("upload", 17))).toBe("图片 17 · 传的图");
  });
});
