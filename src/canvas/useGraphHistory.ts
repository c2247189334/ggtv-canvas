import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { emptyHistory, observeHistory, undoHistory, redoHistory, type Graph, type HistoryFrame } from "@/domain/history";

/** Board随画布id重新挂载，历史不会带到下一张，也不进入存档。 */
export function useGraphHistory(graph: Graph, ready: boolean, apply: (graph: Graph) => void) {
  const frame = useRef<HistoryFrame>({ history: emptyHistory(), baseline: null });
  const [, refresh] = useState(0);

  useLayoutEffect(() => {
    if (!ready) return;
    const previous = frame.current.history;
    frame.current = observeHistory(frame.current, graph);
    if (previous !== frame.current.history) refresh(n => n + 1);
  }, [graph.nodes, graph.edges, ready]);

  const travel = useCallback((direction: "undo" | "redo") => {
    if (!ready || graph.nodes.some(n => n.dragging)) return;
    const result = (direction === "undo" ? undoHistory : redoHistory)(frame.current.history, graph);
    frame.current = { history: result.history, baseline: result.graph };
    apply(result.graph);
    refresh(n => n + 1);
  }, [graph, ready, apply]);

  return {
    canUndo: frame.current.history.past.length > 0,
    canRedo: frame.current.history.future.length > 0,
    undo: () => travel("undo"), redo: () => travel("redo")
  };
}
