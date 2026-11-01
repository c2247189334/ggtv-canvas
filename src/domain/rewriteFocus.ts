type Box = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };

const MARGIN = 24, PANEL_OFFSET = 14;

/**
 * 改写做完后把新视频卡和它下方的提示词面板一起挪进屏幕。
 * 卡片按画布坐标随缩放变化；面板（NodeToolbar）不随缩放，按屏幕像素算。只缩小不放大。
 */
export function rewriteFocusViewport(card: Box, panel: Size, screen: Size, zoom: number): { x: number; y: number; zoom: number } {
  const fitHeight = (screen.height - MARGIN * 2 - PANEL_OFFSET - panel.height) / card.height;
  const fitWidth = (screen.width - MARGIN * 2) / card.width;
  const next = Math.max(0.1, Math.min(zoom, fitHeight, fitWidth));
  const cardWidth = card.width * next, total = card.height * next + PANEL_OFFSET + panel.height;
  // 改写卡的面板从卡左边往右展开（10-30），卡和面板合起来居中。
  const left = (screen.width - Math.max(cardWidth, panel.width)) / 2, top = Math.max(MARGIN, (screen.height - total) / 2);
  return { x: left - card.x * next, y: top - card.y * next, zoom: next };
}
