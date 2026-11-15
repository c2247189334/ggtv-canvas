import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useReactFlow, type Edge } from '@xyflow/react';
import { arrangeGroup, groupCards, moveGroup, selectGroup, selectGroupCard, ungroupCards, type GroupLayout } from '@/domain/groups';
import type { Notify } from '@/common/Toast';
import type { CardNode } from '@/types';
import type { useBoardDoc } from './useBoardDoc';

export function useBoardGroups(doc: ReturnType<typeof useBoardDoc>, notify: Notify) {
  const flow = useReactFlow<CardNode, Edge>();
  const [selected, setSelected] = useState<string | null>(null);
  const cleanup = useRef(() => {});
  useEffect(() => () => cleanup.current(), []);
  useEffect(() => {
    if (selected && !doc.nodes.some(n => n.data.group?.id === selected && n.selected)) setSelected(null);
  }, [doc.nodes, selected]);

  const select = (id: string) => {
    const graph = selectGroup({ nodes: flow.getNodes(), edges: flow.getEdges() }, id);
    doc.setNodes(graph.nodes); doc.setEdges(graph.edges); setSelected(id);
  };
  const clear = () => setSelected(null);
  const selectCard = (id: string) => {
    if (!selected) return;
    const graph = selectGroupCard({ nodes: flow.getNodes(), edges: flow.getEdges() }, id);
    doc.setNodes(graph.nodes); doc.setEdges(graph.edges); clear();
  };
  const makeGroup = () => {
    const result = groupCards(flow.getNodes());
    if (!result) { notify('至少选 2 张卡才能打组'); return; }
    doc.setNodes(result.nodes); setSelected(result.group.id);
  };
  const ungroup = (id = selected) => {
    if (id) doc.setNodes(nodes => ungroupCards(nodes, id));
    clear();
  };
  const arrange = (id: string, layout: GroupLayout) => doc.setNodes(nodes => arrangeGroup(nodes, id, layout));
  const onPointerDown = (event: PointerEvent, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); cleanup.current(); select(id);
    const start = { x: event.clientX, y: event.clientY }, pointerId = event.pointerId;
    const originals = new Map(flow.getNodes().filter(n => n.data.group?.id === id).map(n => [n.id, n.position]));
    const zoom = flow.getZoom();
    let moved = false;
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const delta = { x: (next.clientX - start.x) / zoom, y: (next.clientY - start.y) / zoom };
      if (!moved && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 5) return;
      moved = true; next.preventDefault();
      doc.setNodes(nodes => moveGroup(nodes.map(n => originals.has(n.id) ? { ...n, position: originals.get(n.id)! } : n), id, delta, true));
    };
    const finish = () => {
      if (moved) doc.setNodes(nodes => nodes.map(n => originals.has(n.id) ? { ...n, dragging: false } : n));
      cleanup.current();
    };
    const up = (next: globalThis.PointerEvent) => { if (next.pointerId === pointerId) { move(next); finish(); } };
    const cancel = (next: globalThis.PointerEvent) => { if (next.pointerId === pointerId) finish(); };
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', finish);
    cleanup.current = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true); window.removeEventListener('blur', finish);
      cleanup.current = () => {};
    };
  };
  return { selected, select, clear, selectCard, makeGroup, ungroup, arrange, onPointerDown };
}
