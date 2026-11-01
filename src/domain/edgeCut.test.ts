import { describe, expect, it } from "vitest";
import { canCutEdge, nearestPointOnPolyline, suppressEdgeMenu } from "./edgeCut";
import { emptyHistory, observeHistory, redoHistory, undoHistory, type Graph } from "./history";

describe("nearestPointOnPolyline", () => {
  it("投影到线段中间，而不是取最近的采样点", () => {
    expect(nearestPointOnPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 4, y: 3 })).toEqual({ x: 4, y: 0 });
  });
  it("比较整条折线的所有线段", () => {
    expect(nearestPointOnPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { x: 13, y: 7 })).toEqual({ x: 10, y: 7 });
  });
  it("斜线投影保留小数，鼠标和点列不被改写", () => {
    const points = Object.freeze([Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 10, y: 10 })]);
    expect(nearestPointOnPolyline(points, Object.freeze({ x: 4, y: 1 }))).toEqual({ x: 2.5, y: 2.5 });
  });
  it("超出两端时夹到端点", () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(nearestPointOnPolyline(points, { x: -5, y: 2 })).toEqual(points[0]);
    expect(nearestPointOnPolyline(points, { x: 15, y: 2 })).toEqual(points[1]);
  });
  it("支持空路径、单点和重复点的退化线段", () => {
    expect(nearestPointOnPolyline([], { x: 2, y: 3 })).toBeNull();
    expect(nearestPointOnPolyline([{ x: 1, y: 1 }], { x: 2, y: 3 })).toEqual({ x: 1, y: 1 });
    expect(nearestPointOnPolyline([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }], { x: 3, y: 2 })).toEqual({ x: 3, y: 0 });
  });
});

describe("edge cut policy", () => {
  const idle = { refPicking: false, connecting: false, selecting: false, dragging: false };
  it("空闲时允许悬停和剪断", () => expect(canCutEdge(idle)).toBe(true));
  it.each(["refPicking", "connecting", "selecting", "dragging"] as const)("%s 时同时禁止悬停和剪断", key => {
    expect(canCutEdge({ ...idle, [key]: true })).toBe(false);
  });
  it("多个受限状态同时存在也禁止", () => {
    expect(canCutEdge({ refPicking: true, connecting: true, selecting: true, dragging: true })).toBe(false);
  });
  it.each([
    [true, false, true], [false, true, true], [true, true, true], [false, false, false]
  ])("右键在线内=%s、剪刀内=%s 时拦截=%s", (edge, cutButton, blocked) => {
    expect(suppressEdgeMenu({ edge, cutButton })).toBe(blocked);
  });
  it("一次 edges 删除只记一步，撤销恢复原线，重做再次删除", () => {
    const before: Graph = { nodes: [], edges: [
      { id: "cut", source: "a", target: "b" }, { id: "keep", source: "b", target: "c" }
    ] };
    const after = { ...before, edges: before.edges.filter(edge => edge.id !== "cut") };
    const initial = observeHistory({ history: emptyHistory(), baseline: null }, before);
    const frame = observeHistory(initial, after);
    expect(frame.history.past).toHaveLength(1);
    const undone = undoHistory(frame.history, after);
    expect(undone.graph).toEqual(before);
    expect(undone.history.past).toHaveLength(0);
    expect(redoHistory(undone.history, undone.graph).graph).toEqual(after);
  });
});
