import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";
import { useReactFlow, type Edge } from "@xyflow/react";
import { cardAtPointer } from "./useBoardActions";
import type { useBoardDoc } from "./useBoardDoc";
import { copySelection, dragCopyPosition, pasteClipboard } from "@/domain/clipboard";
import type { CardNode } from "@/types";

/** 拦住Alt按下，越过屏幕阈值才建副本；全局监听保证拖出画布也能松手。 */
export function useAltDrag(doc: ReturnType<typeof useBoardDoc>) {
  const flow = useReactFlow<CardNode, Edge>();
  const cleanup = useRef(() => {});
  const suppressClick = useRef(false);
  useEffect(() => () => cleanup.current(), []);

  const onPointerDownCapture = (event: PointerEvent) => {
    suppressClick.current = false;
    if (event.button !== 0 || !event.altKey) return;
    const start = { x: event.clientX, y: event.clientY };
    const id = cardAtPointer(event.target, start, true);
    const original = id ? flow.getNode(id) : undefined;
    if (!original) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup.current();
    suppressClick.current = true;
    const pointerId = event.pointerId;
    const origin = { ...original.position };
    const source = copySelection([{ ...original, selected: true }], event.ctrlKey ? flow.getEdges() : [], event.ctrlKey);
    let createdId: string | null = null;
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const position = dragCopyPosition(start, { x: next.clientX, y: next.clientY }, origin, flow.getZoom(), createdId !== null);
      if (!position) return;
      next.preventDefault();
      if (!createdId) {
        const created = pasteClipboard(source, position);
        createdId = created.nodes[0].id;
        doc.setNodes(nodes => [...nodes.map(n => ({ ...n, selected: false })), ...created.nodes.map(n => ({ ...n, dragging: true }))]);
        doc.setEdges(edges => [...edges.map(e => ({ ...e, selected: false })), ...created.edges]);
      } else {
        doc.setNodes(nodes => nodes.map(n => n.id === createdId ? { ...n, position, dragging: true } : n));
      }
    };
    const finish = () => {
      if (createdId) doc.setNodes(nodes => nodes.map(n => n.id === createdId ? { ...n, dragging: false } : n));
      cleanup.current();
    };
    const up = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      move(next);
      finish();
    };
    const cancel = (next: globalThis.PointerEvent) => { if (next.pointerId === pointerId) finish(); };
    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", finish);
    cleanup.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", finish);
      cleanup.current = () => {};
    };
  };
  return {
    onPointerDownCapture,
    onClickCapture: (event: MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  };
}
