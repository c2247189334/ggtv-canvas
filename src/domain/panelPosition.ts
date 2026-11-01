export function panelPosition(
  anchor: { left: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  direction: "up" | "down" = "down",
  contentHeight = 0
): { left: number; top?: number; bottom?: number; maxHeight?: number } {
  const left = Math.max(8, Math.min(anchor.left, viewport.width - 304));
  const top = Math.max(8, Math.min(anchor.bottom + 6, viewport.height - contentHeight - 8));
  return direction === "up"
    ? { left, bottom: viewport.height - anchor.top + 6, maxHeight: Math.max(0, anchor.top - 14) }
    : { left, top, maxHeight: Math.max(0, viewport.height - top - 8) };
}
