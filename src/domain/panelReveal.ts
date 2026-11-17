import { BOTTOM_BARS, TOP_BARS } from './screenBars';

type Rect = { left: number; top: number; right: number; bottom: number };

const MARGIN = 8, SIDE = 24;
/** 卡顶上给工具条留的位置：顶上按钮栏下沿 + 工具条约 37 高 + 离卡 10（和双击对准一样）。 */
const TOP_SPACE = TOP_BARS + 48;

/**
 * 11-17 用户定：新建生成卡、点「视频改写 / 拆解」后，面板掉到屏幕外（看不到「发送」「开始改写」）时把画布挪一下。
 * 只平移、不缩放，挪得刚好够：面板底进到左下按钮栏上面，卡顶不钻进顶上按钮栏；左右只管卡片（面板自己会横着挪回屏内）。
 * card / panel 是它们现在在屏幕上的位置。返回要挪多少屏幕像素；都在屏内返回 0,0；
 * 卡加面板比屏幕能用的高度还高（平移救不了，要缩小）返回 null。
 */
export function revealShift(card: Rect, panel: Rect, screen: { width: number; height: number }): { dx: number; dy: number } | null {
  const top = Math.min(card.top, panel.top), bottom = Math.max(card.bottom, panel.bottom);
  const minTop = TOP_SPACE, maxBottom = screen.height - BOTTOM_BARS - MARGIN;
  if (bottom - top > maxBottom - minTop) return null;
  const dy = bottom > maxBottom ? maxBottom - bottom : top < minTop ? minTop - top : 0;
  let dx = card.right > screen.width - SIDE ? screen.width - SIDE - card.right : 0;
  if (card.left + dx < SIDE) dx = SIDE - card.left;
  return { dx: Math.round(dx), dy: Math.round(dy) };
}
