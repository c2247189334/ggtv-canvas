import { BOTTOM_BARS, TOP_BARS } from './screenBars';

type Anchor = { left: number; right: number; top: number; bottom: number };
type Size = { width: number; height: number };
const GAP = 10, SIDE = 8;

/**
 * 卡片 / 组的工具条放屏幕哪儿（屏幕像素）。横向：卡上居中，出屏就夹回来（10-31）。
 * 竖向（11-09 改）：上方放得下、又不钻进顶上按钮栏，就在卡上方；放不下就贴着按钮栏下沿压在卡上。
 * 以前放不下就挪到卡下面，正好被卡下面的提示词 / 改写面板整条盖住（用户截图）。
 * panelBelow：卡下面挂着面板时，卡快挪出屏幕上边就跟着卡底往上走，绝不压进面板；没面板的一直留在屏幕里。
 * 卡在屏幕下面时也不压进底下的按钮栏。
 */
export function toolbarPosition(anchor: Anchor, toolbar: Size, viewport: Size, panelBelow = false) {
  const left = Math.max(SIDE, Math.min((anchor.left + anchor.right - toolbar.width) / 2, viewport.width - toolbar.width - SIDE));
  const lowest = viewport.height - BOTTOM_BARS - toolbar.height;
  const above = anchor.top - toolbar.height - GAP;
  const pinned = panelBelow ? Math.min(TOP_BARS, anchor.bottom - toolbar.height) : TOP_BARS;
  return { left, top: Math.min(above >= TOP_BARS ? above : pinned, lowest) };
}
