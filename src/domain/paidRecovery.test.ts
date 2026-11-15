import { expect, it, vi } from 'vitest';
import { attachOrphanJobs, findLostJobs, paidCardIds, recoverPaidJobs } from './paidRecovery';
import { newCard, newVideoCard } from './cards';
import type { CardNode, OrphanJob } from '@/types';

const node = (id: string, data: CardNode['data']): CardNode => ({ id, type: 'card', position: { x: 0, y: 0 }, data });
const nodes = () => [node('img', newCard('generate', 1)), node('vid', newVideoCard('generate', 2)),
  node('upload', newCard('upload', 3, [{ type: 'upload', id: 'u' }])), node('depth', newVideoCard('depth', 4))];

it('只有图片 / 视频生成卡会去查丢单', () => {
  expect(paidCardIds(nodes())).toEqual(['img', 'vid']);
});

it('丢的单接回对应卡片：种类要对得上，卡上已有的不重复加，别的卡不动', () => {
  const list = nodes(); list[1] = node('vid', { ...list[1].data, jobs: ['have'] });
  const orphans: OrphanJob[] = [{ id: 'a', cardId: 'img', kind: 'image' }, { id: 'b', cardId: 'vid', kind: 'video' }, { id: 'have', cardId: 'vid', kind: 'video' },
    { id: 'wrong-kind', cardId: 'img', kind: 'video' }, { id: 'c', cardId: 'upload', kind: 'image' }, { id: 'd', cardId: 'gone', kind: 'image' }];
  const restored = attachOrphanJobs(list, orphans);
  expect(restored.map(n => n.data.jobs)).toEqual([['a'], ['have', 'b'], [], []]);
  expect(restored[2]).toBe(list[2]); expect(restored[3]).toBe(list[3]);
  expect(attachOrphanJobs(list, [])).toEqual(list);
});

it('打开画布时按卡片查一次；查不到（小服务暂时连不上）不拦画布，原样返回', async () => {
  const find = vi.fn(async () => [{ id: 'a', cardId: 'img', kind: 'image' as const }]);
  const restored = await recoverPaidJobs('canvas', nodes(), find);
  expect(find).toHaveBeenCalledWith('canvas', ['img', 'vid']); expect(restored[0].data.jobs).toEqual(['a']);
  const list = nodes();
  expect(await recoverPaidJobs('canvas', list, async () => { throw Error('断线'); })).toEqual(list);
  const none = vi.fn(async () => []);
  await recoverPaidJobs('canvas', [list[2]], none); expect(none).not.toHaveBeenCalled();
});

it('交单报错后查一次这张卡：已经记下的单号不算，查不到当没有', async () => {
  const find = vi.fn(async () => [{ id: 'known', cardId: 'vid', kind: 'video' as const }, { id: 'lost', cardId: 'vid', kind: 'video' as const }]);
  expect(await findLostJobs('canvas', 'vid', ['known'], find)).toEqual([{ id: 'lost', cardId: 'vid', kind: 'video' }]);
  expect(find).toHaveBeenCalledWith('canvas', ['vid']);
  expect(await findLostJobs('canvas', 'vid', [], async () => { throw Error('断线'); })).toEqual([]);
});
