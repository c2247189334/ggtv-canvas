import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Edge } from '@xyflow/react';
import type { CardNode } from '@/types';
import { cardCounter, newVideoCard } from '@/domain/cards';
import { REWRITE_BACKGROUND_PROMPT, REWRITE_NEW_SCENE_PROMPT, videoRewriteMaterials } from '@/domain/videoRewrite';
import { api } from '@/api';
import { useVideoRewrite } from './useVideoRewrite';
import type { RewritePlan } from '@/videoRewriteTypes';

const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[], effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { graph.effects.push(effect); } }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNodes: () => graph.nodes, getEdges: () => graph.edges,
  getNode: (id: string) => graph.nodes.find(node => node.id === id) }) }));
vi.mock('@/api', () => ({ api: { health: vi.fn(), analyzeVideo: vi.fn(), submitDepthJob: vi.fn(), extractFrame: vi.fn() } }));
vi.mock('@/library/worksEvents', () => ({ bumpWorks: vi.fn() }));

const plan: RewritePlan = { summary: '换人', items: [{ id: 'person', kind: '人物', desc: '一名人物', from: 0, to: 6, frame: 0 }],
  replace: ['person'], changes: [], actions: [], unsure: [] };
const analyzed = (backgroundFrames?: Array<{ second: number; empty: boolean }>) => ({ duration: 6, targetDuration: 6, ratio: '9:16' as const,
  hasAudio: true, plan, yuan: 0, ...(backgroundFrames ? { backgroundFrames } : {}) });
function setup() {
  graph.edges = []; graph.effects = [];
  graph.nodes = [{ id: 'source', type: 'card', selected: true, position: { x: 0, y: 0 }, data: newVideoCard('upload', 0,
    [{ type: 'upload', id: 'upload', media: 'video', seconds: 6, hasAudio: true, width: 720, height: 1280 }]) }];
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
const background = () => graph.nodes.find(node => node.data.title === '背景')!;
const frameCards = () => graph.nodes.filter(node => node.data.kind === 'image' && node.data.source === 'upload');
const videoId = () => graph.nodes.find(node => node.data.kind === 'video' && node.data.source === 'generate')!.id;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Awaited<ReturnType<typeof api.health>>);
  vi.mocked(api.submitDepthJob).mockResolvedValue({ id: 'depth-job' });
  vi.mocked(api.extractFrame).mockResolvedValue({ id: 'frame', kind: 'image' });
});

it('11-11 用户定：不勾背景一致也截拆解挑的那帧，放左边只给人对照（不连线、不当素材），背景卡空着、框和截图一样大', async () => {
  vi.mocked(api.analyzeVideo).mockResolvedValue(analyzed([{ second: 2.4, empty: false }]));
  const { actions, notify, layout } = setup();
  await actions.run('source', '换人', false);
  expect(vi.mocked(api.analyzeVideo).mock.calls[0][0]).not.toHaveProperty('background');
  expect(api.extractFrame).toHaveBeenCalledWith({ source: { type: 'upload', id: 'upload' }, second: 2.4 });
  const compare = frameCards().find(node => node.data.title === '背景 原片（2.4 秒）')!;
  expect(compare.data.results).toEqual([{ type: 'upload', id: 'frame' }]);
  expect(background().data).toMatchObject({ rewriteNewScene: true, prompt: REWRITE_NEW_SCENE_PROMPT, results: [], emptyAspect: 720 / 1280 });
  expect(graph.edges.filter(edge => edge.source === compare.id || edge.target === background().id)).toHaveLength(0);
  expect(notify).toHaveBeenCalledWith('图片卡已铺好：补完 2 张图后，在视频卡点「生成提示词」；背景卡等你上传或生成；左边没连线的截图只给你对照');
  const rows = layout.mock.calls.find(([, value]) => value.rows)![1];
  expect(rows.rows[0]).toEqual({ left: compare.id, right: background().id });
  expect(rows.origin).toEqual({ x: 760, y: 0 });
});

it('11-09 勾了背景一致、拆解挑的那帧没人：截那一秒直接当背景，不调 AI、没有截图卡，提示只算人物一张', async () => {
  vi.mocked(api.analyzeVideo).mockResolvedValue(analyzed([{ second: 2.4, empty: true }]));
  const { actions, notify } = setup();
  await actions.run('source', '换人');
  expect(vi.mocked(api.analyzeVideo).mock.calls[0][0]).not.toHaveProperty('background');
  expect(api.extractFrame).toHaveBeenCalledWith({ source: { type: 'upload', id: 'upload' }, second: 2.4 });
  expect(background().data).toMatchObject({ results: [{ type: 'upload', id: 'frame' }], prompt: '' });
  expect(background().data).not.toHaveProperty('emptyAspect');
  expect(frameCards().map(node => node.data.title)).toEqual(['人物 原片（3 秒）']);
  expect(notify).toHaveBeenCalledWith('图片卡已铺好：补完 1 张图后，在视频卡点「生成提示词」；左边没连线的截图只给你对照');
  const id = videoId();
  expect(graph.edges.filter(edge => edge.target === id)[0].source).toBe(background().id);
  expect(videoRewriteMaterials(graph.nodes, graph.edges, id)[0]).toMatchObject({ tag: '@图片1', purpose: '背景' });
});

it('11-09 勾了背景一致、拆解挑的那帧有人：截那一秒，放「原视频 N 秒」卡连背景卡；去人的词写好、不自动出图，等用户点生成', async () => {
  vi.mocked(api.analyzeVideo).mockResolvedValue(analyzed([{ second: 1.9, empty: false }]));
  const { actions, notify, layout } = setup();
  await actions.run('source', '换人');
  expect(api.extractFrame).toHaveBeenCalledWith({ source: { type: 'upload', id: 'upload' }, second: 1.9 });
  const [frame, person] = frameCards();
  expect(frame.data).toMatchObject({ title: '原视频 1.9 秒', results: [{ type: 'upload', id: 'frame' }] });
  expect(background().data).toMatchObject({ prompt: REWRITE_BACKGROUND_PROMPT, results: [], emptyAspect: 720 / 1280 });
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: frame.id, target: background().id }));
  expect(notify).toHaveBeenCalledWith('图片卡已铺好：补完 2 张图后，在视频卡点「生成提示词」；其中 1 张已连好截图、写好词，点生成就行；左边没连线的截图只给你对照');
  // 11-11：深度卡自己占第 2 列；截图和要补的卡一行一对排在第 3、4 列。
  const depth = graph.nodes.find(node => node.data.source === 'depth')!;
  expect(layout).toHaveBeenCalledWith(expect.any(String), { ids: [depth.id], movableIds: [depth.id], origin: { x: 380, y: 0 } });
  const personCard = graph.nodes.find(node => node.data.kind === 'image' && node.data.rewriteItemId === 'person')!;
  const rows = layout.mock.calls.find(([, value]) => value.rows)![1];
  expect(rows.rows).toEqual([{ left: frame.id, right: background().id }, { left: person.id, right: personCard.id }]);
  expect(graph.edges.some(edge => edge.source === person.id)).toBe(false);
});

it('11-06 拆解失败：不截图、不建背景卡，一分钱出图费都不花', async () => {
  vi.mocked(api.analyzeVideo).mockRejectedValue(Object.assign(Error('断线'), { yuan: 0 }));
  const { actions } = setup();
  await actions.run('source', '换人');
  expect(api.extractFrame).not.toHaveBeenCalled();
  expect(graph.nodes.filter(node => node.data.kind === 'image')).toHaveLength(0);
});

it('11-06 截图失败：原卡写原话，不铺卡、不出图', async () => {
  vi.mocked(api.analyzeVideo).mockResolvedValue(analyzed([{ second: 1.9, empty: false }]));
  vi.mocked(api.extractFrame).mockRejectedValue(Error('找不到执行程序'));
  const { actions, notify } = setup();
  await actions.run('source', '换人');
  expect(graph.nodes.filter(node => node.data.kind === 'image')).toHaveLength(0);
  expect(graph.nodes.find(node => node.id === 'source')!.data).toMatchObject({ rewriteStatus: { status: 'failed', error: '找不到执行程序' } });
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('找不到执行程序'));
});
