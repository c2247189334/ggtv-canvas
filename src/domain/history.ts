import type { Edge } from "@xyflow/react";
import type { CardNode } from "@/types";

export type Graph = { nodes: CardNode[]; edges: Edge[] };
type Step = { before: Graph; after: Graph };
export type History = { past: Step[]; future: Step[] };
export const emptyHistory = (): History => ({ past: [], future: [] });
export type HistoryFrame = { history: History; baseline: Graph | null };

/** 每次渲染观察一次：加载建立基线，拖动期间只刷新内容，松手才压栈。 */
export function observeHistory(frame: HistoryFrame, current: Graph): HistoryFrame {
  if (!frame.baseline) return { ...frame, baseline: current };
  const baseline = restore(frame.baseline, current);
  if (current.nodes.some(n => n.dragging)) return { ...frame, baseline };
  return { history: recordHistory(frame.history, baseline, current), baseline: current };
}

/** 拓扑、位置和真人素材编号计步；提示词、生成进度等内容仍不计步。 */
export function sameStructure(a: Graph, b: Graph): boolean {
  const structure = (g: Graph) => JSON.stringify([
    g.nodes.map(n => [n.id, n.position.x, n.position.y, n.data.kind === "image" ? n.data.assetId : undefined]),
    g.edges.map(e => [e.id, e.source, e.target])
  ]);
  return structure(a) === structure(b);
}

export function recordHistory(history: History, before: Graph, after: Graph): History {
  if (sameStructure(before, after)) return history;
  return { past: [...history.past, structuredClone({ before, after })].slice(-50), future: [] };
}

/** 两边都存在的卡只恢复位置；删除后找回的卡用快照里的内容。 */
function restore(snapshot: Graph, current: Graph): Graph {
  const live = new Map(current.nodes.map(n => [n.id, n]));
  const liveEdges = new Map(current.edges.map(e => [e.id, e]));
  return {
    nodes: snapshot.nodes.map(n => {
      const present = live.get(n.id);
      const result = { ...n, ...present, position: n.position, ...(n.dragging || present?.dragging ? { dragging: false } : {}) };
      if (n.data.kind === "image" && result.data.kind === "image") {
        const { assetId: _assetId, ...data } = result.data;
        result.data = { ...data, ...(n.data.assetId ? { assetId: n.data.assetId } : {}) };
      }
      return result;
    }),
    edges: snapshot.edges.map(e => ({ ...e, ...liveEdges.get(e.id), source: e.source, target: e.target }))
  };
}

export function undoHistory(history: History, current: Graph): { history: History; graph: Graph } {
  const step = history.past.at(-1);
  if (!step) return { history, graph: current };
  const graph = restore(step.before, current);
  return { graph, history: { past: history.past.slice(0, -1), future: [...history.future, structuredClone({ before: graph, after: current })] } };
}

export function redoHistory(history: History, current: Graph): { history: History; graph: Graph } {
  const step = history.future.at(-1);
  if (!step) return { history, graph: current };
  const graph = restore(step.after, current);
  return { graph, history: { past: [...history.past, structuredClone({ before: current, after: graph })], future: history.future.slice(0, -1) } };
}
