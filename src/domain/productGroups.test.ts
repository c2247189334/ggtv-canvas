import { expect, it } from 'vitest';
import { cardCounter, newVideoCard } from './cards';
import { startProductRemake, prepareProductCards, addProductImage, setProductSameAs, productSameAsState, productEmptyText, productOriginalLook } from './productRemake';
import { productPromptProblem, productPromptRequest } from './productPrompt';
import { arrangeGroup } from './groups';
import { readProductPlan, readProductRole } from './productRemakeDoc';
import type { CardNode } from '@/types';
import type { Edge } from '@xyflow/react';

// 11-04 晚：同一条鞋店视频里同款不同色的三双按实物组分（Codex skill 9-10 做法）。
const plan = { products: [
  { id: 'A', name: '鞋子', where: '脚上', look: '旧鞋', pairs: 1, pieces: 2, layout: '拿起后穿在脚上' },
  { id: 'B', name: '鞋子', where: '后排上层', look: '旧鞋', pairs: 1, pieces: 2, layout: '后排上层' },
  { id: 'C', name: '鞋子', where: '后排下层', look: '旧鞋', pairs: 1, pieces: 2, layout: '后排下层' }],
  visible: '腿', face: false, looks: [], timeline: [{ from: 0, to: 6, action: '迈步' }], unsure: [] };
function setup() {
  const source: CardNode = { id: 'source', type: 'card', position: { x: 0, y: 0 }, selected: true,
    data: newVideoCard('upload', 0, [{ type: 'upload', id: 'original', media: 'video', seconds: 6, width: 720, height: 1280, hasAudio: true }]) };
  let serial = 0;
  const args = { nodes: [source], edges: [] as Edge[], source, userText: '鞋子', takeNumber: cardCounter(), makeId: () => `p-${++serial}` };
  const started = startProductRemake(args);
  const graph = prepareProductCards({ ...args, ...started, plan });
  return { args, videoId: started.videoId, graph };
}
const groupOf = (nodes: CardNode[], productId: string) => nodes.find(n => n.data.group?.productId === productId)!.data.group!.id;
const withImage = (nodes: CardNode[], productId: string) => nodes.map(n => n.data.group?.productId === productId && n.data.kind === 'image'
  ? { ...n, data: { ...n.data, results: [{ type: 'upload' as const, id: `photo-${productId}` }] } } : n);
const state = (videoId: string, nodes: CardNode[], edges: Edge[]) => {
  const node = nodes.find(n => n.id === videoId)!;
  return { id: videoId, data: node.data as Extract<CardNode['data'], { kind: 'video' }>, nodes, edges };
};

it('每组一个组，组名和空卡写位置，存档读回不丢 where / sameAs', () => {
  const { graph } = setup();
  const images = graph.nodes.filter(n => n.data.kind === 'image');
  expect(images.map(n => n.data.group?.name)).toEqual(['商品A · 鞋子（脚上）', '商品B · 鞋子（后排上层）', '商品C · 鞋子（后排下层）']);
  expect(productEmptyText(images[1].data as never)).toBe('传：后排上层那组鞋子要换成的实物照（一张一个角度：正面、侧面、鞋底…）');
  expect(readProductPlan(JSON.parse(JSON.stringify(plan)))!.products[1].where).toBe('后排上层');
  expect(readProductRole({ videoId: 'v', role: 'product', productId: 'B', where: '后排上层', sameAs: 'A' })).toMatchObject({ where: '后排上层', sameAs: 'A' });
  expect(readProductRole({ videoId: 'v', role: 'product', productId: 'B', sameAs: 'B' })).not.toHaveProperty('sameAs');
});

// 11-04 晚用户：只写「台面左数第四双」认不出是哪双，空卡先写原片里这组长什么样（只给人看，不进提示词）。
it('空卡第一行写原片里这组的样子（拆解单 look 第一小句），没有 look 照旧', () => {
  const { videoId, graph } = setup();
  const nodes = graph.nodes.map(n => n.id === videoId && n.data.kind === 'video' ? { ...n, data: { ...n.data, productPlan: { ...plan, products: [
    { ...plan.products[0], look: '香槟金色尖头玛丽珍鞋，带细搭扣横带，鞋面中间有方形水钻装饰，坡跟' },
    { ...plan.products[1], look: '黑色亮面尖头玛丽珍鞋带横带鞋面有方形水钻装饰' }, { ...plan.products[2], look: ' ' }] } } } : n);
  const roles = nodes.flatMap(n => n.data.kind === 'image' && n.data.productRole ? [n.data.productRole] : []);
  expect(productOriginalLook(nodes, roles[0])).toBe('香槟金色尖头玛丽珍鞋');
  expect(productOriginalLook(nodes, roles[1])).toBe('黑色亮面尖头玛丽珍鞋带横带鞋面有…');
  expect(productOriginalLook(nodes, roles[2])).toBe('');
  expect(productOriginalLook(nodes.filter(n => n.id !== videoId), roles[0])).toBe('');
  expect(productOriginalLook(nodes, { role: 'background', videoId })).toBe('');
  expect(productEmptyText({ productRole: roles[0] }, '香槟金色尖头玛丽珍鞋'))
    .toBe('原片里这组：香槟金色尖头玛丽珍鞋\n传：要换成的鞋子实物照（一张一个角度：正面、侧面、鞋底…）');
  expect(productEmptyText({ productRole: { ...roles[1], sameAs: 'A' } }, '黑色亮面尖头玛丽珍鞋')).toBe('原片里这组：黑色亮面尖头玛丽珍鞋\n跟商品A一样，不用传图');
  expect(productEmptyText({ productRole: { role: 'background' } }, '香槟金色')).toBe('传：背景照（只照它的场景颜色、材质和光线）');
});

it('「跟哪组一样」：能选同一视频下任意一组、正在跟别人的组不能当目标；选了剪线写不用传图、不能加一张；不跟了接回；有图只能取消', () => {
  const { args, videoId, graph } = setup();
  const g = { nodes: graph.nodes, edges: graph.edges, takeNumber: args.takeNumber, makeId: args.makeId };
  const b = groupOf(graph.nodes, 'B'), c = groupOf(graph.nodes, 'C');
  expect(productSameAsState(graph.nodes, b)).toEqual({ current: null, hasImage: false,
    options: [{ id: 'A', label: '商品A · 鞋子（脚上）' }, { id: 'C', label: '商品C · 鞋子（后排下层）' }] });
  const on = setProductSameAs({ ...g, groupId: b, target: 'A' });
  const card = on.nodes.find(n => n.data.group?.id === b)!;
  expect(on.edges.some(e => e.source === card.id)).toBe(false);
  expect(productEmptyText(card.data as never)).toBe('跟商品A一样，不用传图');
  expect(() => addProductImage({ ...g, ...on, groupId: b })).toThrow(/跟商品A一样/);
  expect(productSameAsState(on.nodes, c)!.options.map(o => o.id)).toEqual(['A']);
  expect(() => setProductSameAs({ ...g, ...on, groupId: c, target: 'B' })).toThrow(/它自己在跟别的组/);
  const switched = setProductSameAs({ ...g, ...on, groupId: b, target: 'C' });
  expect(productSameAsState(switched.nodes, b)!.current).toBe('C');
  expect(switched.edges.some(e => e.source === card.id)).toBe(false);
  const off = setProductSameAs({ ...g, ...on, groupId: b, target: null });
  expect(off.edges.some(e => e.source === card.id && e.target === videoId)).toBe(true);
  expect(() => setProductSameAs({ ...g, nodes: withImage(graph.nodes, 'B'), groupId: b, target: 'A' })).toThrow(/已经有图/);
  const turnedOff = setProductSameAs({ ...g, nodes: withImage(on.nodes, 'B'), edges: on.edges, groupId: b, target: null });
  expect(productSameAsState(turnedOff.nodes, b)!.current).toBeNull();
});

it('生成提示词前：每组要有图或跟别的组；跟的组进请求带 sameAs；整组删掉只进提醒', () => {
  const { args, videoId, graph } = setup();
  const g = { nodes: graph.nodes, edges: graph.edges, takeNumber: args.takeNumber, makeId: args.makeId };
  let nodes = withImage(graph.nodes, 'A');
  expect(productPromptProblem(state(videoId, nodes, graph.edges))).toMatch(/还差 2 张图：商品B · 鞋子（后排上层）、商品C · 鞋子（后排下层）；和别的组同款同色的，可以点组上的「跟哪组一样」/);
  const on = setProductSameAs({ ...g, nodes, groupId: groupOf(nodes, 'B'), target: 'A' });
  nodes = withImage(on.nodes, 'C');
  expect(productPromptProblem(state(videoId, nodes, on.edges))).toBeNull();
  const request = productPromptRequest(state(videoId, nodes, on.edges));
  expect(request.plan.products.map(p => [p.id, p.sameAs])).toEqual([['A', undefined], ['B', 'A'], ['C', undefined]]);
  expect(request.materials.filter(m => m.role === 'product').map(m => m.productId)).toEqual(['A', 'C']);
  const cut = on.edges.filter(e => e.source !== nodes.find(n => n.data.group?.productId === 'C')!.id);
  expect(productPromptProblem(state(videoId, nodes, cut))).toBe('商品C（后排下层）还没传图：传图，或点组上的「跟哪组一样」');
  const gone = nodes.filter(n => n.data.group?.productId !== 'C');
  expect(productPromptProblem(state(videoId, gone, cut))).toBeNull();
  expect(productPromptRequest(state(videoId, gone, cut)).plan.unsure).toContain('商品C（后排下层）不在画布上了，原片里那组可能换不掉');
});

it('跟的组后来自己也去跟别人：请求顺到最终有图的那组（C 跟 B、B 再跟 A → C 照 A）', () => {
  const { args, videoId, graph } = setup();
  const g = { nodes: graph.nodes, edges: graph.edges, takeNumber: args.takeNumber, makeId: args.makeId };
  const c = setProductSameAs({ ...g, nodes: withImage(graph.nodes, 'A'), groupId: groupOf(graph.nodes, 'C'), target: 'B' });
  const b = { ...c, nodes: c.nodes.map(n => n.data.group?.productId === 'B' && n.data.kind === 'image'
    ? { ...n, data: { ...n.data, productRole: { ...n.data.productRole!, sameAs: 'A' } } } : n),
    edges: c.edges.filter(e => e.source !== c.nodes.find(n => n.data.group?.productId === 'B')!.id) };
  expect(productPromptProblem(state(videoId, b.nodes, b.edges))).toBeNull();
  expect(productPromptRequest(state(videoId, b.nodes, b.edges)).plan.products.map(p => [p.id, p.sameAs])).toEqual([['A', undefined], ['B', 'A'], ['C', 'A']]);
});

it('排列三项：水平一行顶对齐、垂直一列左对齐、宫格 ⌈√n⌉ 列，间隔 24，从组左上角排', () => {
  const card = (id: string, x: number, y: number, width: number, height: number): CardNode => ({ id, type: 'card', position: { x, y },
    measured: { width, height }, data: { ...newVideoCard('upload', 0), kind: 'image', group: { id: 'g', name: 'G' } } as never });
  const nodes = [card('a', 100, 52, 280, 400), card('b', 600, 40, 280, 300), card('c', 1000, 70, 280, 420), card('d', 1400, 40, 280, 300), card('x', 0, 0, 10, 10)];
  nodes[4] = { ...nodes[4], data: { ...nodes[4].data, group: undefined } };
  const at = (list: CardNode[]) => Object.fromEntries(list.map(n => [n.id, [n.position.x, n.position.y]]));
  expect(at(arrangeGroup(nodes, 'g', 'horizontal'))).toEqual({ a: [100, 40], b: [404, 40], c: [708, 40], d: [1012, 40], x: [0, 0] });
  expect(at(arrangeGroup(nodes, 'g', 'vertical'))).toEqual({ a: [100, 40], b: [100, 464], c: [100, 788], d: [100, 1232], x: [0, 0] });
  expect(at(arrangeGroup(nodes, 'g', 'grid'))).toEqual({ a: [100, 40], b: [404, 40], c: [100, 464], d: [404, 464], x: [0, 0] });
});
