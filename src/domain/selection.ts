import type { NodeChange } from "@xyflow/react";
import type { CardNode } from "@/types";
import type { Graph } from "@/domain/history";
import { cardTitle } from "@/domain/cards";
import { checkLink, linkId, type LinkEdge } from "@/domain/refs";

export const boardKeyboardControls = {
  disableKeyboardA11y: true, nodesFocusable: false, edgesFocusable: false,
  deleteKeyCode: null, selectionKeyCode: null, multiSelectionKeyCode: ["Control", "Shift"]
};

/** 旧成员保留先后，一次框选的新成员按nodes顺序追加。 */
export function selectionOrder(previous: readonly string[], selected: readonly string[]): string[] {
  const current = new Set(selected);
  const known = new Set(previous);
  return [...previous.filter(id => current.has(id)), ...selected.filter(id => !known.has(id))];
}

export function selectionLink(order: readonly string[], nodes: readonly CardNode[], edges: readonly LinkEdge[]): { edge: LinkEdge | null; message: string } {
  if (order.length !== 2) return { edge: null, message: "不符合连线规则" };
  const [source, target] = order;
  const targetData = nodes.find(n => n.id === target)?.data;
  const check = checkLink({ source, target, edges, targetSource: targetData?.source,
    sourceKind: nodes.find(n => n.id === source)?.data.kind, targetKind: targetData?.kind,
    referenceKinds: edges.filter(edge => edge.target === target).map(edge => nodes.find(n => n.id === edge.source)?.data.kind ?? "image") });
  return check.ok ? { edge: { id: linkId(source, target), source, target }, message: "已连接2个节点" } : { edge: null, message: check.reason };
}

/** 已有参考只允许点标签取消；本体点击保持连线。 */
export function refPickState(target: string | null, candidate: CardNode | undefined, edges: readonly LinkEdge[], onLabel = false): { label: string | null; action: "connect" | "disconnect" | "ignore" } {
  if (!target || !candidate || candidate.id === target) return { label: null, action: "ignore" };
  if (edges.some(e => e.source === candidate.id && e.target === target)) return { label: "取消选择", action: onLabel ? "disconnect" : "ignore" };
  return { label: `选择 ${cardTitle(candidate.data)}`, action: "connect" };
}

/** 库默认Ctrl再点会反选；加选操作中只接受选中，不接受取消。 */
export function filterSelectionChanges(changes: NodeChange<CardNode>[], additive: boolean): NodeChange<CardNode>[] {
  return additive ? changes.map(c => c.type === "select" && !c.selected ? { ...c, selected: true } : c) : changes;
}

export function contextSelection(nodes: CardNode[], id: string): CardNode[] {
  return nodes.find(n => n.id === id)?.selected ? nodes : nodes.map(n => ({ ...n, selected: n.id === id }));
}

/** 覆盖层仍负责拖动整组；只有单击才按它下方的实际卡片/空白选择。 */
export function overlaySelection(nodes: CardNode[], id: string | null, additive: boolean, dragged: boolean): CardNode[] {
  if (dragged) return nodes;
  return nodes.map(n => ({ ...n, selected: id !== null && (n.id === id || (additive && Boolean(n.selected))) }));
}

/** 节点与线的选择一起更新，防止切到单卡后删除误伤旧选中的线。 */
export function selectGraph(graph: Graph, id: string | null, mode: "replace" | "add" | "context" | "drag"): Graph {
  if (mode === "drag" || (mode === "context" && graph.nodes.some(n => n.id === id && n.selected))) return graph;
  return {
    nodes: mode === "context" && id ? contextSelection(graph.nodes, id) : overlaySelection(graph.nodes, id, mode === "add", false),
    edges: mode === "add" && id ? graph.edges : graph.edges.map(e => ({ ...e, selected: false }))
  };
}

export function handleVisibility(selected: boolean, connecting: boolean, generate: boolean, fromType: "source" | "target" = "source") {
  return { source: selected || (connecting && fromType === "target"), target: generate && (selected || connecting) };
}
