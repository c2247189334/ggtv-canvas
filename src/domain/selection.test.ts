import { describe, expect, it } from "vitest";
import { applyNodeChanges } from "@xyflow/react";
import { contextSelection, filterSelectionChanges, handleVisibility, boardKeyboardControls, overlaySelection, selectGraph, selectionOrder, selectionLink, refPickState } from "./selection";
import { newCard } from "./cards";
import { emptyHistory, observeHistory, undoHistory } from "./history";
const nodes = ["a", "b", "c"].map((id, index) => ({ id, type: "card" as const, position: { x: 0, y: 0 }, selected: index < 2, data: newCard("generate", index + 1) }));

describe("selection", () => {
  it("恰好两卡按先后连线，一次撤销移除该线", () => {
    const before = { nodes, edges: [] };
    const result = selectionLink(["b", "a"], nodes, []);
    expect(result).toEqual({ edge: { id: "link:b>a", source: "b", target: "a" }, message: "已连接2个节点" });
    const after = { nodes, edges: [result.edge!] };
    const frame = observeHistory(observeHistory({ history: emptyHistory(), baseline: null }, before), after);
    expect(frame.history.past).toHaveLength(1);
    expect(undoHistory(frame.history, after).graph.edges).toEqual([]);
    expect(selectionLink(["a", "b"], nodes, []).edge).toMatchObject({ source: "a", target: "b" });
  });
  it.each([{ ids: [] }, { ids: ["a"] }, { ids: ["a", "b", "c"] }])("选中数量不为2：$ids", ({ ids }) => {
    expect(selectionLink(ids, nodes, [])).toEqual({ edge: null, message: "不符合连线规则" });
  });
  it("重复、绕圈、上传卡及满8张均使用checkLink的人话", () => {
    const ab = { id: "ab", source: "a", target: "b" };
    expect(selectionLink(["a", "b"], nodes, [ab])).toEqual({ edge: null, message: "这两张卡已经连上了。" });
    expect(selectionLink(["b", "a"], nodes, [ab])).toEqual({ edge: null, message: "这样连会绕成一个圈。" });
    const upload = nodes.map(n => n.id === "b" ? { ...n, data: { ...n.data, source: "upload" as const } } : n);
    expect(selectionLink(["a", "b"], upload, []).message).toBe("传的图和作品库的图不收参考图，线要连进生成卡。");
    const full = Array.from({ length: 8 }, (_, i) => ({ id: `u${i}`, source: `u${i}`, target: "b" }));
    expect(selectionLink(["a", "b"], nodes, full)).toEqual({ edge: null, message: "一张卡最多连 8 张参考图。" });
  });
  it("选参考：空白/自己忽略，新卡本体连接，已有参考只在标签上断开", () => {
    const ab = [{ id: "ab", source: "a", target: "b" }];
    expect(refPickState("b", nodes[0], [])).toEqual({ label: "选择 图片 1", action: "connect" });
    expect(refPickState("b", nodes[0], ab)).toEqual({ label: "取消选择", action: "ignore" });
    expect(refPickState("b", nodes[0], ab, true)).toEqual({ label: "取消选择", action: "disconnect" });
    for (const candidate of [undefined, nodes[1]]) {
      expect(refPickState("b", candidate, ab)).toEqual({ label: null, action: "ignore" });
    }
    expect(refPickState(null, nodes[0], [])).toEqual({ label: null, action: "ignore" });
    expect(refPickState("b", { ...nodes[0], data: { ...nodes[0].data, title: "自定标题" } }, []).label).toBe("选择 自定标题");
  });
  it("选中顺序保留旧成员、移除取消项，新成员按nodes顺序追加", () => {
    expect(selectionOrder([], ["b"])).toEqual(["b"]);
    expect(selectionOrder(["b"], ["a", "b"])).toEqual(["b", "a"]);
    expect(selectionOrder(["b", "a"], ["a", "b", "c"])).toEqual(["b", "a", "c"]);
    expect(selectionOrder(["b", "a"], ["a", "c"])).toEqual(["a", "c"]);
    expect(selectionOrder(["b", "a"], [])).toEqual([]);
    expect(selectionOrder([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(selectionOrder(selectionOrder(["b", "a"], ["a"]), ["a", "b"])).toEqual(["a", "b"]);
  });
  it("从左接入点反向拖线时，其他卡的接出点可见可接", () => {
    expect(handleVisibility(false, true, true, "target").source).toBe(true);
    expect(handleVisibility(false, true, false, "target").source).toBe(true);
    expect(handleVisibility(false, false, false, "target").source).toBe(false);
  });
  it("Ctrl/Shift加选，再点已选卡不取消；保留拖动和测量变化", () => {
    const changes = [{ type: "select" as const, id: "a", selected: false }, { type: "select" as const, id: "c", selected: true }, { type: "position" as const, id: "a", position: { x: 1, y: 2 } }];
    const protectedChanges = filterSelectionChanges(changes, true);
    expect(applyNodeChanges(protectedChanges, nodes).filter(n => n.selected).map(n => n.id)).toEqual(["a", "b", "c"]);
    expect(protectedChanges).toContainEqual({ type: "select", id: "a", selected: true });
    expect(filterSelectionChanges(changes, false)).toEqual(changes);
  });
  it("右键已选多卡保留；右键未选卡变单选", () => {
    expect(contextSelection(nodes, "a")).toEqual(nodes);
    expect(contextSelection(nodes, "c").filter(n => n.selected).map(n => n.id)).toEqual(["c"]);
  });
  it("禁掉节点方向键移动、Tab焦点和库的删除键（改走统一快捷键）", () => {
    expect(boardKeyboardControls).toMatchObject({ disableKeyboardA11y: true, nodesFocusable: false, edgesFocusable: false, deleteKeyCode: null, selectionKeyCode: null, multiSelectionKeyCode: ["Control", "Shift"] });
  });
  it("多选覆盖层单击空白取消；Ctrl/Shift点框内其他卡加选", () => {
    expect(overlaySelection(nodes, null, false, false).some(n => n.selected)).toBe(false);
    expect(overlaySelection(nodes, "c", true, false).filter(n => n.selected).map(n => n.id)).toEqual(["a", "b", "c"]);
    expect(overlaySelection(nodes, "a", true, false).filter(n => n.selected).map(n => n.id)).toEqual(["a", "b"]);
    expect(overlaySelection(nodes, "c", false, false).filter(n => n.selected).map(n => n.id)).toEqual(["c"]);
  });
  it("覆盖层拖动不改单击选择，保留多选拖动", () => {
    expect(overlaySelection(nodes, null, false, true)).toBe(nodes);
    expect(overlaySelection(nodes, "c", true, true)).toBe(nodes);
  });
  it("单选/右键未选卡清旧连线选择，加选/右键已选卡/拖动保留", () => {
    const graph = { nodes, edges: [{ id: "ab", source: "a", target: "b", selected: true }] };
    for (const mode of ["replace", "context"] as const) {
      const next = selectGraph(graph, "c", mode);
      expect(next.nodes.filter(n => n.selected).map(n => n.id)).toEqual(["c"]);
      expect(next.edges[0].selected).toBe(false);
    }
    expect(selectGraph(graph, "c", "add").edges[0].selected).toBe(true);
    expect(selectGraph(graph, "a", "context")).toBe(graph);
    expect(selectGraph(graph, null, "drag")).toBe(graph);
    expect(selectGraph(graph, null, "replace").edges[0].selected).toBe(false);
  });
  it("未选中隐藏接入接出点；拖线时显示其他生成卡接入点", () => {
    expect(handleVisibility(false, false, true)).toEqual({ source: false, target: false });
    expect(handleVisibility(true, false, true)).toEqual({ source: true, target: true });
    expect(handleVisibility(false, true, true)).toEqual({ source: false, target: true });
    expect(handleVisibility(false, true, false)).toEqual({ source: false, target: false });
  });
});
