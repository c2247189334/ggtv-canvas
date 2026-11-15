import { afterEach, expect, it, vi } from 'vitest';
import { loadWorkDeletion } from './workDeletion';
import { workDeleteText } from '@/domain/characters';
import type { CharacterView } from '@/characterTypes';
import type { MediaWorkView } from '@/types';

const person = (name: string, type: 'work' | 'upload' = 'work'): CharacterView => ({ id: name, name, description: '', createdAt: '', updatedAt: '', status: 'ready',
  images: [{ ref: { type, id: 'w' }, label: '图 1', video: { status: 'photo' } }] });
const work = { id: 'w', kind: 'image' } as MediaWorkView;
afterEach(() => vi.unstubAllGlobals());

it('作品删除提示列出所有用到这张作品的人物，上传同号不误认', () => {
  const base = '删掉这件作品？硬盘上的文件会一起删掉，画布上用到它的卡片会显示「作品已删除」。';
  expect(workDeleteText('other', [person('甲')])).toBe(base);
  expect(workDeleteText('w', [person('甲'), person('乙'), person('上传', 'upload')])).toBe(
    base + '它是人物「甲」的图，人物里也会少这张。它是人物「乙」的图，人物里也会少这张。');
});

it('每次点击删除都重读人物清单再形成确认，失败保留服务原话', async () => {
  let list: CharacterView[] = [];
  const fetcher = vi.fn(async () => new Response(JSON.stringify(list)));
  vi.stubGlobal('fetch', fetcher);
  expect((await loadWorkDeletion(work)).text).not.toContain('它是人物');
  list = [person('新存的人物')];
  expect((await loadWorkDeletion(work)).text).toContain('它是人物「新存的人物」的图，人物里也会少这张。');
  expect(fetcher.mock.calls).toHaveLength(2);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '人物清单读取失败原话' }), { status: 500 })));
  await expect(loadWorkDeletion(work)).rejects.toThrow('人物清单读取失败原话');
});
