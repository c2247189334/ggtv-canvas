import { BOTTOM_BARS } from './screenBars';

const MARGIN = 8, MIN_HEIGHT = 260;

/**
 * 提示词面板按屏幕摆（11-08 用户定）：面板不随缩放，靠右的卡面板会伸出屏幕右边、低处的卡面板会掉出屏幕底。
 * shift：左右要挪多少（右出屏往左、左出屏往右，比屏宽时保左边）；
 * maxHeight：最多多高才不进左下按钮栏（11-09：以前只留 8，按钮栏盖住面板左下角；再矮也留 260）。
 * box 是面板没挪之前在屏幕上的位置。
 */
export function panelFit(box: { left: number; top: number; width: number }, screen: { width: number; height: number }): { shift: number; maxHeight: number } {
  const right = box.left + box.width;
  let shift = right > screen.width - MARGIN ? screen.width - MARGIN - right : 0;
  if (box.left + shift < MARGIN) shift = MARGIN - box.left;
  return { shift, maxHeight: Math.max(MIN_HEIGHT, Math.round(screen.height - box.top - BOTTOM_BARS)) };
}
