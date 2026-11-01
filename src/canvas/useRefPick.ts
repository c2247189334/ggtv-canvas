import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useReactFlow, type Edge } from "@xyflow/react";
import { useEscapeLayer } from "@/common/useEscapeLayer";
import { refPickState, selectGraph } from "@/domain/selection";
import { cardAtPointer, isEditable } from "./useBoardActions";
import type { useBoardDoc } from "./useBoardDoc";
import type { useCards } from "./useCards";
import type { CardNode } from "@/types";

const CONTROLS = ".panel, .react-flow__panel, .ref-pick-label, button, input, textarea, select, [contenteditable]";

export function useRefPick(doc: ReturnType<typeof useBoardDoc>, cards: ReturnType<typeof useCards>, closeMenu: () => void) {
  const flow = useReactFlow<CardNode, Edge>();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const space = useRef(false);
  const press = useRef<{ x: number; y: number; space: boolean; dragged: boolean } | null>(null);
  // 菜单明确改选其他卡时结束本模式，保留原来的右键和左右＋行为。
  const active = targetId !== null && doc.nodes.some(n => n.id === targetId && n.selected);
  const exit = () => { setTargetId(null); setHover(null); };
  useEscapeLayer(exit, active, 900);
  useLayoutEffect(() => { if (targetId && !active) exit(); }, [targetId, active]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.code === "Space" && !isEditable(event.target)) space.current = true; };
    const up = (event: KeyboardEvent) => { if (event.code === "Space") space.current = false; };
    const blur = () => { space.current = false; press.current = null; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  const start = (id: string) => {
    closeMenu();
    const selected = selectGraph({ nodes: flow.getNodes(), edges: flow.getEdges() }, id, "replace");
    doc.setNodes(selected.nodes);
    doc.setEdges(selected.edges);
    setHover(null);
    setTargetId(id);
  };
  const choose = (id: string, onLabel = false) => {
    if (!active || !targetId) return;
    const state = refPickState(targetId, flow.getNode(id), flow.getEdges(), onLabel);
    if (state.action === "connect") cards.connect(id, targetId);
    else if (state.action === "disconnect") cards.disconnect(id, targetId);
  };
  const onClickCapture = (event: MouseEvent) => {
    if (!active || !(event.target instanceof Element) || event.target.closest(CONTROLS)) return;
    event.preventDefault();
    event.stopPropagation();
    const gesture = press.current;
    press.current = null;
    if (space.current || gesture?.space || gesture?.dragged || event.button !== 0) return;
    const id = cardAtPointer(event.target, { x: event.clientX, y: event.clientY }, true);
    if (id) choose(id);
  };
  const state = refPickState(targetId, doc.nodes.find(n => n.id === hover?.id), doc.edges);
  return {
    active, start, exit, onClickCapture,
    label: active && hover && state.label ? { ...hover, text: state.label, cancel: state.action === "ignore" } : null,
    cancel: () => { if (hover) choose(hover.id, true); },
    returnToNode: () => {
      const node = targetId ? flow.getNode(targetId) : undefined;
      if (node) void flow.setCenter(node.position.x + (node.measured?.width ?? node.width ?? 0) / 2,
        node.position.y + (node.measured?.height ?? node.height ?? 0) / 2, { zoom: flow.getZoom() });
      exit();
    },
    onPointerDownCapture: (event: PointerEvent) => {
      press.current = { x: event.clientX, y: event.clientY, space: space.current, dragged: false };
    },
    onPointerMove: (event: PointerEvent) => {
      if (!active) return;
      const x = event.clientX, y = event.clientY;
      if (press.current && Math.hypot(x - press.current.x, y - press.current.y) >= 5) press.current.dragged = true;
      if (event.target instanceof Element && event.target.closest(".ref-pick-label")) return;
      const id = cardAtPointer(event.target, { x, y }, true);
      if (!id || id === targetId) { setHover(null); return; }
      const connected = refPickState(targetId, flow.getNode(id), flow.getEdges()).action === "ignore";
      // 取消按钮在同一卡内固定，鼠标才能移过去点；新参考的标签跟着鼠标。
      setHover(previous => previous?.id === id && connected ? previous : { id, x, y });
    },
    onPointerLeave: () => setHover(null),
    onDoubleClickCapture: (event: MouseEvent) => {
      if (active && event.target instanceof Element && !event.target.closest(CONTROLS)) {
        event.preventDefault(); event.stopPropagation();
      }
    }
  };
}
