/** 以实测高度夹在视窗内；超高菜单贴顶，由调用方限制高度并滚动。 */
export function menuTop(y: number, height: number, viewportHeight: number, above = false): number {
  const top = above ? y - height : y;
  return Math.max(8, Math.min(top, viewportHeight - height - 8));
}
