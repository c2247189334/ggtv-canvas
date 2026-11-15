import { beforeEach, expect, it, vi } from 'vitest';
import { useLibraryData } from './useLibraryData';
import { api } from '@/api';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effect: null as null | (() => void | (() => void)) }));
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useEffect: (effect: () => void) => { hooks.effect = effect; }
}));
vi.mock('@/api', () => ({ api: { listMediaWorks: vi.fn(), listCharacters: vi.fn() } }));
const render = () => { hooks.index = 0; return useLibraryData(0); };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  hooks.values = []; hooks.index = 0; hooks.effect = null;
  vi.stubGlobal('window', { setInterval: vi.fn(() => 4), clearInterval: vi.fn() });
  vi.mocked(api.listMediaWorks).mockReset(); vi.mocked(api.listCharacters).mockReset();
});

it('作品与人物同一轮刷新，人物失败不丢作品，5秒刷新能恢复', async () => {
  vi.mocked(api.listMediaWorks).mockResolvedValue([]);
  vi.mocked(api.listCharacters).mockRejectedValueOnce(Error('人物暂时读不到')).mockResolvedValue([]);
  render(); const dispose = hooks.effect!(); await settle();
  expect(render()).toMatchObject({ works: [], characters: null, workError: null, characterError: '人物暂时读不到' });
  expect(window.setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);
  const tick = vi.mocked(window.setInterval).mock.calls[0][0] as () => void;
  tick(); await settle();
  expect(render()).toMatchObject({ works: [], characters: [], characterError: null });
  if (typeof dispose === 'function') dispose();
  expect(window.clearInterval).toHaveBeenCalledWith(4);
});

it('卸载后迟到的清单不写状态', async () => {
  let finish!: (value: []) => void;
  vi.mocked(api.listMediaWorks).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(api.listCharacters).mockResolvedValue([]);
  render(); const dispose = hooks.effect!();
  if (typeof dispose === 'function') dispose();
  finish([]); await settle();
  expect(render()).toMatchObject({ works: null, characters: null });
});
