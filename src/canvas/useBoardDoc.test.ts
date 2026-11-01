import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { newVideoCard } from '@/domain/cards';
import { useBoardDoc } from './useBoardDoc';
import type { CanvasDoc, LocalJobView } from '@/types';

// 无DOM环境下的确定性hook驱动；真正的读档、恢复、保存控制器均直接执行。
const hooks = vi.hoisted(() => {
  type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void; setter?: (value: unknown) => void };
  const slots: Slot[] = [], effects: Array<() => void> = [];
  let cursor = 0;
  const state = (initial: unknown) => {
    const index = cursor++, slot = slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
    slot.value ??= initial;
    slot.setter ??= (next: unknown) => { slot.value = typeof next === 'function' ? next(slot.value) : next; };
    return [slot.value, slot.setter];
  };
  const memo = (fn: () => unknown, deps: unknown[]) => {
    const index = cursor++, old = slots[index];
    if (old && deps.every((d, i) => Object.is(d, old.deps?.[i]))) return old.value;
    const value = fn(); slots[index] = { value, deps }; return value;
  };
  return { slots, effects, state, memo,
    start: () => { cursor = 0; },
    unmount: () => { for (const slot of slots) slot.cleanup?.(); slots.length = 0; effects.length = 0; },
    ref: (value: unknown) => { const index = cursor++; return (slots[index] ??= { value: { current: value } }).value; },
    effect: (fn: () => void | (() => void), deps: unknown[]) => {
      const index = cursor++, old = slots[index];
      if (old && deps.every((d, i) => Object.is(d, old.deps?.[i]))) return;
      const slot: Slot = { deps }; slots[index] = slot;
      effects.push(() => { old?.cleanup?.(); const cleanup = fn(); if (cleanup) slot.cleanup = cleanup; });
    }
  };
});
vi.mock('react', () => ({ useState: hooks.state, useRef: hooks.ref, useMemo: hooks.memo,
  useCallback: (fn: unknown, deps: unknown[]) => hooks.memo(() => fn, deps), useEffect: hooks.effect }));
vi.mock('@xyflow/react', () => ({
  useNodesState: (initial: unknown) => [...hooks.state(initial), vi.fn()],
  useEdgesState: (initial: unknown) => [...hooks.state(initial), vi.fn()]
}));
vi.mock('@/api', () => ({ api: { getCanvas: vi.fn(), saveCanvas: vi.fn(), findLocalJobs: vi.fn() } }));
const notify = vi.fn(); let beforeUnload: (() => void) | undefined;
function render(id = 'canvas') {
  hooks.start(); const board = useBoardDoc(id, '测试画布', notify);
  for (const effect of hooks.effects.splice(0)) effect(); return board;
}
async function loaded(id = 'canvas') {
  render(id);
  for (let i = 0; i < 30; i++) { await Promise.resolve(); const board = render(id); if (board.ready || board.loadError) return board; }
  return render(id);
}
const empty = (id = 'canvas'): CanvasDoc => ({ id, name: '测试画布', version: 0, nodes: [], edges: [] });
beforeEach(() => {
  hooks.unmount(); vi.clearAllMocks(); vi.useFakeTimers(); beforeUnload = undefined;
  vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: (name: string, fn: () => void) => { if (name === 'beforeunload') beforeUnload = fn; }, removeEventListener: vi.fn() });
  vi.mocked(api.getCanvas).mockResolvedValue(empty()); vi.mocked(api.saveCanvas).mockResolvedValue({ ok: true, updatedAt: '', version: 1 });
  vi.mocked(api.findLocalJobs).mockResolvedValue([]);
});
afterEach(() => { hooks.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('读档接回缺单号任务后才展示画布，并能把找回的单号自动保存', async () => {
  vi.mocked(api.getCanvas).mockResolvedValue({ ...empty(), nodes: [{ id: 'child', x: 0, y: 0,
    data: { ...newVideoCard('depth', 1), startedAt: '2026-10-31T12:00:00Z' } }] });
  vi.mocked(api.findLocalJobs).mockResolvedValue([{ id: 'job', cardId: 'child', kind: 'depth', status: 'running' } as LocalJobView]);
  const board = await loaded(); expect(board.ready).toBe(true);
  expect(api.findLocalJobs).toHaveBeenCalledWith('canvas', ['child']); expect(board.nodes[0].data.depthJobId).toBe('job');
  await vi.advanceTimersByTimeAsync(800); expect(api.saveCanvas).toHaveBeenCalledWith(expect.objectContaining({ baseVersion: 0,
    nodes: [expect.objectContaining({ data: expect.objectContaining({ depthJobId: 'job' }) })] }), undefined);
});

it('409后停止自动及离开保存，切走再回到这张画布仍须先刷新页面', async () => {
  const id = 'conflicted-canvas'; vi.mocked(api.getCanvas).mockResolvedValue(empty(id));
  vi.mocked(api.saveCanvas).mockRejectedValue(Object.assign(Error('冲突'), { status: 409 }));
  let board = await loaded(id); board.setNodes(() => [{ id: 'child', type: 'card', position: { x: 0, y: 0 }, data: newVideoCard('generate', 1) }]);
  render(id); await vi.advanceTimersByTimeAsync(800);
  expect(notify).toHaveBeenCalledWith('这张画布在别的标签页改过了，刷新页面后再继续改');
  beforeUnload?.(); expect(api.saveCanvas).toHaveBeenCalledTimes(1);
  hooks.unmount(); board = await loaded(id);
  board.setNodes(() => [{ id: 'later', type: 'card', position: { x: 0, y: 0 }, data: newVideoCard('generate', 2) }]);
  render(id); await vi.advanceTimersByTimeAsync(800); beforeUnload?.(); await Promise.resolve();
  expect(api.saveCanvas).toHaveBeenCalledTimes(1);
});

const pendingNodes = (count: number): CanvasDoc['nodes'] => Array.from({ length: count }, (_, i) => ({ id: `child-${i}`, x: i * 300, y: 0,
  data: { ...newVideoCard('depth', i + 1), startedAt: '2026-10-31T12:00:00Z' } }));
const running = (id: string): LocalJobView => ({ id: `job-${id}`, cardId: id, kind: 'depth', status: 'running', count: 1,
  createdAt: '', phase: 'processing', works: [], error: null, errorCode: null, source: { type: 'upload', id: 'u' }, resolution: '480p' });

it('恢复查询失败仍打开有效卡线，保存临时状态后下次读档可以再次接回任务', async () => {
  const doc = { ...empty('recovery-failure'), nodes: pendingNodes(2), edges: [{ id: 'link', source: 'child-0', target: 'child-1' }] };
  vi.mocked(api.getCanvas).mockResolvedValue(doc); vi.mocked(api.findLocalJobs).mockRejectedValueOnce(Error('本机请求暂时失败'));
  let board = await loaded(doc.id); expect(board.ready).toBe(true); expect(board.loadError).toBeNull();
  expect(board.nodes).toHaveLength(2); expect(board.edges).toEqual(doc.edges);
  expect(board.nodes[0].data).toMatchObject({ note: '暂时查不到本机任务记录，请刷新页面重试', startedAt: '2026-10-31T12:00:00Z' });
  await vi.advanceTimersByTimeAsync(800); const saved = vi.mocked(api.saveCanvas).mock.calls[0][0];
  hooks.unmount(); vi.mocked(api.getCanvas).mockResolvedValue({ ...saved, version: 1 });
  vi.mocked(api.findLocalJobs).mockImplementation(async (_, ids) => ids.map(running));
  board = await loaded(doc.id); expect(board.ready).toBe(true); expect(board.nodes[0].data).toMatchObject({ depthJobId: 'job-child-0', note: null });
  expect(api.findLocalJobs).toHaveBeenCalledTimes(2);
});

it('201张待恢复卡按200与1分批，所有返回任务均接回，不把第201张误判成不存在', async () => {
  const doc = { ...empty('recovery-201'), nodes: pendingNodes(201) };
  vi.mocked(api.getCanvas).mockResolvedValue(doc);
  vi.mocked(api.findLocalJobs).mockImplementation(async (_, ids) => ids.slice(0, 200).map(running));
  const board = await loaded(doc.id); expect(board.ready).toBe(true);
  expect(api.findLocalJobs).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.findLocalJobs).mock.calls.map(([, ids]) => ids.length)).toEqual([200, 1]);
  expect(board.nodes.every(node => node.data.depthJobId && !node.data.note)).toBe(true);
  expect(board.nodes[200].data.depthJobId).toBe('job-child-200');
});

it('第二批查询失败只让该批暂不可查，已成功的200张不丢单号，未返回卡保留重查标记', async () => {
  vi.mocked(api.getCanvas).mockResolvedValue({ ...empty('recovery-partial'), nodes: pendingNodes(201) });
  vi.mocked(api.findLocalJobs).mockImplementationOnce(async (_, ids) => ids.slice(0, 200).map(running)).mockRejectedValueOnce(Error('第二批暂不可查'));
  const board = await loaded('recovery-partial'); expect(board.ready).toBe(true); expect(board.loadError).toBeNull();
  expect(board.nodes.slice(0, 200).every(node => node.data.depthJobId && !node.data.note)).toBe(true);
  expect(board.nodes[200].data).toMatchObject({ note: '暂时查不到本机任务记录，请刷新页面重试', startedAt: '2026-10-31T12:00:00Z' });
});
