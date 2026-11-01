import type { Point } from "./placement";

/** 对采样点之间的线段做投影，避免剪刀在采样点之间跳动。 */
export function nearestPointOnPolyline(points: readonly Point[], mouse: Point): Point | null {
  let nearest = points[0] ?? null;
  let distance = Infinity;
  for (let index = 0; index < points.length; index++) {
    const start = points[index];
    const end = points[index + 1] ?? start;
    const dx = end.x - start.x, dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
      ((mouse.x - start.x) * dx + (mouse.y - start.y) * dy) / lengthSquared));
    const point = { x: start.x + t * dx, y: start.y + t * dy };
    const nextDistance = (point.x - mouse.x) ** 2 + (point.y - mouse.y) ** 2;
    if (nextDistance < distance) { nearest = point; distance = nextDistance; }
  }
  return nearest;
}

export function canCutEdge(state: { refPicking: boolean; connecting: boolean; selecting: boolean; dragging: boolean }): boolean {
  return !state.refPicking && !state.connecting && !state.selecting && !state.dragging;
}

/** 剪刀在标签 portal 中，不是 SVG 连线的 DOM 子元素。 */
export function suppressEdgeMenu(target: { edge: boolean; cutButton: boolean }): boolean {
  return target.edge || target.cutButton;
}
