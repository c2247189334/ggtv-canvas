import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { api } from '@/api';
import { newVideoCard } from '@/domain/cards';
import type { CardNode } from '@/types';
import { useLocalStop } from './useLocalStop';

const graph = vi.hoisted(() => ({ nodes: [] as CardNode[] }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNode: (id: string) => graph.nodes.find(node => node.id === id) }) }));
vi.mock('@/api', () => ({ api: { stopLocalJob: vi.fn() } }));

function setup() {
  const notify = vi.fn();
  let stop!: ReturnType<typeof useLocalStop>;
  function Harness() { stop = useLocalStop(notify); return null; }
  renderToStaticMarkup(<Harness />);
  return { stop, notify };
}
beforeEach(() => {
  vi.clearAllMocks();
  graph.nodes = [{ id: 'm', type: 'card', position: { x: 0, y: 0 }, data: { ...newVideoCard('mesh', 1), depthJobId: 'job-m' } },
    { id: 'd', type: 'card', position: { x: 0, y: 0 }, data: { ...newVideoCard('depth', 2), depthJobId: 'job-d' } },
    { id: 'idle', type: 'card', position: { x: 0, y: 0 }, data: newVideoCard('depth', 3) }];
});

it('按卡找单号逐个发停止；已经结束的不报错，别的失败原话提示', async () => {
  vi.mocked(api.stopLocalJob).mockResolvedValueOnce({ status: 'stopping' })
    .mockRejectedValueOnce(Error('这单已经结束或找不到，不用停。'));
  const { stop, notify } = setup();
  await stop(['m', 'd', 'idle', 'missing']);
  expect(vi.mocked(api.stopLocalJob).mock.calls).toEqual([['job-m'], ['job-d']]);
  expect(notify).not.toHaveBeenCalled();
  vi.mocked(api.stopLocalJob).mockRejectedValueOnce(Error('连不上小服务'));
  await stop(['m']);
  expect(notify).toHaveBeenCalledWith('停止失败：连不上小服务');
});
