import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type MouseEvent } from "react";
import { useReactFlow, type Edge } from "@xyflow/react";
import { copySelection, pasteClipboard, resolvePasteAnchor, type Clipboard } from "@/domain/clipboard";
import { escapeAction, shortcutAction } from "@/domain/shortcuts";
import { filterSelectionChanges, selectGraph, selectionOrder, selectionLink } from "@/domain/selection";
import type { Notify } from "@/common/Toast";
import type { useBoardDoc } from "@/canvas/useBoardDoc";
import type { useGraphHistory } from "@/canvas/useGraphHistory";
import type { Point } from "@/domain/placement";
import { busyLocalJobs } from "@/domain/localMedia";
import type { CardNode } from "@/types";

let memory: Clipboard = { nodes: [], edges: [] };
export const isEditable = (target: EventTarget | null): boolean => target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));

/** 多选框会盖住未选卡，取覆盖层下面真实的卡片。 */
export function cardAtPointer(target: EventTarget | null, point: Point, bodyOnly = false): string | null {
  if (!(target instanceof Element)) return null;
  const elements = target.closest(".react-flow__nodesselection") ? document.elementsFromPoint(point.x, point.y) : [target];
  for (const element of elements) {
    const id = element.closest(".react-flow__node")?.getAttribute("data-id");
    if (id) {
      if (bodyOnly && (!element.closest(".card") || element.closest(".nodrag, .react-flow__handle, button, input, textarea, select, [contenteditable]"))) return null;
      return id;
    }
  }
  return null;
}

export function useBoardActions(doc: ReturnType<typeof useBoardDoc>, history: ReturnType<typeof useGraphHistory>, closeMenu: () => void, notify: Notify,
  stopLocal: (cardIds: string[]) => Promise<void> = async () => {}) {
  const flow = useReactFlow<CardNode, Edge>();
  const pointer = useRef<Point | null>(null);
  const additive = useRef(false);
  const press = useRef<{ x: number; y: number; overlay: boolean; dragged: boolean } | null>(null);
  const [clipboard, setClipboard] = useState(memory);
  const [pendingRemove, setPendingRemove] = useState<{ ids: string[]; count: number } | null>(null);
  const order = useRef<string[]>([]);
  useLayoutEffect(() => {
    order.current = selectionOrder(order.current, doc.nodes.filter(n => n.selected).map(n => n.id));
  }, [doc.nodes]);
  const deselect = () => {
    doc.setNodes(nodes => nodes.map(n => n.selected ? { ...n, selected: false } : n));
    doc.setEdges(edges => edges.map(e => e.selected ? { ...e, selected: false } : e));
  };
  const copy = () => {
    const selected = copySelection(flow.getNodes(), flow.getEdges());
    if (!selected.nodes.length) return;
    memory = selected;
    setClipboard(selected);
  };
  const paste = (at?: Point | null, duplicate = false) => {
    const source = duplicate ? copySelection(flow.getNodes(), flow.getEdges(), true) : memory;
    const created = pasteClipboard(source, resolvePasteAnchor(at, pointer.current, flow.screenToFlowPosition));
    if (!created.nodes.length) return;
    doc.setNodes(nodes => [...nodes.map(n => n.selected ? { ...n, selected: false } : n), ...created.nodes]);
    doc.setEdges(edges => [...edges.map(e => e.selected ? { ...e, selected: false } : e), ...created.edges]);
  };
  const drop = (ids: Set<string>) => {
    doc.setNodes(nodes => nodes.filter(n => !ids.has(n.id)));
    doc.setEdges(edges => edges.filter(e => !e.selected && !ids.has(e.source) && !ids.has(e.target)));
  };
  /** 10-31 用户：删还在生成的深度 / 白模卡，先确认，确认了连后台一起停（不然显卡会一直算下去）。 */
  const remove = () => {
    const selected = flow.getNodes().filter(n => n.selected), count = busyLocalJobs(selected).length;
    if (count) setPendingRemove({ ids: selected.map(n => n.id), count });
    else drop(new Set(selected.map(n => n.id)));
  };
  const confirmRemove = () => {
    if (!pendingRemove) return;
    setPendingRemove(null); void stopLocal(pendingRemove.ids); drop(new Set(pendingRemove.ids));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!doc.ready || event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (escapeAction(event, []).type === "deselect") {
          event.preventDefault();
          closeMenu();
          deselect();
        }
        return;
      }
      const action = shortcutAction(event, { editable: isEditable(event.target) });
      if (!action || action === "send") return;
      event.preventDefault();
      closeMenu();
      if (action === "undo") history.undo();
      else if (action === "redo") history.redo();
      else if (action === "copy") copy();
      else if (action === "paste") paste();
      else if (action === "duplicate") paste(null, true);
      else if (action === "link") {
        const nodes = flow.getNodes();
        order.current = selectionOrder(order.current, nodes.filter(n => n.selected).map(n => n.id));
        const result = selectionLink(order.current, nodes, flow.getEdges());
        if (result.edge) doc.setEdges(edges => [...edges, result.edge!]);
        notify(result.message);
      }
      else if (action === "delete") remove();
      else if (action === "zoomIn") void flow.zoomIn();
      else if (action === "zoomOut") void flow.zoomOut();
      else if (action === "fit") void flow.fitView({ padding: 0.2, maxZoom: 1 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return {
    copy, paste, duplicate: () => paste(null, true), remove, deselect,
    pendingRemove, confirmRemove, cancelRemove: () => setPendingRemove(null),
    canPaste: clipboard.nodes.length > 0,
    onNodesChange: (changes: Parameters<typeof doc.onNodesChange>[0]) => doc.onNodesChange(filterSelectionChanges(changes, additive.current)),
    onPointerDownCapture: (event: PointerEvent) => {
      const point = { x: event.clientX, y: event.clientY };
      press.current = { ...point, overlay: event.target instanceof Element && Boolean(event.target.closest(".react-flow__nodesselection")), dragged: false };
      additive.current = Boolean(cardAtPointer(event.target, point) && (event.ctrlKey || event.shiftKey));
    },
    onPointerMove: (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 1) press.current.dragged = true;
    },
    onClick: (event: MouseEvent) => {
      if (!press.current?.overlay || press.current.dragged || event.defaultPrevented) return;
      if (!(event.target instanceof Element) || !event.target.closest(".react-flow__nodesselection")) return;
      const id = cardAtPointer(event.target, { x: event.clientX, y: event.clientY });
      const selection = selectGraph({ nodes: flow.getNodes(), edges: flow.getEdges() }, id, event.ctrlKey || event.shiftKey ? "add" : "replace");
      doc.setNodes(selection.nodes);
      doc.setEdges(selection.edges);
    },
    onPointerLeave: () => { pointer.current = null; press.current = null; }
  };
}
