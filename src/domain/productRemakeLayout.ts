import type { CardNode } from '@/types';
import { CARD_WIDTH, CARD_HEIGHT } from './placement';
import type { RewriteColumn } from './videoRewriteLayout';

/** 每次取完整商品列；新增角度、商品和背景也属于同一次排位。 */
export function productLayoutNodes(nodes: CardNode[], videoId: string): CardNode[] {
  return nodes.filter(node => node.data.kind === 'image' && (node.data.group?.productId
    ? node.data.group.videoId === videoId : node.data.productRole?.videoId === videoId));
}
type Rect = { x: number; y: number; width: number; height: number };
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const ordinal = (id: string) => [...id].reduce((sum, c) => sum * 26 + c.charCodeAt(0) - 64, 0);

/** 商品组是一个排位单元：成员横排，框外扩24；背景排在所有组之后。 */
export function measuredProductColumn(nodes: CardNode[], column: RewriteColumn): CardNode[] | null {
  const members = productLayoutNodes(nodes, column.productVideoId!);
  if (!members.length) return nodes;
  if (members.some(n => !n.measured?.width || !n.measured?.height)) return null;
  const rows = new Map<string, { cards: CardNode[]; order: number; margin: number }>();
  for (const node of members) {
    if (node.data.kind !== 'image') continue;
    const group = node.data.group?.productId && node.data.group.videoId === column.productVideoId ? node.data.group : null;
    const background = node.data.productRole?.role === 'background';
    const key = group ? `group:${group.id}` : `card:${node.id}`;
    const row = rows.get(key) ?? { cards: [], order: background ? Infinity : ordinal(group?.productId ?? node.data.productRole?.productId ?? 'A'), margin: group ? 24 : 0 };
    row.cards.push(node); rows.set(key, row);
  }
  const ordered = [...rows.values()].sort((a, b) => a.order - b.order);
  const ids = new Set(members.map(n => n.id));
  const occupied = nodes.filter(n => !ids.has(n.id)).map(n => {
    const margin = n.data.group ? 24 : 0;
    return { x: n.position.x - margin, y: n.position.y - margin,
      width: (n.measured?.width ?? n.width ?? CARD_WIDTH) + margin * 2,
      height: (n.measured?.height ?? n.height ?? CARD_HEIGHT) + margin * 2 };
  });
  const positions = new Map<string, CardNode['position']>();
  const gap = column.gap ?? 40;
  let cursor = column.origin.y - ordered[0].margin;
  for (const row of ordered) {
    const cards = [...row.cards].sort((a, b) => a.position.x - b.position.x);
    const rect = { x: column.origin.x - row.margin, y: cursor,
      width: cards.reduce((sum, n) => sum + n.measured!.width!, 0) + (cards.length - 1) * 24 + row.margin * 2,
      height: Math.max(...cards.map(n => n.measured!.height!)) + row.margin * 2 };
    for (let attempt = 0; attempt <= occupied.length; attempt++) {
      const touching = occupied.filter(other => intersects(rect, other));
      if (!touching.length) break;
      rect.y = Math.max(...touching.map(other => other.y + other.height + gap));
    }
    let x = column.origin.x;
    for (const node of cards) {
      positions.set(node.id, { x, y: rect.y + row.margin });
      x += node.measured!.width! + 24;
    }
    cursor = rect.y + rect.height + gap;
  }
  if (members.every(n => n.position.x === positions.get(n.id)!.x && n.position.y === positions.get(n.id)!.y)) return nodes;
  return nodes.map(n => positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n);
}
