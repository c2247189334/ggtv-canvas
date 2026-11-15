import type { CardNode } from '@/types';
import { currentResult } from './cards';
import { CARD_WIDTH, CARD_HEIGHT, freeSpot, rightOf, type Point } from './placement';
import { measuredProductColumn } from './productRemakeLayout';
import type { RewriteRow } from './rewriteRows';

export function rewriteNodeHeight(node: CardNode): number {
  if (node.measured?.height) return node.measured.height;
  if (typeof node.height === 'number' && node.height > 0) return node.height;
  if (node.data.kind !== 'video') return CARD_HEIGHT;
  const result = currentResult(node.data);
  const [rw, rh] = node.data.video.ratio.split(':').map(Number);
  const ratio = result?.width && result.height ? result.width / result.height : rw && rh ? rw / rh : 16 / 9;
  return Math.max(CARD_HEIGHT, Math.ceil(CARD_WIDTH / ratio) + 40);
}

/** rows：一行一对（左边原片截图、右边要补的卡），origin 是左列。 */
export type RewriteColumn = { ids: string[]; movableIds: string[]; origin: Point; gap?: number; productVideoId?: string; rows?: RewriteRow[] };

/**
 * 11-11 用户定：截图和要补的卡一行一对、顶边对齐；行高按两张里高的算，行间隔 40。
 * 只用实测尺寸；这两列里别的卡（上次改写留下的）按真实边界避让，碰到哪列都整行往下挪。
 */
function measuredRewriteRows(nodes: CardNode[], column: RewriteColumn, rows: RewriteRow[]): CardNode[] | null {
  const gap = column.gap ?? 40, leftX = column.origin.x, rightX = rightOf(column.origin).x;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const height = (id: string) => byId.get(id)?.measured?.height;
  if (column.ids.some(id => !height(id) || !byId.get(id)!.measured!.width)) return null;
  const movable = new Set(column.movableIds);
  const others = nodes.filter(node => !movable.has(node.id) && node.position.x < rightX + CARD_WIDTH &&
    node.position.x + (node.measured?.width ?? node.width ?? CARD_WIDTH) > leftX);
  if (others.some(node => !node.measured?.height)) return null;
  const blocks = others.map(node => ({ top: node.position.y, bottom: node.position.y + node.measured!.height! }));
  const positions = new Map<string, Point>();
  let cursor = column.origin.y;
  for (const row of rows) {
    const tall = Math.max(...[row.left, row.right].filter((id): id is string => Boolean(id)).map(id => height(id)!));
    let y = cursor;
    for (let attempt = 0; attempt <= blocks.length; attempt++) {
      const touching = blocks.filter(block => y < block.bottom + gap && y + tall + gap > block.top);
      if (!touching.length) break;
      y = Math.max(...touching.map(block => block.bottom + gap));
    }
    if (row.left && movable.has(row.left)) positions.set(row.left, { x: leftX, y });
    if (movable.has(row.right)) positions.set(row.right, { x: rightX, y });
    cursor = y + tall + gap;
  }
  if (nodes.every(node => !positions.has(node.id) || node.position.x === positions.get(node.id)!.x && node.position.y === positions.get(node.id)!.y)) return nodes;
  return nodes.map(node => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node);
}

/** 最终排版只用画布库实测尺寸；尺寸尚未齐全就等下一次测量。 */
export function measuredRewriteColumn(nodes: CardNode[], column: RewriteColumn): CardNode[] | null {
  if (column.productVideoId) return measuredProductColumn(nodes, column);
  if (column.rows) return measuredRewriteRows(nodes, column, column.rows);
  const gap = column.gap ?? 40;
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
      if (sharesColumn(node)) cursor = Math.max(cursor, node.position.y + node.measured!.height! + gap);
      continue;
    }
    let y = cursor;
    for (let attempt = 0; attempt <= occupied.length; attempt++) {
      const touching = occupied.filter(other => y < other.position.y + other.measured!.height! + gap &&
        y + node.measured!.height! + gap > other.position.y);
      if (!touching.length) break;
      y = Math.max(...touching.map(other => other.position.y + other.measured!.height! + gap));
    }
    const position = { x: column.origin.x, y };
    positions.set(node.id, position);
    occupied.push({ ...node, position });
    cursor = y + node.measured!.height! + gap;
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
