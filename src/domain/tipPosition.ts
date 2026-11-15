const GAP = 6, EDGE = 8, MIN_HEIGHT = 60;

export type TipPlace = { left: number; top: number; maxHeight: number };

/**
 * 「?」说明气泡放哪（11-08 用户定：解释收进问号，鼠标移上去才看）：
 * 默认放在问号下面，下面放不下、上面空间更大就放上面；左边对齐问号，左右夹在屏幕里；
 * 两边都放不下时限高，气泡里自己滚动。anchor 是问号在屏幕上的位置，bubble 是气泡没限高时的大小。
 */
export function tipPosition(anchor: { left: number; top: number; bottom: number }, bubble: { width: number; height: number },
  screen: { width: number; height: number }): TipPlace {
  const left = Math.max(EDGE, Math.min(anchor.left, screen.width - EDGE - bubble.width));
  const below = Math.round(screen.height - EDGE - anchor.bottom - GAP);
  const above = Math.round(anchor.top - GAP - EDGE);
  if (bubble.height <= below || below >= above) return { left, top: anchor.bottom + GAP, maxHeight: Math.max(MIN_HEIGHT, below) };
  return { left, top: Math.max(EDGE, anchor.top - GAP - bubble.height), maxHeight: above };
}
