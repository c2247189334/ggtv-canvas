import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Edge } from '@xyflow/react';
import type { CardNode, Health } from '@/types';
import { newVideoCard, cardCounter } from '@/domain/cards';
import { useProductRemake } from './useProductRemake';
import { api } from '@/api';
import { agentNeededProblem, closeAgentNeeded } from '@/common/agentNeeded';
const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[] }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNodes: () => graph.nodes, getEdges: () => graph.edges,
  getNode: (id: string) => graph.nodes.find(n => n.id === id) }) }));
vi.mock('@/api', () => ({ api: { health: vi.fn(), analyzeProduct: vi.fn() } }));
const plan = { products: [{ id: 'A', name: '鞋子', look: '旧鞋', pairs: 1, pieces: 2, layout: '脚上' }],
  visible: '手和腿', face: false, looks: [], timeline: [{ from: 0, to: 6, action: '迈步' }], unsure: [] };
function setup(seconds = 6) {
  graph.nodes = [{ id: 'source', type: 'card', position: { x: 0, y: 0 }, selected: true, data: newVideoCard('upload', 0,
    [{ type: 'upload', id: 'original', media: 'video', seconds, width: 720, height: 1280, hasAudio: true }]) }]; graph.edges = [];
  const notify = vi.fn(), focus = vi.fn(), layout = vi.fn(); let actions!: ReturnType<typeof useProductRemake>;
  function Harness() { actions = useProductRemake({ canvasId: 'c', nodes: graph.nodes,
    setNodes: update => { graph.nodes = update(graph.nodes); }, setEdges: update => { graph.edges = update(graph.edges); },
    takeNumber: cardCounter(), notify, focus, layout }); return null; }
  renderToStaticMarkup(<Harness />); return { actions, notify, focus, layout };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(api.health).mockResolvedValue({ fake: true } as Health);
  vi.mocked(api.analyzeProduct).mockResolvedValue({ plan, duration: 6, targetDuration: 6, ratio: '9:16', hasAudio: true, yuan: 0 });
});
it('预检缺项/来源越界不建卡不调AI，开拆只查ffmpeg（Key/TOS 出片才拦），原话保留', async () => {
  vi.mocked(api.health).mockResolvedValue({ fake: false, keyReady: false, tosReady: false, ffmpegFound: false, agentReady: true } as Health);
  const { actions } = setup();
  expect(await actions.run('source', '鞋子')).toContain('ffmpeg'); expect(graph.nodes).toHaveLength(1); expect(api.analyzeProduct).not.toHaveBeenCalled();
  // 11-15 用户定：拆解只走本机 agent；没配好弹说明框，不建卡、不调 AI。
  vi.mocked(api.health).mockResolvedValue({ fake: false, keyReady: true, tosReady: true, ffmpegFound: true, agentReady: false, agentProblem: '本机 Codex 没配好：在终端跑一次 codex login。' } as Health);
  expect(await setup().actions.run('source', '鞋子')).toBeUndefined();
  expect(agentNeededProblem()).toBe('本机 Codex 没配好：在终端跑一次 codex login。'); closeAgentNeeded();
  expect(graph.nodes).toHaveLength(1); expect(api.analyzeProduct).not.toHaveBeenCalled();
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Health);
  const invalid = setup(31); expect(await invalid.actions.run('source', '鞋子')).toContain('4 到 30'); expect(graph.nodes).toHaveLength(1);
});
it('先放空输出/原卡转圈，同来源并发锁，完成铺组、选中输出和定位，无自动出图', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof api.analyzeProduct>>) => void;
  vi.mocked(api.analyzeProduct).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { actions, focus, layout } = setup(); const pending = actions.run('source', '鞋子');
  await vi.waitFor(() => expect(api.analyzeProduct).toHaveBeenCalledTimes(1));
  expect(graph.nodes).toHaveLength(2); expect(graph.nodes[0].data.rewriteBusy).toBe('analyzing');
  const out = graph.nodes[1]; expect(out.data.rewriteStatus).toEqual({ status: 'pending' });
  await actions.run('source', '鞋子'); expect(api.analyzeProduct).toHaveBeenCalledTimes(1);
  resolve({ plan, duration: 6, targetDuration: 6, ratio: '9:16', hasAudio: true, yuan: 0 }); await pending;
  expect(graph.nodes.filter(n => n.selected).map(n => n.id)).toEqual([out.id]); expect(graph.nodes).toHaveLength(3);
  expect(graph.edges).toHaveLength(2); expect(focus).toHaveBeenCalledWith(out.id); expect(layout).toHaveBeenCalled();
  expect(graph.nodes[0].data).not.toHaveProperty('rewriteBusy'); expect(graph.nodes[1].data.prompt).toBe('');
});
it('失败原话留在两卡、不写金额，不重试，再点复用失败输出', async () => {
  vi.mocked(api.analyzeProduct).mockRejectedValueOnce(Object.assign(Error('假拆解失败'), { yuan: 0.023 }));
  const { actions, notify } = setup(); await actions.run('source', '鞋子'); const outputId = graph.nodes[1].id;
  expect(graph.nodes[0].data.rewriteStatus).toEqual({ status: 'failed', error: '假拆解失败' });
  expect(graph.nodes[1].data.rewriteStatus).toEqual(graph.nodes[0].data.rewriteStatus);
  expect(notify.mock.calls.at(-1)?.[0]).toBe('拆解没成功：假拆解失败'); expect(api.analyzeProduct).toHaveBeenCalledTimes(1);
  await actions.run('source', '鞋子'); expect(graph.nodes.find(n => n.data.kind === 'video' && n.data.source === 'generate')!.id).toBe(outputId);
});
it('处理中删卡不复活、不铺孤立商品组', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof api.analyzeProduct>>) => void;
  vi.mocked(api.analyzeProduct).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { actions } = setup(); const pending = actions.run('source', '鞋子');
  await vi.waitFor(() => expect(api.analyzeProduct).toHaveBeenCalled()); graph.nodes = []; graph.edges = [];
  resolve({ plan, duration: 6, targetDuration: 6, ratio: '9:16', hasAudio: true, yuan: 0 }); await pending;
  expect(graph.nodes).toEqual([]); expect(graph.edges).toEqual([]);
});
