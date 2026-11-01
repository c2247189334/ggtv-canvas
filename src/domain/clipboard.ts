import type { Edge } from "@xyflow/react";
import { cardTitle } from "@/domain/cards";
import { linkId } from "@/domain/refs";
import { copyRewriteData } from "./rewriteCopy";
import type { Point } from "@/domain/placement";
import type { CardNode } from "@/types";

export type Clipboard = { nodes: CardNode[]; edges: Edge[] };

/** 阈值用屏幕像素，位移用画布单位；开始拖动后回到原点也保留副本。 */
export function dragCopyPosition(start: Point, current: Point, origin: Point, zoom: number, dragging: boolean): Point | null {
  const dx = current.x - start.x, dy = current.y - start.y;
  if (!dragging && Math.hypot(dx, dy) < 5) return null;
  return { x: origin.x + dx / zoom, y: origin.y + dy / zoom };
}

/** undefined采用当前鼠标，null明确要求原位偏移；坐标换算延迟到粘贴时。 */
export function resolvePasteAnchor(explicit: Point | null | undefined, screen: Point | null, project: (p: Point) => Point): Point | null {
  return explicit !== undefined ? explicit : screen ? project(screen) : null;
}

export function copySelection(nodes: readonly CardNode[], edges: readonly Edge[], includeUpstream = false): Clipboard {
  const selected = nodes.filter(n => n.selected);
  const ids = new Set(selected.map(n => n.id));
  return structuredClone({ nodes: selected, edges: edges.filter(e => ids.has(e.target) && (includeUpstream || ids.has(e.source))) });
}

/** at=null：整组在原位右下40；否则组的左上角对齐指定画布坐标。 */
export function pasteClipboard(clipboard: Clipboard, at: Point | null, newId = () => `card-${crypto.randomUUID().slice(0, 8)}`): Clipboard {
  if (!clipboard.nodes.length) return { nodes: [], edges: [] };
  const copy = structuredClone(clipboard);
  const left = Math.min(...copy.nodes.map(n => n.position.x));
  const top = Math.min(...copy.nodes.map(n => n.position.y));
  const delta = at ? { x: at.x - left, y: at.y - top } : { x: 40, y: 40 };
  const ids = new Map(copy.nodes.map(n => [n.id, newId()]));
  return {
    nodes: copy.nodes.map(n => {
      const { phase: _phase, depthJobId: _depthJobId, startedAt: _startedAt, rewriteBusy: _rewriteBusy,
        rewriteStatus: _rewriteStatus, ...data } = n.data;
      return {
        id: ids.get(n.id)!, type: "card", selected: true,
        position: { x: n.position.x + delta.x, y: n.position.y + delta.y },
        data: { ...copyRewriteData(data, ids, n.data), title: `${cardTitle(n.data)} - 副本`, jobs: [] }
      };
    }),
    edges: copy.edges.map(e => {
      const source = ids.get(e.source) ?? e.source;
      const target = ids.get(e.target)!;
      return { id: linkId(source, target), source, target };
    })
  };
}
