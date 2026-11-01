import { describe, expect, it } from "vitest";
import { newCard } from "./cards";
import { emptyHistory, recordHistory, undoHistory, redoHistory, sameStructure, observeHistory, type Graph } from "./history";

const graph = (x = 0, prompt = "旧内容"): Graph => ({ nodes: [{ id: "a", type: "card", position: { x, y: 0 }, data: { ...newCard("generate", 1), prompt } }], edges: [] });
const blank: Graph = { nodes: [], edges: [] };

describe("history", () => {
  it("读取不入栈，拖动中不入栈，松手才记一步，最新文字在删除前进入快照", () => {
    let frame = observeHistory({ history: emptyHistory(), baseline: null }, graph());
    frame = observeHistory(frame, { ...graph(20, "拖动时编辑"), nodes: graph(20, "拖动时编辑").nodes.map(n => ({ ...n, dragging: true })) });
    expect(frame.history.past).toHaveLength(0);
    frame = observeHistory(frame, graph(100, "拖动时编辑"));
    expect(frame.history.past).toHaveLength(1);
    expect(undoHistory(frame.history, graph(100)).graph.nodes[0].position.x).toBe(0);
    frame = observeHistory(frame, graph(100, "删除前最后改字"));
    frame = observeHistory(frame, blank);
    expect(undoHistory(frame.history, blank).graph.nodes[0].data.prompt).toBe("删除前最后改字");
  });
  it("压栈、撤销、重做卡片和位置", () => {
    const h = recordHistory(emptyHistory(), blank, graph());
    const undone = undoHistory(h, graph());
    expect(undone.graph).toEqual(blank);
    expect(undone.history.past).toHaveLength(0);
    expect(redoHistory(undone.history, blank).graph.nodes[0].id).toBe("a");
    const moved = recordHistory(h, graph(), graph(100));
    expect(undoHistory(moved, graph(100)).graph.nodes[0].position.x).toBe(0);
  });
  it("新操作清空重做栈；空栈不动", () => {
    const undone = undoHistory(recordHistory(emptyHistory(), blank, graph()), graph());
    expect(recordHistory(undone.history, blank, graph(9)).future).toEqual([]);
    expect(undoHistory(emptyHistory(), graph()).graph).toEqual(graph());
    expect(redoHistory(emptyHistory(), graph()).graph).toEqual(graph());
  });
  it("最多50步", () => {
    let h = emptyHistory();
    for (let i = 0; i < 55; i++) h = recordHistory(h, graph(i), graph(i + 1));
    expect(h.past).toHaveLength(50);
    expect(h.past[0].before.nodes[0].position.x).toBe(5);
  });
  it("还在的卡保留现在全部内容，撤销重做都不回退进度", () => {
    const h = recordHistory(emptyHistory(), graph(), graph(100));
    const now = graph(100, "新内容");
    now.nodes[0].data.jobs = ["running"];
    now.nodes[0].data.results = [{ type: "work", id: "done" }];
    const undone = undoHistory(h, now);
    expect(undone.graph.nodes[0].data).toEqual(now.nodes[0].data);
    undone.graph.nodes[0].data = { ...now.nodes[0].data, prompt: "再改" };
    expect(redoHistory(undone.history, undone.graph).graph.nodes[0].data.prompt).toBe("再改");
  });
  it("还在的卡也保留当前选择和测量，撤销只改位置和拓扑", () => {
    const before = graph();
    before.nodes[0].selected = false;
    const now = graph(100);
    now.nodes[0].selected = true;
    now.nodes[0].measured = { width: 280, height: 420 };
    const back = undoHistory(recordHistory(emptyHistory(), before, now), now).graph.nodes[0];
    expect(back.selected).toBe(true);
    expect(back.measured).toEqual(now.nodes[0].measured);
    expect(back.position).toEqual(before.nodes[0].position);
  });
  it("删卡/清空撤回使用删除时的内容和连线", () => {
    const before = graph(10, "删除前改过");
    before.nodes.push({ ...graph().nodes[0], id: "b" });
    before.edges = [{ id: "e", source: "a", target: "b" }];
    const restored = undoHistory(recordHistory(emptyHistory(), before, blank), blank).graph;
    expect(restored).toEqual(before);
  });
  it("连线/断线记步；内容和选择不记步", () => {
    const linked = { ...graph(), edges: [{ id: "e", source: "a", target: "b" }] };
    expect(sameStructure(graph(), graph(0, "改字"))).toBe(true);
    expect(sameStructure(graph(), { ...graph(), nodes: [{ ...graph().nodes[0], selected: true }] })).toBe(true);
    const h = recordHistory(emptyHistory(), graph(), linked);
    expect(undoHistory(h, linked).graph.edges).toEqual([]);
    expect(recordHistory(emptyHistory(), graph(), graph(0, "改字")).past).toHaveLength(0);
  });
  it("现存连线保留当前选择状态，不回退快照的临时选择", () => {
    const before = { ...graph(), edges: [{ id: "e", source: "a", target: "b", selected: true }] };
    const current = { ...graph(100), edges: [{ ...before.edges[0], selected: false }] };
    const back = undoHistory(recordHistory(emptyHistory(), before, current), current).graph;
    expect(back.edges[0].selected).toBe(false);
  });
});
