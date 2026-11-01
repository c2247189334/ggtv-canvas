import { ViewportPortal, getBezierPath, Position } from "@xyflow/react";
import type { PendingLink } from "@/canvas/useBoardMenus";
import type { CardNode } from "@/types";
import { CARD_WIDTH } from "@/domain/placement";

export function PendingConnection({ pending, nodes }: { pending: PendingLink | null; nodes: CardNode[] }) {
  if (!pending) return null;
  const source = nodes.find(n => n.id === pending.source);
  if (!source) return null;
  const [path] = getBezierPath({
    sourceX: source.position.x + (source.measured?.width ?? CARD_WIDTH),
    sourceY: source.position.y + (source.measured?.height ?? 200) / 2,
    targetX: pending.at.x, targetY: pending.at.y, sourcePosition: Position.Right, targetPosition: Position.Left
  });
  return <ViewportPortal><svg className="board__pending" width="1" height="1"><path d={path} /></svg></ViewportPortal>;
}
