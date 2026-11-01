import type { CardNode } from '@/types';
import { currentResult } from './cards';
import { CARD_WIDTH, CARD_HEIGHT, freeSpot, type Point } from './placement';

export function rewriteNodeHeight(node: CardNode): number {
  if (node.measured?.height) return node.measured.height;
  if (typeof node.height === 'number' && node.height > 0) return node.height;
  if (node.data.kind !== 'video') return CARD_HEIGHT;
  const result = currentResult(node.data);
  const [rw, rh] = node.data.video.ratio.split(':').map(Number);
  const ratio = result?.width && result.height ? result.width / result.height : rw && rh ? rw / rh : 16 / 9;
  return Math.max(CARD_HEIGHT, Math.ceil(CARD_WIDTH / ratio) + 40);
}

export type RewriteColumn = { ids: string[]; movableIds: string[]; origin: Point };

/** 最终排版只用画布库实测尺寸；尺寸尚未齐全就等下一次测量。 */
export function measuredRewriteColumn(nodes: CardNode[], column: RewriteColumn): CardNode[] | null {
  if (!column.movableIds.length) return nodes;
  const ordered = column.ids.map(id => nodes.find(node => node.id === id));
  if (ordered.some(node => !node)) return null;
  const movable = new Set(column.movableIds);
  const measured = (node: CardNode) => Boolean(node.measured?.width && node.measured?.height);
  if (ordered.some(node => !measured(node!))) return null;
  const width = Math.max(...ordered.filter(node => movable.has(node!.id)).map(node => node!.measured!.width!));
  const sharesColumn = (node: CardNode) => node.position.x < column.origin.x + width &&
    node.position.x + (node.measured?.width ?? node.width ?? CARD_WIDTH) > column.origin.x;
  const occupied = nodes.filter(node => !movable.has(node.id) && sharesColumn(node));
  if (occupied.some(node => !measured(node))) return null;
  const positions = new Map<string, Point>();
  let cursor = column.origin.y;
  for (const raw of ordered) {
    const node = raw!;
    if (!movable.has(node.id)) {
      if (sharesColumn(node)) cursor = Math.max(cursor, node.position.y + node.measured!.height! + 40);
      continue;
    }
    let y = cursor;
    for (let attempt = 0; attempt <= occupied.length; attempt++) {
      const touching = occupied.filter(other => y < other.position.y + other.measured!.height! + 40 &&
        y + node.measured!.height! + 40 > other.position.y);
      if (!touching.length) break;
      y = Math.max(...touching.map(other => other.position.y + other.measured!.height! + 40));
    }
    const position = { x: column.origin.x, y };
    positions.set(node.id, position);
    occupied.push({ ...node, position });
    cursor = y + node.measured!.height! + 40;
  }
  if (nodes.every(node => !positions.has(node.id) || node.position.x === positions.get(node.id)!.x && node.position.y === positions.get(node.id)!.y)) return nodes;
  return nodes.map(node => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node);
}

/** 沿用 freeSpot 的向下找空位，再按媒体实际尺寸补足碰撞和40像素间隔。 */
export function rewriteSpot(start: Point, nodes: readonly CardNode[], height = CARD_HEIGHT): Point {
  let at = freeSpot(start, nodes.map(node => node.position));
  for (let index = 0; index <= nodes.length; index++) {
    const touching = nodes.filter(node => {
      const width = node.measured?.width ?? node.width ?? CARD_WIDTH;
      return at.x < node.position.x + width && at.x + CARD_WIDTH > node.position.x &&
        at.y < node.position.y + rewriteNodeHeight(node) + 40 && at.y + height + 40 > node.position.y;
    });
    if (!touching.length) return at;
    at = { ...at, y: Math.max(...touching.map(node => node.position.y + rewriteNodeHeight(node) + 40)) };
  }
  return at;
}
