import { BOTTOM_BARS, TOP_BARS } from './screenBars';

type Box = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
/**
 * maxZoom：最多放到几倍（默认 = 现在的缩放，只缩小不放大）；align：面板在卡下居中，还是从卡左边往右展开；
 * top：卡顶上至少留多少屏幕像素（默认 = 顶上按钮栏下沿）。面板底总是停在左下按钮栏上面（11-09）。
 */
export type FocusOptions = { maxZoom?: number; align?: 'start' | 'center'; top?: number };

const MARGIN = 24, PANEL_OFFSET = 14;
/** 双击卡片最多放到的倍数（11-08 用户定：参考软件双击后 116%~129%，卡宽 350；本项目卡宽 280，同样大小约 1.5 倍）。 */
export const DOUBLE_CLICK_ZOOM = 1.5;
/**
 * 双击后卡顶上给工具条留的位置：顶上按钮栏下沿 + 工具条约 37 高 + 离卡 10。
 * 留不够工具条就压到卡上（11-08 留 60 时它被挪到卡下面压住面板；11-09 起不再往下挪，但会钻进按钮栏所以加上栏高）。
 */
export const TOOLBAR_SPACE = TOP_BARS + 48;

/**
 * 把卡片和它下方的提示词面板一起挪进屏幕。
 * 卡片按画布坐标随缩放变化；面板（NodeToolbar）不随缩放，按屏幕像素算。
 */
export function rewriteFocusViewport(card: Box, panel: Size, screen: Size, zoom: number, options: FocusOptions = {}): { x: number; y: number; zoom: number } {
  const space = options.top ?? TOP_BARS;
  const fitHeight = (screen.height - space - BOTTOM_BARS - PANEL_OFFSET - panel.height) / card.height;
  const fitWidth = (screen.width - MARGIN * 2) / card.width;
  const next = Math.max(0.1, Math.min(options.maxZoom ?? zoom, fitHeight, fitWidth));
  const cardWidth = card.width * next, total = card.height * next + PANEL_OFFSET + panel.height;
  const top = Math.max(space, (screen.height - total) / 2);
  // 普通面板在卡下居中：卡放屏幕正中。
  if (options.align === 'center') return { x: screen.width / 2 - (card.x + card.width / 2) * next, y: top - card.y * next, zoom: next };
  // 改写卡的面板从卡左边往右展开（10-30），卡和面板合起来居中。
  const left = (screen.width - Math.max(cardWidth, panel.width)) / 2;
  return { x: left - card.x * next, y: top - card.y * next, zoom: next };
}
