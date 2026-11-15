import { expect, it } from 'vitest';
import type { CardNode } from '@/types';
import { newCard, newVideoCard } from './cards';
import { groupBounds } from './groups';
import { measuredProductColumn, productLayoutNodes } from './productRemakeLayout';

const image = (id: string, group: string | null, width: number, height: number): CardNode => ({ id, type: 'card',
  position: { x: 480, y: 150 }, measured: { width, height }, data: { ...newCard('generate', 1),
    ...(group ? { group: { id: `group-${group}`, name: `商品${group}`, productId: group, videoId: 'v' } } : {}),
    productRole: { videoId: 'v', role: group ? 'product' as const : 'background' as const, ...(group ? { productId: group } : {}) } } });
const column = { ids: ['a'], movableIds: ['a'], origin: { x: 480, y: 150 }, productVideoId: 'v' };
it('按整组实测最大高度与成员宽度排位，新增角度不靠初始ids，背景最后，其他视频的卡保持原样', () => {
  const other = image('foreign', 'Z', 280, 205); other.position = { x: 2000, y: 150 }; other.data.group!.videoId = 'other';
  const nodes = [image('bg', null, 300, 250), image('b', 'B', 280, 205), image('a', 'A', 340, 500), image('a2', 'A', 280, 205), other];
  const placed = measuredProductColumn(nodes, column)!;
  const a = placed.find(n => n.id === 'a')!, a2 = placed.find(n => n.id === 'a2')!;
  expect(a.position).toEqual({ x: 480, y: 150 }); expect(a2.position).toEqual({ x: 844, y: 150 });
  const boundsA = groupBounds(placed, 'group-A')!, boundsB = groupBounds(placed, 'group-B')!;
  expect(boundsB.y - boundsA.y - boundsA.height).toBe(40);
  expect(placed.find(n => n.id === 'bg')!.position.y - boundsB.y - boundsB.height).toBe(40);
  expect(placed.find(n => n.id === 'foreign')).toBe(other);
  expect(productLayoutNodes(nodes, 'v').map(n => n.id)).toEqual(['bg', 'b', 'a', 'a2']);
  expect(measuredProductColumn(placed, column)).toBe(placed);
});
it('没收到新增组员的实测尺寸就等待，不先挪走原卡；避障也一次挪整组', () => {
  const a = image('a', 'A', 280, 205), a2 = image('a2', 'A', 280, 500);
  const missing = { ...a2, measured: undefined };
  expect(measuredProductColumn([a, missing], column)).toBeNull(); expect(a.position.y).toBe(150);
  const blocker: CardNode = { id: 'blocker', type: 'card', position: { x: 500, y: 300 },
    measured: { width: 280, height: 200 }, data: newVideoCard('upload', 0) };
  const placed = measuredProductColumn([a, a2, blocker], column)!;
  expect(placed[0].position.y).toBe(564); expect(placed[1].position.y).toBe(564); expect(placed[2]).toBe(blocker);
});
