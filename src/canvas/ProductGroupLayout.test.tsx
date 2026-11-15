import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Edge } from '@xyflow/react';
import type { CardNode, Health } from '@/types';
import { api } from '@/api';
import { newVideoCard, cardCounter } from '@/domain/cards';
import { groupBounds } from '@/domain/groups';
import { toDoc } from '@/domain/canvasDoc';
import { useProductRemake } from './useProductRemake';
import { useMeasuredRewriteLayout } from './useMeasuredRewriteLayout';

const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[], refs: [] as Array<{ current: unknown }>,
  index: 0, effects: [] as Array<() => void> }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useRef: (initial: unknown) => { const index = graph.index++; return graph.refs[index] ??= { current: initial }; },
  useLayoutEffect: (effect: () => void) => { graph.effects.push(effect); }
}));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNodes: () => graph.nodes, getEdges: () => graph.edges,
  getNode: (id: string) => graph.nodes.find(n => n.id === id) }) }));
vi.mock('@/api', () => ({ api: { health: vi.fn(), analyzeProduct: vi.fn() } }));
const plan = { products: [{ id: 'A', name: '鞋子', look: '', pairs: 1, pieces: 2, layout: '脚上' }], visible: '脚',
  face: false, looks: [], timeline: [{ from: 0, to: 6, action: '迈步' }], unsure: [] };
beforeEach(() => {
  graph.refs = []; graph.index = 0; graph.effects = []; graph.edges = [];
  graph.nodes = [{ id: 'source', type: 'card', position: { x: 100, y: 150 }, measured: { width: 280, height: 205 },
    data: newVideoCard('upload', 0, [{ type: 'upload', id: 'original', media: 'video', seconds: 6, width: 1280, height: 720 }]) }];
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Health);
  vi.mocked(api.analyzeProduct).mockResolvedValue({ plan, duration: 6, targetDuration: 6, ratio: '16:9', hasAudio: false, yuan: 0 });
});
function harness() {
  const takeNumber = cardCounter();
  let actions!: ReturnType<typeof useProductRemake>;
  const setNodes = (update: (nodes: CardNode[]) => CardNode[]) => { graph.nodes = update(graph.nodes); };
  function Harness() {
    const layout = useMeasuredRewriteLayout(graph.nodes, setNodes);
    actions = useProductRemake({ canvasId: 'layout', nodes: graph.nodes, setNodes,
      setEdges: update => { graph.edges = update(graph.edges); }, takeNumber, notify: vi.fn(), layout });
    return null;
  }
  const render = () => {
    graph.index = 0; graph.effects = []; renderToStaticMarkup(<Harness />);
    for (const effect of graph.effects) effect();
  };
  const measure = () => {
    graph.nodes = graph.nodes.map(n => n.measured ? n : { ...n, measured: { width: 280, height: 205 } });
    for (let i = 0; i < 8; i++) {
      const before = graph.nodes; render();
      if (graph.nodes === before) return;
    }
    throw Error('排位没有稳定');
  };
  render();
  return { actions: () => actions, render, measure };
}
const images = () => graph.nodes.filter(n => n.data.kind === 'image');
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function expectRows(videoId: string) {
  const groupIds = [...new Set(images().filter(n => n.data.group?.videoId === videoId).map(n => n.data.group!.id))];
  const bounds = groupIds.map(id => {
    const members = images().filter(n => n.data.group?.id === id).sort((a, b) => a.position.x - b.position.x);
    expect(new Set(members.map(n => n.position.y)).size, JSON.stringify(toDoc({ id: 'c', name: 'c' }, graph.nodes, graph.edges).nodes)).toBe(1);
    for (let i = 1; i < members.length; i++) expect(members[i].position.x - members[i - 1].position.x - members[i - 1].measured!.width!).toBe(24);
    return groupBounds(graph.nodes, id)!;
  });
  const background = images().find(n => n.data.kind === 'image' && n.data.productRole?.role === 'background')!;
  const bg = { ...background.position, width: background.measured!.width!, height: background.measured!.height! };
  for (let i = 1; i < bounds.length; i++) {
    expect(overlap(bounds[i - 1], bounds[i])).toBe(false);
    expect(bounds[i - 1].y + bounds[i - 1].height).toBeLessThan(bounds[i].y);
  }
  for (const bound of bounds) {
    expect(overlap(bound, bg)).toBe(false);
    expect(bound.y + bound.height).toBeLessThan(bg.y);
  }
}

it('拆解→加一张→加背景→加商品：真实排位接线按整个组排A→B→背景，存档组内同排且组框不重叠', async () => {
  const h = harness(); await h.actions().run('source', '鞋子'); h.measure();
  const first = images()[0], groupId = first.data.group!.id;
  const videoId = first.data.group!.videoId!;
  h.actions().addImage(groupId); h.measure();
  expect(images().filter(n => n.data.group?.id === groupId).map(n => n.position)).toEqual([{ x: 480, y: 150 }, { x: 784, y: 150 }]);
  h.actions().addBackground(videoId); h.measure();
  h.actions().addProduct(videoId); h.measure();
  expect(images().filter(n => n.data.group?.id === groupId).map(n => n.position.y)).toEqual([150, 150]);
  expect(images().filter(n => n.data.group).map(n => n.data.group!.productId)).toEqual(['A', 'A', 'B']);
  expectRows(videoId);
  const stored = toDoc({ id: 'c', name: 'c' }, graph.nodes, graph.edges).nodes;
  expect(stored.filter(n => n.data.group?.id === groupId).map(n => ({ x: n.x, y: n.y }))).toEqual([{ x: 480, y: 150 }, { x: 784, y: 150 }]);
  const b = stored.find(n => n.data.group?.productId === 'B')!, bg = stored.find(n => n.data.kind === 'image' && n.data.productRole?.role === 'background')!;
  expect(b.y).toBeLessThan(bg.y);
  graph.nodes = graph.nodes.map(n => n.id === first.id ? { ...n, measured: { width: 340, height: 500 } } : n);
  h.measure(); expectRows(videoId);
  const positions = graph.nodes.map(n => n.position); h.measure(); expect(graph.nodes.map(n => n.position)).toEqual(positions);
});
it('任一组员被用户拖过，后续测量和新增卡都不重新自动移动已有卡', async () => {
  const h = harness(); await h.actions().run('source', '鞋子'); h.measure();
  const first = images()[0], groupId = first.data.group!.id, videoId = first.data.group!.videoId!;
  h.actions().addImage(groupId); h.measure();
  const second = images().find(n => n.id !== first.id)!;
  graph.nodes = graph.nodes.map(n => n.id === second.id ? { ...n, position: { x: n.position.x + 60, y: n.position.y + 90 }, dragging: true } : n);
  h.render();
  graph.nodes = graph.nodes.map(n => ({ ...n, dragging: false })); h.measure();
  const positions = new Map(graph.nodes.map(n => [n.id, n.position]));
  h.actions().addBackground(videoId); h.measure(); h.actions().addProduct(videoId); h.measure();
  for (const [id, position] of positions) expect(graph.nodes.find(n => n.id === id)!.position).toEqual(position);
});
