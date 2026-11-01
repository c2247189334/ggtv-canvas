import { describe, expect, it } from "vitest";
import { newCard, cardTitle } from "./cards";
import { copySelection, pasteClipboard, resolvePasteAnchor, dragCopyPosition } from "./clipboard";
import { emptyHistory, observeHistory, undoHistory, redoHistory } from "./history";
import type { CardNode } from "@/types";

const node = (id: string, x: number, y: number, selected = true): CardNode => ({ id, type: "card", selected, position: { x, y }, data: { ...newCard("generate", 1), prompt: "照搬", jobs: ["busy"] } });
const edges = [{ id: "ab", source: "a", target: "b" }, { id: "bc", source: "b", target: "c" }];
const clip = () => copySelection([node("a", 30, 60), node("b", 400, 20), node("c", 0, 0, false)], edges);

describe("clipboard", () => {
  it("Alt拖动不足5屏幕像素不复制，越过后按缩放移动，回原点仍是拖动", () => {
    const start = { x: 100, y: 100 }, origin = { x: 30, y: 60 };
    expect(dragCopyPosition(start, { x: 102, y: 103 }, origin, 0.5, false)).toBeNull();
    expect(dragCopyPosition(start, { x: 103, y: 104 }, origin, 0.5, false)).toEqual({ x: 36, y: 68 });
    expect(dragCopyPosition(start, { x: 120, y: 80 }, origin, 2, true)).toEqual({ x: 40, y: 50 });
    expect(dragCopyPosition(start, start, origin, 1, true)).toEqual(origin);
  });
  it.each([false, true])("拖动副本（上游=%s）只在松手记一步，撤销重做包括连线", upstream => {
    const before = { nodes: [node("a", 0, 0, false), node("b", 100, 100)], edges: [edges[0]] };
    const copied = pasteClipboard(copySelection([before.nodes[1]], upstream ? before.edges : [], upstream), { x: 100, y: 100 }, () => "new");
    let frame = observeHistory({ history: emptyHistory(), baseline: null }, before);
    const moving = { nodes: [...before.nodes.map(n => ({ ...n, selected: false })), { ...copied.nodes[0], dragging: true }], edges: [...before.edges, ...copied.edges] };
    frame = observeHistory(frame, moving);
    expect(frame.history.past).toHaveLength(0);
    const after = { ...moving, nodes: moving.nodes.map(n => n.id === "new" ? { ...n, position: { x: 150, y: 200 }, dragging: false } : n) };
    frame = observeHistory(frame, after);
    expect(frame.history.past).toHaveLength(1);
    const undone = undoHistory(frame.history, after);
    expect(undone.graph.nodes.map(n => n.id)).toEqual(["a", "b"]);
    expect(undone.graph.edges).toEqual(before.edges);
    expect(redoHistory(undone.history, undone.graph).graph.nodes.find(n => n.id === "new")?.position).toEqual({ x: 150, y: 200 });
    expect(redoHistory(undone.history, undone.graph).graph.edges).toEqual(after.edges);
    expect(after.nodes.find(n => n.id === "b")?.position).toEqual({ x: 100, y: 100 });
  });
  it("创建副本带内部和外部上游连线，下游不复制，原图不变", () => {
    const nodes = [node("u", 0, 0, false), node("a", 30, 60), node("b", 400, 20), node("c", 800, 0, false)];
    const links = [{ id: "ua", source: "u", target: "a" }, ...edges];
    const snapshot = structuredClone({ nodes, links });
    let next = 0;
    const pasted = pasteClipboard(copySelection(nodes, links, true), null, () => `new${++next}`);
    expect(pasted.edges).toEqual([
      { id: "link:u>new1", source: "u", target: "new1" },
      { id: "link:new1>new2", source: "new1", target: "new2" }
    ]);
    expect(pasted.nodes.map(n => n.position)).toEqual([{ x: 70, y: 100 }, { x: 440, y: 60 }]);
    expect({ nodes, links }).toEqual(snapshot);
    expect(copySelection(nodes, links).edges.map(e => e.id)).toEqual(["ab"]);
  });
  it("单卡拖副本可选择不带线或只带上游，数据仍遵循粘贴规则", () => {
    const original = node("b", 100, 200);
    original.data.results = [{ type: "work", id: "image" }];
    for (const upstream of [false, true]) {
      const copied = copySelection([original], upstream ? edges : [], upstream);
      const pasted = pasteClipboard(copied, original.position, () => "new");
      expect(pasted.edges).toEqual(upstream ? [{ id: "link:a>new", source: "a", target: "new" }] : []);
      expect(pasted.nodes[0]).toMatchObject({ id: "new", position: original.position, selected: true,
        data: { title: "图片 1 - 副本", jobs: [], results: original.data.results, prompt: original.data.prompt } });
    }
    expect(original.data.jobs).toEqual(["busy"]);
  });
  it("粘贴时才用当前视口换算鼠标坐标；右键落点和副本偏移不受影响", () => {
    const screen = { x: 400, y: 300 };
    let viewport = { x: 0, y: 0, zoom: 1 };
    const project = (p: { x: number; y: number }) => ({ x: (p.x - viewport.x) / viewport.zoom, y: (p.y - viewport.y) / viewport.zoom });
    expect(resolvePasteAnchor(undefined, screen, project)).toEqual({ x: 400, y: 300 });
    viewport = { x: 100, y: 100, zoom: 2 };
    expect(resolvePasteAnchor(undefined, screen, project)).toEqual({ x: 150, y: 100 });
    expect(resolvePasteAnchor({ x: 5, y: 6 }, screen, project)).toEqual({ x: 5, y: 6 });
    expect(resolvePasteAnchor(null, screen, project)).toBeNull();
    expect(resolvePasteAnchor(undefined, null, project)).toBeNull();
  });
  it("只复制选择的卡和内部连线，深拷贝内容", () => {
    const nodes = [node("a", 0, 0), node("b", 10, 10), node("c", 0, 0, false)];
    const copied = copySelection(nodes, edges);
    expect(copied.nodes.map(n => n.id)).toEqual(["a", "b"]);
    expect(copied.edges.map(e => e.id)).toEqual(["ab"]);
    nodes[0].data.prompt = "后来改了";
    expect(copied.nodes[0].data.prompt).toBe("照搬");
  });
  it("新id、连线映射、整组左上角对齐鼠标", () => {
    let next = 0;
    const pasted = pasteClipboard(clip(), { x: 100, y: 200 }, () => `new${++next}`);
    expect(pasted.nodes.map(n => n.id)).toEqual(["new1", "new2"]);
    expect(pasted.nodes.map(n => n.position)).toEqual([{ x: 100, y: 240 }, { x: 470, y: 200 }]);
    expect(pasted.edges[0]).toMatchObject({ source: "new1", target: "new2" });
    expect(pasted.edges[0].id).not.toBe("ab");
    expect(pasted.nodes.every(n => n.selected)).toBe(true);
  });
  it("未知鼠标/创建副本右下40；标题后缀和内容保留、不带出图状态", () => {
    const pasted = pasteClipboard(clip(), null);
    expect(pasted.nodes[0].position).toEqual({ x: 70, y: 100 });
    expect(cardTitle(pasted.nodes[0].data)).toBe("图片 1 - 副本");
    expect(pasted.nodes[0].data.jobs).toEqual([]);
    expect(pasted.nodes[0].data.prompt).toBe("照搬");
    expect(pasted.nodes[0].data.gen).toEqual(clip().nodes[0].data.gen);
    expect(pasteClipboard({ nodes: [], edges: [] }, null).nodes).toEqual([]);
  });
});
