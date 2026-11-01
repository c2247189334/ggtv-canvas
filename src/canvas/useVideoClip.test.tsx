import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Edge } from '@xyflow/react';
import type { CardNode, Health } from '@/types';
import { api } from '@/api';
import { newVideoCard } from '@/domain/cards';
import { useVideoClip } from './useVideoClip';

const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[], effects: [] as Array<() => void | (() => void)>,
  state: [] as unknown[], refs: [] as Array<{ current: unknown }>, cursor: 0, refCursor: 0 }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = graph.cursor++;
    if (!(i in graph.state)) graph.state[i] = typeof initial === 'function' ? initial() : initial;
    return [graph.state[i], (value: unknown) => { graph.state[i] = typeof value === 'function' ? value(graph.state[i]) : value; }];
  },
  useRef: (value: unknown) => { const i = graph.refCursor++; return graph.refs[i] ?? (graph.refs[i] = { current: value }); },
  useEffect: (effect: () => void | (() => void)) => { graph.effects.push(effect); }
}));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNode: (id: string) => graph.nodes.find(n => n.id === id), getNodes: () => graph.nodes }) }));
vi.mock('@/api', () => ({ api: { health: vi.fn(), clipVideo: vi.fn() } }));

function setup() {
  graph.nodes = [{ id: 'source', type: 'card', selected: true, position: { x: 10, y: 20 },
    data: newVideoCard('upload', 0, [{ type: 'upload', id: 'video', media: 'video', seconds: 9 }]) }];
  graph.edges = []; graph.state = []; graph.refs = []; graph.effects = [];
  const notify = vi.fn(); let actions!: ReturnType<typeof useVideoClip>;
  function Harness() {
    actions = useVideoClip({ canvasId: 'c', nodes: graph.nodes, setNodes: update => { graph.nodes = update(graph.nodes); },
      setEdges: update => { graph.edges = update(graph.edges); }, notify });
    return null;
  }
  const render = () => { graph.cursor = 0; graph.refCursor = 0; renderToStaticMarkup(<Harness />); };
  render();
  return { get actions() { return actions; }, render, notify, effects: () => { for (const effect of graph.effects.splice(0)) effect(); } };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Health);
  vi.mocked(api.clipVideo).mockResolvedValue({ id: 'clip', kind: 'video', duration: 3, width: 864, height: 480, fps: 30, hasAudio: true });
});
it('缺ffmpeg不开剪辑条，复用原声原话；假模式不挡；只接受单选有内容的非深度视频', async () => {
  const h = setup(); vi.mocked(api.health).mockResolvedValueOnce({ fake: false, ffmpegFound: false } as Health);
  await h.actions.start('source'); h.render();
  expect(h.actions.session).toBeNull(); expect(h.notify).toHaveBeenCalledWith('没找到 ffmpeg，请先配置 ffmpeg，再重试。');
  await h.actions.start('source'); h.render(); expect(h.actions.session?.cardId).toBe('source');
  h.actions.close(); h.render(); graph.nodes[0].data.results[0].seconds = 0.9;
  await h.actions.start('source'); h.render(); expect(h.actions.session).toBeNull();
  graph.nodes[0].data.results[0].seconds = 9; graph.nodes[0].data.results[0].depth = true;
  await h.actions.start('source'); h.render(); expect(h.actions.session).toBeNull();
  delete graph.nodes[0].data.results[0].depth; graph.nodes[0].selected = false;
  await h.actions.start('source'); h.render(); expect(h.actions.session).toBeNull();
});
it('打开、退出不建卡，取消选中关闭；失败不建卡、保留剪辑条并提示原话', async () => {
  const h = setup(); await h.actions.start('source'); h.render(); h.actions.close(); h.render();
  expect(h.actions.session).toBeNull(); expect(graph.nodes).toHaveLength(1); expect(api.clipVideo).not.toHaveBeenCalled();
  await h.actions.start('source'); h.render(); graph.nodes[0].selected = false; h.effects(); h.render();
  expect(h.actions.session).toBeNull();
  graph.nodes[0].selected = true; await h.actions.start('source'); h.render();
  vi.mocked(api.clipVideo).mockRejectedValueOnce(new Error('截取失败中文原话'));
  await h.actions.confirm({ start: 1, end: 4 }); h.render();
  expect(h.actions.session).not.toBeNull(); expect(h.actions.busy).toBe(false);
  expect(graph.nodes).toHaveLength(1); expect(graph.edges).toHaveLength(0); expect(h.notify).toHaveBeenCalledWith('截取失败中文原话');
});
it('处理中关闭和取消选中不起作用、不重复提交；结果仍建卡连线，只选中新卡，关闭剪辑条', async () => {
  const h = setup(); await h.actions.start('source'); h.render();
  let resolve!: (value: Awaited<ReturnType<typeof api.clipVideo>>) => void;
  vi.mocked(api.clipVideo).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const task = h.actions.confirm({ start: 1, end: 4 }); h.render();
  expect(h.actions.busy).toBe(true); h.actions.close(); graph.nodes[0].selected = false; h.effects(); h.render();
  expect(h.actions.session).not.toBeNull();
  await h.actions.confirm({ start: 1, end: 4 }); expect(api.clipVideo).toHaveBeenCalledTimes(1);
  resolve({ id: 'clip', kind: 'video', duration: 3, width: 864, height: 480, fps: 30, hasAudio: true }); await task; h.render();
  expect(api.clipVideo).toHaveBeenCalledWith({ source: { type: 'upload', id: 'video' }, start: 1, end: 4, canvasId: 'c', cardId: 'source' });
  expect(graph.nodes).toHaveLength(2); expect(graph.edges).toHaveLength(1);
  expect(graph.nodes.filter(n => n.selected).map(n => n.id)).toEqual([graph.nodes[1].id]);
  expect(graph.nodes[1].data).toMatchObject({ source: 'upload', title: '剪辑', mediaSource: { id: 'video' } });
  expect(h.actions.session).toBeNull(); expect(h.actions.busy).toBe(false);
});
it('预检期间来源结果已切换就不开旧结果的剪辑会话', async () => {
  const h = setup(); let resolve!: (health: Health) => void;
  vi.mocked(api.health).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const task = h.actions.start('source');
  graph.nodes = [{ ...graph.nodes[0], data: { ...graph.nodes[0].data, results: [{ type: 'upload', id: 'changed', media: 'video', seconds: 12 }] } }];
  resolve({ fake: true } as Health); await task; h.render();
  expect(h.actions.session).toBeNull();
});
