/** 指定位置直接放；左右＋顶边对齐隔100；批量上传参考图向下找空位。 */
export type Point = { x: number; y: number };

export const CARD_WIDTH = 280;
export const CARD_HEIGHT = 320;
const GAP_X = 100;
const GAP_Y = 40;

function overlaps(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < CARD_WIDTH && Math.abs(a.y - b.y) < CARD_HEIGHT;
}

/** 从 spot 开始往下找一个不和已有卡片重叠的位置（最多挪 50 次）。 */
export function freeSpot(spot: Point, taken: readonly Point[]): Point {
  let at = { ...spot };
  for (let i = 0; i < 50 && taken.some((p) => overlaps(p, at)); i += 1) at = { x: at.x, y: at.y + CARD_HEIGHT + GAP_Y };
  return at;
}

export function rightOf(p: Point): Point {
  return { x: p.x + CARD_WIDTH + GAP_X, y: p.y };
}

export function leftOf(p: Point): Point {
  return { x: p.x - CARD_WIDTH - GAP_X, y: p.y };
}

/** 一次放好几张（比如拖进来 3 张图）：往右排开。 */
export function row(p: Point, index: number): Point {
  return { x: p.x + index * (CARD_WIDTH + GAP_Y), y: p.y };
}

/** row：从鼠标指定位置往右排，允许重叠；column：从 start 逐张往下找空位。 */
export function cardPositions(start: Point, count: number, taken: readonly Point[], layout: "row" | "column"): Point[] {
  if (layout === "row") return Array.from({ length: count }, (_, index) => row(start, index));
  const occupied = [...taken];
  return Array.from({ length: count }, () => {
    const spot = freeSpot(start, occupied);
    occupied.push(spot);
    return spot;
  });
}
