import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Edge } from '@xyflow/react';
import { cardCounter, newCard, newVideoCard } from '@/domain/cards';
import type { CardNode, ImageCardData } from '@/types';
import { SceneReads, SceneTextPanel, SceneTextToggle } from './SceneTextPanel';
import { useCards } from './useCards';

// 11-13 背景卡「不出图，用文字」：按钮剪线 / 连回，线就是开关。
const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[] }));
const board = vi.hoisted(() => ({ updateCard: vi.fn(), disconnect: vi.fn(), connect: vi.fn() }));
vi.mock('@xyflow/react', () => ({ useNodes: () => graph.nodes, useEdges: () => graph.edges, useReactFlow: () => ({
  getNodes: () => graph.nodes, getEdges: () => graph.edges, getNode: (id: string) => graph.nodes.find(node => node.id === id) }) }));
vi.mock('./boardContext', () => ({ useBoard: () => board }));
vi.mock('./usePanelFit', () => ({ usePanelFit: () => {} }));

const bg = (extra: Partial<ImageCardData> = {}): ImageCardData => ({ ...newCard('generate', 3), rewriteId: 'batch', title: '背景 2', rewriteNewScene: true, rewriteSceneId: 'S2', ...extra });
beforeEach(() => {
  vi.clearAllMocks();
  graph.nodes = [{ id: 'bg', type: 'card', position: { x: 0, y: 0 }, data: bg() },
    { id: 'video', type: 'card', position: { x: 0, y: 0 }, data: { ...newVideoCard('generate', 9), rewriteId: 'batch', rewriteSourceId: 'source' } }];
  graph.edges = [{ id: 'link', source: 'bg', target: 'video' }];
});
const click = (data: ImageCardData) => (SceneTextToggle({ id: 'bg', data }) as { props: { onClick: () => void } }).props.onClick();

it('点「不出图，用文字」：剪掉到视频卡的线、开用文字；以前写的字留着', () => {
  click(bg({ rewriteSceneText: '上次写的' }));
  expect(board.disconnect).toHaveBeenCalledWith('bg', 'video');
  expect(board.updateCard).toHaveBeenCalledWith('bg', { rewriteTextOn: true, rewriteSceneText: '上次写的' });
});

it('点「改回用图」：关掉用文字、重新连回视频卡；人物 / 衣服卡没有这个按钮', () => {
  graph.edges = [];
  click(bg({ rewriteTextOn: true, rewriteSceneText: '篮球' }));
  expect(board.updateCard).toHaveBeenCalledWith('bg', { rewriteTextOn: false });
  expect(board.connect).toHaveBeenCalledWith('bg', 'video');
  expect(SceneTextToggle({ id: 'bg', data: { ...bg(), rewriteItem: { id: 'P1', kind: '人物', desc: '女生', from: 0, to: 1, frame: 0 } } })).toBeNull();
});

it('用文字的卡面板：写字框、占位提示、字数、改回用图；视频卡露出每张卡的理解', () => {
  const html = renderToStaticMarkup(<SceneTextPanel id="bg" data={bg({ rewriteTextOn: true, rewriteSceneText: '球都换成篮球' })} />);
  expect(html).toContain('改回用图'); expect(html).toContain('球都换成篮球'); expect(html).toContain('6/300');
  expect(html).toContain('写这一段想要的背景，大白话就行'); expect(html).not.toContain('发送');
  const reads = renderToStaticMarkup(<SceneReads reads={[{ title: '背景 2', text: '球都换成篮球', read: '脚下和身后都是篮球' }]} />);
  expect(reads).toContain('卡上的字我是这么理解的'); expect(reads).toContain('背景 2：你写「球都换成篮球」→ 脚下和身后都是篮球');
  expect(renderToStaticMarkup(<SceneReads />)).toBe('');
});

it('线就是开关：用文字的背景卡自己拖线连回视频卡 = 改回用图；用图的卡连线不受影响', () => {
  graph.edges = [];
  graph.nodes[0].data = bg({ rewriteTextOn: true, rewriteSceneText: '篮球' });
  let cards!: ReturnType<typeof useCards>;
  function Harness() {
    cards = useCards({ setNodes: update => { graph.nodes = update(graph.nodes); }, setEdges: update => { graph.edges = update(graph.edges); },
      takeNumber: cardCounter(), notify: vi.fn(), pickWork: async () => null, onBlankConnect: vi.fn() });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  cards.connect('bg', 'video');
  expect(graph.edges.map(edge => [edge.source, edge.target])).toEqual([['bg', 'video']]);
  expect((graph.nodes[0].data as ImageCardData).rewriteTextOn).toBe(false);
  expect((graph.nodes[0].data as ImageCardData).rewriteSceneText).toBe('篮球');
});

// 11-16 衣服卡、东西卡也能用文字（设计 docs/specs/2026-11-16-衣服卡和东西卡用文字-design.md）；人物卡不行（上面那条测了）。
it('衣服卡、东西卡也有这个按钮：点了剪线、开用文字；面板占位字按类分', () => {
  const item = (kind: '衣服' | '道具') => ({ ...newCard('generate', 3), rewriteId: 'batch', title: kind, rewriteItem: { id: 'X1', kind, desc: '原片的样子', from: 0, to: 4, frame: 1 } }) as ImageCardData;
  click(item('衣服'));
  expect(board.disconnect).toHaveBeenCalledWith('bg', 'video');
  expect(board.updateCard).toHaveBeenCalledWith('bg', { rewriteTextOn: true, rewriteSceneText: '' });
  expect(SceneTextToggle({ id: 'bg', data: item('道具') })).not.toBeNull();
  expect(SceneTextToggle({ id: 'bg', data: { ...item('衣服'), productRole: { role: 'product' } } as ImageCardData })).toBeNull();
  const clothes = renderToStaticMarkup(<SceneTextPanel id="bg" data={{ ...item('衣服'), rewriteTextOn: true, rewriteSceneText: '黑色小礼服' }} />);
  expect(clothes).toContain('写这套衣服想要的样子'); expect(clothes).toContain('黑色小礼服'); expect(clothes).toContain('对照原片写进提示词');
  expect(renderToStaticMarkup(<SceneTextPanel id="bg" data={{ ...item('道具'), rewriteTextOn: true }} />)).toContain('写这样东西想换成什么');
});
