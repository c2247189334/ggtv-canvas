import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Edge } from '@xyflow/react';
import type { CardNode } from '@/types';
import { cardCounter, newVideoCard } from '@/domain/cards';
import { REWRITE_BACKGROUND_PROMPT, REWRITE_NEW_SCENE_PROMPT, REWRITE_NEW_SCENE_PURPOSE, videoRewriteMaterials } from '@/domain/videoRewrite';
import { api } from '@/api';
import { useVideoRewrite } from './useVideoRewrite';
import type { RewriteItem, RewritePlan } from '@/videoRewriteTypes';

const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[], effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { graph.effects.push(effect); } }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNodes: () => graph.nodes, getEdges: () => graph.edges,
  getNode: (id: string) => graph.nodes.find(node => node.id === id) }) }));
vi.mock('@/api', () => ({ api: { health: vi.fn(), analyzeVideo: vi.fn(), submitDepthJob: vi.fn(), extractFrame: vi.fn() } }));
vi.mock('@/library/worksEvents', () => ({ bumpWorks: vi.fn() }));

const scene = (id: string, from: number, to: number): RewriteItem => ({ id, kind: '场景', desc: id, from, to, frame: (from + to) / 2 });
const plan: RewritePlan = { summary: '换人', items: [{ id: 'P1', kind: '人物', desc: '一名人物', from: 0, to: 12, frame: 0 }, scene('S1', 0, 4), scene('S2', 4, 8), scene('S3', 8, 12)],
  replace: ['P1'], changes: [], actions: [], unsure: [] };
const analyzed = (backgroundFrames: Array<{ second: number; empty: boolean }>) => ({ duration: 12, targetDuration: 12, ratio: '9:16' as const, hasAudio: true, plan, yuan: 0, backgroundFrames });
function setup() {
  graph.edges = []; graph.effects = [];
  graph.nodes = [{ id: 'source', type: 'card', selected: true, position: { x: 0, y: 0 }, data: newVideoCard('upload', 0,
    [{ type: 'upload', id: 'upload', media: 'video', seconds: 12, hasAudio: true, width: 720, height: 1280 }]) }];
  const notify = vi.fn(), layout = vi.fn();
  let actions!: ReturnType<typeof useVideoRewrite>;
  function Harness() {
    actions = useVideoRewrite({ canvasId: 'c', setNodes: update => { graph.nodes = update(graph.nodes); }, setEdges: update => { graph.edges = update(graph.edges); },
      takeNumber: cardCounter(), notify, layout });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  graph.effects.splice(0).forEach(effect => effect());
  return { actions, notify, layout };
}
const backgrounds = () => graph.nodes.filter(node => node.data.kind === 'image' && node.data.source === 'generate' && node.data.title?.startsWith('背景'));
const frames = () => graph.nodes.filter(node => node.data.kind === 'image' && node.data.source === 'upload');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(done => setTimeout(done, 0)); };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Awaited<ReturnType<typeof api.health>>);
  vi.mocked(api.submitDepthJob).mockResolvedValue({ id: 'depth-job' });
  vi.mocked(api.extractFrame).mockImplementation(async ({ second }) => ({ id: `frame-${second}`, kind: 'image' }));
});

it('11-09 多场景：每个场景截拆解挑的那一帧，都建背景卡、去人的词都写好，不自动出图', async () => {
  vi.mocked(api.analyzeVideo).mockResolvedValue(analyzed([{ second: 1.2, empty: false }, { second: 5, empty: false }, { second: 9.5, empty: false }]));
  const { actions, notify, layout } = setup();
  await actions.run('source', '换人');
  await flush();
  // 最后一张是要换的人物的原片对照（没衣服取在场正中，11-11）。
  expect(vi.mocked(api.extractFrame).mock.calls.map(([input]) => input.second)).toEqual([1.2, 5, 9.5, 6]);
  expect(backgrounds().map(node => node.data.title)).toEqual(['背景', '背景 2', '背景 3']);
  expect(backgrounds().every(node => node.data.kind === 'image' && node.data.prompt === REWRITE_BACKGROUND_PROMPT)).toBe(true);
  expect(frames().map(node => node.data.title)).toEqual(['原视频 1.2 秒', '原视频 5 秒', '原视频 9.5 秒', '人物 原片（6 秒）']);
  for (const node of backgrounds()) {
    expect(node.data.kind === 'image' && node.data.results).toEqual([]);
    expect(graph.edges.some(edge => edge.target === node.id && frames().some(frame => frame.id === edge.source))).toBe(true);
  }
  expect(notify).toHaveBeenCalledWith('图片卡已铺好：补完 4 张图后，在视频卡点「生成提示词」；其中 3 张已连好截图、写好词，点生成就行；左边没连线的截图只给你对照');
  const column = layout.mock.calls.find(([, value]) => value.movableIds.includes(frames()[0].id))![1];
  expect(column.ids).toEqual(expect.arrayContaining(frames().map(node => node.id)));
});

it('11-09 多场景：哪个场景挑的帧没人，就直接用截图当背景、不铺去人卡，也不算进「写好词」的张数', async () => {
  vi.mocked(api.analyzeVideo).mockResolvedValue(analyzed([{ second: 2, empty: true }, { second: 6, empty: false }, { second: 10, empty: true }]));
  const { actions, notify } = setup();
  await actions.run('source', '换人');
  await flush();
  const [first, second, third] = backgrounds();
  expect(first.data.results).toEqual([{ type: 'upload', id: 'frame-2' }]);
  expect(third.data.results).toEqual([{ type: 'upload', id: 'frame-10' }]);
  expect(second.data.kind === 'image' && second.data.results.length === 0 && second.data.prompt === REWRITE_BACKGROUND_PROMPT).toBe(true);
  expect(frames().map(node => node.data.title)).toEqual(['原视频 6 秒', '人物 原片（6 秒）']);
  expect(notify).toHaveBeenCalledWith('图片卡已铺好：补完 2 张图后，在视频卡点「生成提示词」；其中 1 张已连好截图、写好词，点生成就行；左边没连线的截图只给你对照');
});

it('11-11 用户定：不勾背景一致也每个场景一张空背景卡，左边各放拆解挑的那帧给人对照、不连线；素材按场景编号', async () => {
  vi.mocked(api.analyzeVideo).mockResolvedValue(analyzed([{ second: 2, empty: false }, { second: 6, empty: true }, { second: 10, empty: false }]));
  const { actions, layout } = setup();
  await actions.run('source', '换人', false);
  await flush();
  expect(vi.mocked(api.extractFrame).mock.calls.map(([input]) => input.second)).toEqual([2, 6, 10, 6]);
  expect(backgrounds().map(node => node.data.title)).toEqual(['背景', '背景 2', '背景 3']);
  for (const [index, node] of backgrounds().entries()) {
    expect(node.data).toMatchObject({ results: [], prompt: REWRITE_NEW_SCENE_PROMPT, rewriteNewScene: true, rewriteSceneId: `S${index + 1}`, emptyAspect: 720 / 1280 });
    expect(graph.edges.some(edge => edge.target === node.id)).toBe(false);
  }
  expect(frames().map(node => node.data.title)).toEqual(['背景 原片（2 秒）', '背景 2 原片（6 秒）', '背景 3 原片（10 秒）', '人物 原片（6 秒）']);
  expect(graph.edges.some(edge => frames().some(frame => frame.id === edge.source))).toBe(false);
  const video = graph.nodes.find(node => node.data.kind === 'video' && node.data.source === 'generate')!;
  expect(videoRewriteMaterials(graph.nodes, graph.edges, video.id).slice(0, 3)).toEqual(['S1', 'S2', 'S3'].map((itemId, index) => ({ tag: `@图片${index + 1}`, purpose: REWRITE_NEW_SCENE_PURPOSE, itemId })));
  const rows = layout.mock.calls.find(([, value]) => value.rows)![1].rows;
  expect(rows.slice(0, 3)).toEqual(backgrounds().map((node, index) => ({ left: frames()[index].id, right: node.id })));
});
