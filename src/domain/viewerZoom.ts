/**
 * 看大图的缩放和拖动：Ctrl + 滚轮往上一格（120）放大约 1.06 倍，
 * 不小于原大、不超过 8 倍；拖动不让图跑出框；双击回到 VIEWER_RESET。
 */
export type ViewerTransform = { scale: number; x: number; y: number };
export type Size = { width: number; height: number };

export const VIEWER_RESET: ViewerTransform = { scale: 1, x: 0, y: 0 };
const STEP = 1.06;
const MAX_SCALE = 8;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** deltaY 按 120 一格折算，触控板的小步滚动也按比例走。 */
export function wheelZoom(t: ViewerTransform, deltaY: number): ViewerTransform {
  return { ...t, scale: clamp(t.scale * Math.pow(STEP, -deltaY / 120), 1, MAX_SCALE) };
}

/** 图按比例放满框（小图也放大）；还不知道原图尺寸时先占满框。 */
export function fitSize(box: Size, natural: Size): Size {
  if (!natural.width || !natural.height) return box;
  const ratio = Math.min(box.width / natural.width, box.height / natural.height);
  return { width: natural.width * ratio, height: natural.height * ratio };
}

/** 每个方向最多挪「框和放大后的图差多少」的一半：图比框小时在空白里挪，比框大时挪到看见边为止。 */
export function panWithin(t: ViewerTransform, dx: number, dy: number, box: Size, image: Size): ViewerTransform {
  const limitX = Math.abs(box.width - image.width * t.scale) / 2;
  const limitY = Math.abs(box.height - image.height * t.scale) / 2;
  return { ...t, x: clamp(t.x + dx, -limitX, limitX) || 0, y: clamp(t.y + dy, -limitY, limitY) || 0 };
}
