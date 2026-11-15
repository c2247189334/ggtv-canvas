import { useLayoutEffect, useRef } from "react";
import { measuredRewriteColumn, type RewriteColumn } from "@/domain/videoRewriteLayout";
import type { CardNode } from "@/types";
import { productLayoutNodes } from '@/domain/productRemakeLayout';

type TrackedColumn = RewriteColumn & { positions?: Map<string, { x: number; y: number }> };

/** 新建列随真实尺寸变化收齐排版；用户拖动/撤销位置后停止，已有卡不移动。 */
export function useMeasuredRewriteLayout(nodes: CardNode[], setNodes: (update: (nodes: CardNode[]) => CardNode[]) => void) {
  const columns = useRef(new Map<string, TrackedColumn>());
  useLayoutEffect(() => {
    let next = nodes;
    for (const [id, column] of columns.current) {
      const members = column.productVideoId ? productLayoutNodes(next, column.productVideoId) : next.filter(node => column.ids.includes(node.id));
      if (column.productVideoId && (!members.length || !next.some(n => n.id === column.productVideoId))) {
        columns.current.delete(id); continue;
      }
      if (!column.productVideoId && members.length !== column.ids.length) {
        if (column.positions) columns.current.delete(id);
        continue;
      }
      if (members.some(node => node.dragging || (column.productVideoId || column.movableIds.includes(node.id)) && column.positions?.has(node.id) &&
        (node.position.x !== column.positions.get(node.id)!.x || node.position.y !== column.positions.get(node.id)!.y))) {
        columns.current.delete(id);
        continue;
      }
      const placed = measuredRewriteColumn(next, column);
      if (!placed) continue;
      column.positions = new Map((column.productVideoId ? productLayoutNodes(placed, column.productVideoId) : placed.filter(node => column.movableIds.includes(node.id)))
        .map(node => [node.id, node.position]));
      next = placed;
    }
    if (next !== nodes) setNodes(current => current === nodes ? next : current);
  }, [nodes, setNodes]);
  return (id: string, column: RewriteColumn) => { columns.current.set(id, column); };
}
