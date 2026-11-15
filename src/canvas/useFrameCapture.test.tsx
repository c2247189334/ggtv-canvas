import { beforeEach, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { CardNode, Health } from '@/types';
import { api } from '@/api';
import { newVideoCard } from '@/domain/cards';
import { useFrameCapture } from './useFrameCapture';

const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[] }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNode: (id: string) => graph.nodes.find(n => n.id === id), getNodes: () => graph.nodes }) }));
vi.mock('@/api', () => ({ api: { health: vi.fn(), extractFrame: vi.fn() } }));

function setup() {
  graph.nodes = [{ id: 'source', type: 'card', selected: true, position: { x: 10, y: 20 },
    data: newVideoCard('upload', 0, [{ type: 'upload', id: 'video', media: 'video', seconds: 9 }]) }];
  graph.edges = [];
  const notify = vi.fn();
  const capture = useFrameCapture({ setNodes: update => { graph.nodes = update(graph.nodes); },
    setEdges: update => { graph.edges = update(graph.edges); }, notify });
  return { capture, notify };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Health);
  let n = 0;
  vi.mocked(api.extractFrame).mockImplementation(async () => ({ id: `frame-${++n}`, kind: 'image' }));
});

it('截当前帧：按播放器时间截，建一张截图卡连线，视频卡保持选中、新卡不选中，提示已截取', async () => {
  const h = setup();
  await h.capture('source', 'current', { time: 4.524, duration: 9 });
  expect(api.extractFrame).toHaveBeenCalledWith({ source: { type: 'upload', id: 'video' }, second: 4.524 });
  expect(graph.nodes).toHaveLength(2); expect(graph.edges).toEqual([{ id: `link:source>${graph.nodes[1].id}`, source: 'source', target: graph.nodes[1].id }]);
  expect(graph.nodes.filter(n => n.selected).map(n => n.id)).toEqual(['source']);
  expect(graph.nodes[1].data).toMatchObject({ kind: 'image', source: 'upload', title: '截图 00:04.524', results: [{ type: 'upload', id: 'frame-1' }] });
  expect(h.notify).toHaveBeenCalledWith('截图 00:04.524已截取，并添加到画布');
});

it('首帧截 0 秒、尾帧截时长减 0.05 秒；连着截往右下错开 30', async () => {
  const h = setup();
  await h.capture('source', 'first', { time: 3, duration: 9 });
  await h.capture('source', 'last', { time: 3, duration: 9 });
  expect(vi.mocked(api.extractFrame).mock.calls.map(([input]) => input.second)).toEqual([0, 8.95]);
  expect(graph.nodes.slice(1).map(n => n.data.title)).toEqual(['首帧', '尾帧']);
  const [first, last] = graph.nodes.slice(1).map(n => n.position);
  expect({ x: last.x - first.x, y: last.y - first.y }).toEqual({ x: 30, y: 30 });
  expect(h.notify).toHaveBeenLastCalledWith('尾帧已截取，并添加到画布');
});

it('读不到时长不截尾帧；缺 ffmpeg 先拦；截帧失败提示原话、不建卡', async () => {
  const h = setup(); delete graph.nodes[0].data.results[0].seconds;
  await h.capture('source', 'last', { time: 0, duration: Number.NaN });
  expect(h.notify).toHaveBeenCalledWith('视频还没加载好，暂时截不了尾帧，请稍后再试。');
  vi.mocked(api.health).mockResolvedValueOnce({ fake: false, ffmpegFound: false } as Health);
  await h.capture('source', 'current', { time: 2, duration: 9 });
  expect(h.notify).toHaveBeenCalledWith('没找到 ffmpeg，请先配置 ffmpeg，再重试。');
  vi.mocked(api.extractFrame).mockRejectedValueOnce(new Error('截帧秒数要在视频时长内。'));
  await h.capture('source', 'current', { time: 2, duration: 9 });
  expect(h.notify).toHaveBeenLastCalledWith('截帧秒数要在视频时长内。');
  expect(api.extractFrame).toHaveBeenCalledTimes(1);
  expect(graph.nodes).toHaveLength(1); expect(graph.edges).toHaveLength(0);
});

it('卡不在了、不是视频或没有视频结果都不截', async () => {
  const h = setup();
  await h.capture('missing', 'current', { time: 1, duration: 9 });
  graph.nodes[0].data.results = [];
  await h.capture('source', 'current', { time: 1, duration: 9 });
  expect(api.health).not.toHaveBeenCalled(); expect(api.extractFrame).not.toHaveBeenCalled();
});
