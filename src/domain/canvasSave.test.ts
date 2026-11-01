import { expect, it, vi } from 'vitest';
import { createCanvasSaver } from './canvasSave';
import { api } from '@/api';
import type { CanvasDoc } from '@/types';
const doc = (name: string): CanvasDoc => ({ id: 'c', name, nodes: [], edges: [] });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

it('快速变动与离开保存都串行，下一次用上次成功版本并保留keepalive', async () => {
  const first = deferred<{ version: number }>(), save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ version: 9 });
  const notify = vi.fn(), saver = createCanvasSaver({ initial: doc('最初'), version: 7, save, notify });
  saver.update(doc('第一次')); const running = saver.save();
  saver.update(doc('最后一次')); const leaving = saver.save({ keepalive: true, silent: true });
  expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0].baseVersion).toBe(7);
  first.resolve({ version: 8 }); await Promise.all([running, leaving]);
  expect(save).toHaveBeenCalledTimes(2); expect(save.mock.calls[1]).toEqual([{ ...doc('最后一次'), baseVersion: 8 }, true]);
  expect(notify).not.toHaveBeenCalled();
  await saver.save(); expect(save).toHaveBeenCalledTimes(2);
});

it('409提示后锁定这个标签；自动保存、离开保存都不能再次写', async () => {
  const save = vi.fn().mockRejectedValue(Object.assign(Error('冲突'), { status: 409 })), notify = vi.fn();
  const saver = createCanvasSaver({ initial: doc('最初'), version: 0, save, notify });
  saver.update(doc('有改动')); await saver.save();
  expect(saver.blocked).toBe(true); expect(notify).toHaveBeenCalledWith('这张画布在别的标签页改过了，刷新页面后再继续改');
  saver.update(doc('再改动')); await saver.save(); await saver.save({ keepalive: true, silent: true });
  expect(save).toHaveBeenCalledTimes(1); expect(notify).toHaveBeenCalledTimes(1);
});

it('普通网络错误不锁标签，手动再次触发能保存未成功内容', async () => {
  const save = vi.fn().mockRejectedValueOnce(Error('离线')).mockResolvedValue({ version: 1 }), notify = vi.fn();
  const saver = createCanvasSaver({ initial: doc('最初'), version: 0, save, notify });
  saver.update(doc('改过')); await saver.save(); expect(saver.blocked).toBe(false);
  expect(notify).toHaveBeenCalledWith('画布没存上：离线');
  await saver.save({ keepalive: true }); expect(save.mock.calls[1][0].baseVersion).toBe(0);
});

it('API抛错保留HTTP409，保存请求确实带baseVersion', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: '冲突' }), { status: 409 }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    await expect(api.saveCanvas({ ...doc('x'), baseVersion: 3 })).rejects.toMatchObject({ status: 409 });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ baseVersion: 3 });
  } finally { vi.unstubAllGlobals(); }
});

it('同一事件中先检查未改动内容再离开，后一次真正改动不能丢在已结束队列里', async () => {
  const save = vi.fn().mockResolvedValue({ version: 1 }), saver = createCanvasSaver({ initial: doc('原始'), version: 0, save, notify: vi.fn() });
  const idle = saver.save(); saver.update(doc('离开前修改')); const leave = saver.save({ keepalive: true });
  await Promise.all([idle, leave]); expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]).toEqual([{ ...doc('离开前修改'), baseVersion: 0 }, true]);
});
