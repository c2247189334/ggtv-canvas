import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Edge } from '@xyflow/react';
import type { CardNode } from '@/types';
import { cardCounter, newVideoCard } from '@/domain/cards';
import { videoRewriteMaterials } from '@/domain/videoRewrite';
import { api } from '@/api';
import { RewriteInputView } from './RewriteInput';
import { useVideoRewrite } from './useVideoRewrite';
import type { RewriteItem, RewritePlan } from '@/videoRewriteTypes';

const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[], effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { graph.effects.push(effect); } }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNodes: () => graph.nodes, getEdges: () => graph.edges,
  getNode: (id: string) => graph.nodes.find(node => node.id === id) }) }));
vi.mock('@/api', () => ({ api: { health: vi.fn(), analyzeVideo: vi.fn(), submitDepthJob: vi.fn(), extractFrame: vi.fn() } }));
vi.mock('@/library/worksEvents', () => ({ bumpWorks: vi.fn() }));

const cloth = (id: string, person: string, from: number, to: number, frame: number): RewriteItem => ({ id, kind: '衣服', person, desc: id, from, to, frame });
const plan: RewritePlan = { summary: '换人', changes: [], actions: [], unsure: [], replace: ['P1', 'P2'], items: [
  { id: 'P1', kind: '人物', desc: '女生', from: 0, to: 12, frame: 0, where: '上半屏' }, { id: 'P2', kind: '人物', desc: '男生', from: 0, to: 12, frame: 0, where: '下半屏' },
  cloth('C1', 'P1', 0, 6, 2.4), cloth('C2', 'P2', 0, 6, 3.2), { ...cloth('C3', 'P1', 6, 12, 8), sameAs: 'C1' }] };
const analyzed = { duration: 12, targetDuration: 12, ratio: '9:16' as const, hasAudio: true, plan, yuan: 0, backgroundFrames: [{ second: 0, empty: true }] };
function setup() {
  graph.edges = []; graph.effects = [];
  graph.nodes = [{ id: 'source', type: 'card', selected: true, position: { x: 0, y: 0 }, data: newVideoCard('upload', 0,
    [{ type: 'upload', id: 'upload', media: 'video', seconds: 12, hasAudio: true, width: 576, height: 1024 }]) }];
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
const clothes = () => graph.nodes.filter(node => node.data.kind === 'image' && node.data.rewriteItem?.kind === '衣服');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(done => setTimeout(done, 0)); };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Awaited<ReturnType<typeof api.health>>);
  vi.mocked(api.submitDepthJob).mockResolvedValue({ id: 'depth-job' });
  vi.mocked(api.analyzeVideo).mockResolvedValue(analyzed);
  vi.mocked(api.extractFrame).mockImplementation(async ({ second, region }) => ({ id: `frame-${second}-${region ?? 'all'}`, kind: 'image' }));
});

it('只写换人：每套没写要换的衣服自动截半屏、建卡、连线、写好词；11-09 用户定不自动出图，用户点生成就行', async () => {
  const { actions, notify, layout } = setup();
  await actions.run('source', '换人');
  await flush();
  expect(vi.mocked(api.extractFrame).mock.calls.map(([input]) => input)).toEqual(expect.arrayContaining([
    { source: { type: 'upload', id: 'upload' }, second: 2.4, region: 'top' }, { source: { type: 'upload', id: 'upload' }, second: 3.2, region: 'bottom' }]));
  expect(clothes().map(node => node.data.kind === 'image' && node.data.rewriteItemId)).toEqual(['C1', 'C2']);
  for (const card of clothes()) {
    expect(card.data.kind === 'image' && card.data.results).toEqual([]); expect(card.data.kind === 'image' && card.data.prompt).toBeTruthy();
    expect(graph.edges.some(edge => edge.target === card.id && graph.nodes.find(node => node.id === edge.source)?.data.title?.includes('截图'))).toBe(true);
  }
  const video = graph.nodes.find(node => node.data.kind === 'video' && node.data.rewriteId && node.data.source === 'generate')!;
  const materials = videoRewriteMaterials(graph.nodes, graph.edges, video.id);
  expect(materials.filter(item => item.tag.startsWith('@图片')).map(item => item.itemId)).toEqual([undefined, 'P1', 'P2', 'C1', 'C2']);
  expect(notify).toHaveBeenCalledWith('图片卡已铺好：补完 4 张图后，在视频卡点「生成提示词」；其中 2 张已连好截图、写好词，点生成就行；左边没连线的截图只给你对照');
  const column = layout.mock.calls.find(([, value]) => value.movableIds.some((id: string) => graph.nodes.find(node => node.id === id)?.data.title?.includes('截图')))![1];
  expect(column.ids.length).toBeGreaterThanOrEqual(2);
});

it('不勾衣服保持原片：不截衣服、不铺卡、不花出图钱；要换的两个人照样各截自己那半屏给人对照（11-11）', async () => {
  const { actions } = setup();
  await actions.run('source', '换人', true, 'depth', false);
  await flush();
  expect(clothes()).toHaveLength(0);
  const shots = graph.nodes.filter(node => node.data.kind === 'image' && node.data.source === 'upload').map(node => node.data.title);
  expect(shots.filter(title => title?.includes('衣服'))).toEqual([]);
  expect(vi.mocked(api.extractFrame).mock.calls.map(([input]) => input)).toEqual(expect.arrayContaining([
    { source: { type: 'upload', id: 'upload' }, second: 2.4, region: 'top' }, { source: { type: 'upload', id: 'upload' }, second: 3.2, region: 'bottom' }]));
  const people = graph.nodes.filter(node => node.data.kind === 'image' && node.data.rewriteItem?.kind === '人物');
  expect(people.map(node => node.data.kind === 'image' && node.data.emptyAspect)).toEqual([576 / 512, 576 / 512]);
});

it('一张衣服截图失败：整次报错，不留半截，也不出图', async () => {
  vi.mocked(api.extractFrame).mockImplementation(async ({ region }) => { if (region) throw Error('找不到执行程序'); return { id: 'frame', kind: 'image' }; });
  const { actions, notify } = setup();
  await actions.run('source', '换人');
  await flush();
  expect(clothes()).toHaveLength(0);
  expect(notify).toHaveBeenCalledWith('视频改写没成功：找不到执行程序');
});

const props = { text: '换人', pending: false, keepBackground: true, keepClothes: true,
  onChange: vi.fn(), onKeepBackground: vi.fn(), onKeepClothes: vi.fn(), onStart: vi.fn() };
it('输入框有「衣服和原片保持一致」，勾着时说明截图铺卡、你点生成，不写价格；拆解不花钱时开始改写就免费', () => {
  const kept = renderToStaticMarkup(<RewriteInputView {...props} />);
  expect(kept).toContain('衣服和原片保持一致'); expect(kept).toContain('没写要换的衣服按原片截图、铺卡连好、写好词，你点生成'); expect(kept).not.toContain('¥');
  expect(kept).toContain('开始改写（免费）');
  const off = renderToStaticMarkup(<RewriteInputView {...props} keepClothes={false} keepBackground={false} />);
  expect(off).toContain('不抽衣服图：衣服按人物图或文字描述来'); expect(off).toContain('开始改写（免费）');
});
