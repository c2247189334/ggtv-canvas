import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CardNode } from '@/types';
import type { Edge } from '@xyflow/react';
import { newVideoCard, cardCounter } from '@/domain/cards';
import { useProductRemake } from './useProductRemake';
import { useVideoRewrite } from './useVideoRewrite';
import { api } from '@/api';
const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[] }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNodes: () => graph.nodes, getEdges: () => graph.edges, getNode: (id: string) => graph.nodes.find(n => n.id === id) }) }));
vi.mock('@/api', () => ({ api: { health: vi.fn(), analyzeProduct: vi.fn(), analyzeVideo: vi.fn(), extractFrame: vi.fn(), submitDepthJob: vi.fn() } }));
it('两种入口共用开跑前锁，商品预检中或拆解中不能同时发旧改写单', async () => {
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Awaited<ReturnType<typeof api.health>>);
  let resolve!: (v: Awaited<ReturnType<typeof api.analyzeProduct>>) => void;
  vi.mocked(api.analyzeProduct).mockImplementation(() => new Promise(done => { resolve = done; }));
  graph.nodes = [{ id: 'shared-source', type: 'card', position: { x: 0, y: 0 }, data: newVideoCard('upload', 0,
    [{ type: 'upload', id: 'shared-video', media: 'video', seconds: 6 }]) }]; graph.edges = [];
  let product!: ReturnType<typeof useProductRemake>, rewrite!: ReturnType<typeof useVideoRewrite>;
  function Harness() {
    const options = { canvasId: 'shared-canvas', nodes: graph.nodes, takeNumber: cardCounter(), notify: vi.fn(),
      setNodes: (update: (n: CardNode[]) => CardNode[]) => { graph.nodes = update(graph.nodes); },
      setEdges: (update: (e: Edge[]) => Edge[]) => { graph.edges = update(graph.edges); } };
    product = useProductRemake(options); rewrite = useVideoRewrite(options); return null;
  }
  renderToStaticMarkup(<Harness />);
  const pending = product.run('shared-source', '鞋子'); await rewrite.run('shared-source', '换人');
  await vi.waitFor(() => expect(api.analyzeProduct).toHaveBeenCalledTimes(1));
  await rewrite.run('shared-source', '换人');
  expect(api.extractFrame).not.toHaveBeenCalled(); expect(graph.nodes).toHaveLength(2);
  resolve({ plan: { products: [], visible: '', face: false, looks: [], timeline: [], unsure: [] }, duration: 6, targetDuration: 6, ratio: '16:9', hasAudio: false, yuan: 0 }); await pending;
});
