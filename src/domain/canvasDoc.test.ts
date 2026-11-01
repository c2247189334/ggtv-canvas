import { describe, expect, it } from "vitest";
import { fromDoc, readCard, toDoc } from "./canvasDoc";
import { cardTitle, newCard, newVideoCard } from "./cards";
import { FLASH_MODEL, LITE_MODEL } from "./pricing";
import type { CanvasDoc, CardNode } from "@/types";

const node = (id: string, x: number, data = newCard("generate", 1)): CardNode => ({ id, type: "card", position: { x, y: 0 }, data });

describe("canvasDoc", () => {
  it("文件名标题与未占号标记经过JSON存档重开保持不变，老上传卡保留标题和号", () => {
    const data = [
      { ...newCard("upload", 0), title: "测试 猫.png" },
      { ...newVideoCard("upload", 0), title: "source_10s.mp4" },
      newCard("upload", 13), newVideoCard("upload", 19)
    ];
    const nodes: CardNode[] = data.map((data, index) => ({ id: String(index), type: "card", position: { x: index * 300, y: 0 }, data }));
    const saved = toDoc({ id: "c", name: "x" }, nodes, []);
    const back = fromDoc(JSON.parse(JSON.stringify(saved)) as CanvasDoc);
    expect(back.nodes.map(node => node.data)).toEqual(data);
    expect(back.nodes.map(node => cardTitle(node.data))).toEqual(["测试 猫.png", "source_10s.mp4", "图片 13 · 传的图", "视频 19 · 传的视频"]);
    expect(readCard({ ...data[0], title: undefined })?.number).toBe(1);
  });
  it("旧档补分辨率、清理已删除比例和模型不支持的选项", () => {
    for (const [model, aspect, resolution] of [[FLASH_MODEL, "5:4", undefined], [LITE_MODEL, "21:9", "1K"], [FLASH_MODEL, "4:5", "3K"]]) {
      expect(readCard({ source: "generate", gen: { model, aspect, resolution, count: 3, sizeFrom: 2 } })?.gen)
        .toEqual({ model, aspect: "16:9", resolution: "2K", count: 3, sizeFrom: 2 });
    }
  });
  it("副本标题存盘重开保留；旧档1:1和3张仍能读", () => {
    const data = { ...newCard("generate", 1), title: "图片 1 - 副本" };
    data.gen = { ...data.gen, aspect: "1:1", count: 3 };
    const back = fromDoc(toDoc({ id: "c", name: "x" }, [node("a", 0, data)], []));
    expect(back.nodes[0].data).toEqual(data);
    expect(readCard({ ...data, title: undefined })?.title).toBeUndefined();
  });
  it("存了再读回来一样；选中这类临时状态不存", () => {
    const nodes = [{ ...node("a", 10.4), selected: true }, node("b", 300, newCard("upload", 2, [{ type: "upload", id: "u" }]))];
    const edges = [{ id: "link:b>a", source: "b", target: "a" }];
    const doc = toDoc({ id: "c1", name: "画布 1" }, nodes, edges);
    expect(doc.nodes[0]).toEqual({ id: "a", x: 10, y: 0, data: nodes[0].data });
    expect(JSON.stringify(doc)).not.toContain("selected");
    const back = fromDoc(doc);
    expect(back.meta).toEqual({ id: "c1", name: "画布 1" });
    expect(back.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(back.edges).toEqual(edges);
  });

  it("读坏的卡片丢掉，连着它的线也丢掉", () => {
    const doc = {
      id: "c1",
      name: "x",
      nodes: [{ id: "a", x: 0, y: 0, data: newCard("generate", 1) }, { id: "bad", x: 0, y: 0, data: { source: "???" } }],
      edges: [{ id: "e", source: "bad", target: "a" }]
    } as unknown as CanvasDoc;
    const back = fromDoc(doc);
    expect(back.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(back.edges).toEqual([]);
  });

  it("编号不存盘：存档不写计数器，旧档里的计数器读的时候丢掉", () => {
    const doc = toDoc({ id: "c", name: "x" }, [node("a", 0, newCard("generate", 7))], []);
    expect(doc).not.toHaveProperty("nextNumber");
    expect(doc).not.toHaveProperty("nextNumbers");
    const old = { ...doc, nextNumber: 9, nextNumbers: { image: 3, video: 9, audio: 4 } } as CanvasDoc;
    expect(fromDoc(old).meta).toEqual({ id: "c", name: "x" });
    expect(fromDoc(old).nodes[0].data.number).toBe(7);
  });

  it("卡片设置读坏了用默认值；翻页夹回范围内", () => {
    const card = readCard({ source: "generate", number: 2, results: [{ type: "work", id: "w" }], page: 9, gen: { model: "x", count: 99 } });
    expect(card?.kind).toBe("image");
    expect(card?.gen?.model).toBe("doubao-seedream-5-0-flash-260915");
    expect(card?.gen?.count).toBe(1);
    expect(card?.page).toBe(0);
    expect(readCard(null)).toBeNull();
  });
});
