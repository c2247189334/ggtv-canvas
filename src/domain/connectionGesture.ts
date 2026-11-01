import type { Point } from "./placement";

export const CONNECTION_DRAG_THRESHOLD = 5;

/** 使用屏幕坐标，与画布缩放无关；越过阈值后回到原点仍然是拖动。 */
export function connectionDragged(dragged: boolean, start: Point, current: Point): boolean {
  return dragged || Math.hypot(current.x - start.x, current.y - start.y) > CONNECTION_DRAG_THRESHOLD;
}
