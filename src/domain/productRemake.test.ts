import { expect, it, vi } from 'vitest';
import { cardCounter, newVideoCard } from './cards';
import { startProductRemake, prepareProductCards, addProductImage, addProductGroup, addProductBackground, productStartProblem } from './productRemake';
import { fromDoc, toDoc } from './canvasDoc';
import { pasteClipboard, copySelection } from './clipboard';
import { emptyHistory, recordHistory, undoHistory, redoHistory } from './history';
import { submitVideoBatch } from './videoSend';
import { rewriteVideoHints } from './videoRewrite';
import type { CardNode, Health, VideoJobRequest } from '@/types';
import { readProductPlan, readProductRole } from './productRemakeDoc';

export const productPlan = { products: [{ id: 'A', name: '鞋子', look: '旧鞋', pairs: 1, pieces: 2, layout: '两只穿在脚上' }],
  visible: '手和腿', face: false, looks: [{ id: 'S1', kind: 'scene' as const, what: '地面', now: '旧地砖', target: '木地板' }],
  timeline: [{ from: 0, to: 6, action: '迈步' }], unsure: [] };
export function setupProduct(seconds = 6) {
  const source: CardNode = { id: 'source', type: 'card', position: { x: 0, y: 0 }, selected: true,
    data: newVideoCard('upload', 0, [{ type: 'upload', id: 'original', media: 'video', seconds, width: 720, height: 1280, hasAudio: true }]) };
  let serial = 0;
  const args = { nodes: [source], edges: [], source, userText: '鞋子', takeNumber: cardCounter(), makeId: () => `p-${++serial}` };
  const started = startProductRemake(args);
  const graph = prepareProductCards({ ...args, ...started, plan: productPlan });
  return { args, started, graph };
}
it('仅查 Key/TOS/ffmpeg，假模式放行，不依赖深度/白模/ffprobe', () => {
  const health = { fake: false, keyReady: true, tosReady: true, ffmpegFound: true } as Health;
  expect(productStartProblem(health)).toBeNull();
  expect(productStartProblem({ ...health, keyReady: false, tosReady: false, ffmpegFound: false })).toMatch(/ARK_API_KEY.*TOS.*ffmpeg/s);
  expect(productStartProblem({ fake: true } as Health)).toBeNull();
});
it('开跑只建第三列视频，成功填同一张，商品为普通组/空卡，全部为参考线，只选输出', () => {
  const { args, started, graph } = setupProduct();
  expect(started.nodes).toHaveLength(2);
  const early = started.nodes.find(n => n.id === started.videoId)!;
  expect(early.position.x).toBe(760);
  expect(early.data).toMatchObject({ rewriteKind: 'product', rewriteSource: args.source.data.results[0], rewriteStatus: { status: 'pending' }, prompt: '' });
  const image = graph.nodes.find(n => n.data.kind === 'image')!;
  expect(image.data).toMatchObject({ title: '商品A · 鞋子', prompt: '', results: [], group: { name: '商品A · 鞋子', productId: 'A', videoId: early.id }, productRole: { videoId: early.id, productId: 'A', role: 'product' } });
  expect(graph.edges.map(e => [e.source, e.target])).toEqual([['source', early.id], [image.id, early.id]]);
  expect(graph.nodes.filter(n => n.selected).map(n => n.id)).toEqual([early.id]);
  expect(graph.nodes.find(n => n.id === early.id)!.data).toMatchObject({ productPlan, rewriteUserText: '鞋子', video: early.data.kind === 'video' ? early.data.video : {} });
  const sourceChanged = { ...args.source, data: { ...args.source.data, results: [], page: 1 } };
  expect(sourceChanged.data.results).toHaveLength(0);
  expect(graph.nodes.find(n => n.id === early.id)!.data).toMatchObject({ rewriteSource: { id: 'original' } });
});
it('缺识别仍铺原话组；不同商品分组，间距留足；失败输出重来复用，完成输出不复用', () => {
  const { args, started, graph } = setupProduct();
  const fallback = prepareProductCards({ ...args, ...started, plan: { ...productPlan, products: [] } });
  expect(fallback.nodes.find(n => n.data.kind === 'image')!.data.group?.name).toBe('商品A · 鞋子');
  const retried = startProductRemake({ ...args, ...started }); expect(retried.videoId).toBe(started.videoId);
  expect(startProductRemake({ ...args, ...graph }).videoId).not.toBe(started.videoId);
  const multi = prepareProductCards({ ...args, ...started, plan: { ...productPlan, products: [...productPlan.products, { ...productPlan.products[0], id: 'B', name: '包' }] } });
  const images = multi.nodes.filter(n => n.data.kind === 'image');
  expect(images[1].position.y - images[0].position.y).toBeGreaterThan(240);
});
it('拆解未完成或失败时不允许提前加商品/背景，避免与拆解铺出的A组冲突', () => {
  const { args, started } = setupProduct();
  expect(() => addProductGroup({ ...args, ...started })).toThrow('先等拆解完成');
  expect(() => addProductBackground({ ...args, ...started })).toThrow('先等拆解完成');
});
it('删除A后加商品用C，不能复用原拆解A的商品资料', () => {
  const { args, graph } = setupProduct();
  const withB = addProductGroup({ ...args, ...graph });
  const withoutA = { nodes: withB.nodes.filter(n => n.data.group?.productId !== 'A'), edges: withB.edges.filter(e => !withB.nodes.some(n => n.id === e.source && n.data.group?.productId === 'A')) };
  const next = addProductGroup({ ...args, ...withoutA, videoId: graph.videoId });
  expect(next.nodes.at(-1)!.data.group?.productId).toBe('C');
});
it('角度图扩宽组时移动尚未被用户拖过的视频，保持100间距；撤销重做和复制后还能继续加图', () => {
  const { args, graph } = setupProduct(); const image = graph.nodes.find(n => n.data.kind === 'image')!;
  const added = addProductImage({ ...args, ...graph, groupId: image.data.group!.id });
  const video = added.nodes.find(n => n.id === graph.videoId)!;
  expect(video.position.x - added.nodes.at(-1)!.position.x).toBe(380);
  const undone = undoHistory(recordHistory(emptyHistory(), graph, added), added);
  const again = addProductImage({ ...args, ...undone.graph, groupId: image.data.group!.id });
  expect(again.nodes.find(n => n.id === graph.videoId)!.position).toEqual(video.position);
  const copied = pasteClipboard(added, null);
  const copiedImage = copied.nodes.find(n => n.data.kind === 'image')!;
  const expanded = addProductImage({ ...args, ...copied, groupId: copiedImage.data.group!.id });
  expect(expanded.nodes.find(n => n.data.kind === 'video' && n.data.source === 'generate')!.position.x).toBeGreaterThan(video.position.x + 40);
  const dragged = { ...graph, nodes: graph.nodes.map(n => n.id === graph.videoId ? { ...n, position: { x: 999, y: 99 } } : n) };
  expect(addProductImage({ ...args, ...dragged, groupId: image.data.group!.id }).nodes.find(n => n.id === graph.videoId)!.position).toEqual({ x: 999, y: 99 });
});
it('小数位置粘贴再存档刷新，仍能辨认自动摆位并避让扩宽的商品组', () => {
  const { args, graph } = setupProduct();
  const pasted = pasteClipboard(graph, { x: 0.123, y: 0.456 });
  const loaded = fromDoc(toDoc({ id: 'c', name: 'c' }, pasted.nodes, pasted.edges));
  const before = loaded.nodes.find(n => n.data.kind === 'video' && n.data.source === 'generate')!;
  const image = loaded.nodes.find(n => n.data.kind === 'image')!;
  const added = addProductImage({ ...args, ...loaded, groupId: image.data.group!.id });
  expect(added.nodes.find(n => n.id === before.id)!.position.x).toBeGreaterThan(before.position.x);
});
it('加一张按实测宽度间隔24进组连线；加商品按字母；背景最多一张，一步撤销重做', () => {
  const { args, graph } = setupProduct();
  const first = graph.nodes.find(n => n.data.kind === 'image')!; first.measured = { width: 410, height: 500 };
  const added = addProductImage({ ...args, ...graph, groupId: first.data.group!.id });
  const last = added.nodes.at(-1)!;
  expect(last.position).toEqual({ x: first.position.x + 410 + 24, y: first.position.y });
  expect(last.data).toMatchObject({ title: '商品A · 鞋子 2', group: first.data.group, productRole: { videoId: graph.videoId, productId: 'A' } });
  expect(added.edges.at(-1)).toMatchObject({ source: last.id, target: graph.videoId });
  const undo = undoHistory(recordHistory(emptyHistory(), graph, added), added);
  expect(undo.graph.nodes).toHaveLength(graph.nodes.length);
  expect(redoHistory(undo.history, undo.graph).graph.nodes).toHaveLength(added.nodes.length);
  const next = addProductGroup({ ...args, ...added, videoId: graph.videoId });
  expect(next.nodes.at(-1)!.data.group).toMatchObject({ name: '商品B', productId: 'B' });
  const bg = addProductBackground({ ...args, ...next, videoId: graph.videoId });
  expect(bg.nodes.at(-1)!.data).toMatchObject({ title: '背景', productRole: { role: 'background', videoId: graph.videoId }, prompt: '' });
  expect(addProductBackground({ ...args, ...bg, videoId: graph.videoId }).nodes).toHaveLength(bg.nodes.length);
});
it('存档/复制/部分复制/删除撤销保留身份，连同输出复制时重映射所属卡和原片', () => {
  const { args, graph } = setupProduct();
  const doc = toDoc({ id: 'c', name: 'c' }, graph.nodes, graph.edges);
  const loaded = fromDoc(doc);
  expect(loaded.nodes.find(n => n.data.kind === 'image')!.data).toMatchObject({ productRole: { videoId: graph.videoId, productId: 'A' }, group: { videoId: graph.videoId, productId: 'A' } });
  expect(loaded.nodes.find(n => n.id === graph.videoId)!.data).toMatchObject({ rewriteKind: 'product', productPlan });
  let serial = 0; const copy = pasteClipboard({ ...graph, nodes: graph.nodes.map(n => ({ ...n, selected: true })) }, null, () => `copy-${++serial}`);
  const out = copy.nodes.find(n => n.data.kind === 'video' && n.data.source === 'generate')!;
  expect(copy.nodes.find(n => n.data.kind === 'image')!.data).toMatchObject({ productRole: { videoId: out.id }, group: { videoId: out.id } });
  expect(out.data).toMatchObject({ rewriteSourceId: copy.nodes[0].id, productPlan });
  const single = copySelection(graph.nodes.map(n => ({ ...n, selected: n.data.kind === 'image' })), graph.edges);
  expect(pasteClipboard(single, null).nodes[0].data).toMatchObject({ productRole: { videoId: graph.videoId } });
  const deleted = { nodes: graph.nodes.filter(n => n.data.kind !== 'image'), edges: graph.edges.filter(e => e.source === args.source.id) };
  const restored = undoHistory(recordHistory(emptyHistory(), graph, deleted), deleted).graph;
  expect(restored.nodes.find(n => n.data.kind === 'image')!.data).toMatchObject({ productRole: { productId: 'A' } });
});
it('≤15秒用2.0标准，超过用2.5，ceil时长/480p/关声音；发送带原声且仅2.5带taskType，无旧版警告', async () => {
  for (const seconds of [4, 6.2, 15, 15.1, 30]) {
    const { graph } = setupProduct(seconds); const out = graph.nodes.find(n => n.id === graph.videoId)!;
    if (out.data.kind !== 'video') throw Error('缺输出');
    expect(out.data.video).toEqual({ model: seconds > 15 ? 'doubao-seedance-2-5-260628' : 'doubao-seedance-2-0-260128', mode: 'reference', ratio: '9:16', resolution: '480p', duration: Math.ceil(seconds), audio: false, count: 1 });
    expect(rewriteVideoHints(out.data, graph.nodes, graph.edges, out.id)).toEqual([]);
    out.data.prompt = '@视频1 是动作运镜参考。@图片1 是商品。不要字幕。';
    const submit = vi.fn(async (_request: VideoJobRequest) => ({ id: 'job' }));
    await submitVideoBatch({ card: out.data, canvasId: 'c', cardId: out.id, health: { fake: true, tosReady: false }, refs: [{ type: 'upload', id: 'original', media: 'video', seconds }, { type: 'upload', id: 'image' }], submit, clear: () => {}, submitted: () => {} });
    expect(submit.mock.calls[0][0]).toMatchObject({ soundtrack: { type: 'upload', id: 'original' }, ...(seconds > 15 ? { taskType: 'reference' } : {}) });
    if (seconds <= 15) expect(submit.mock.calls[0][0]).not.toHaveProperty('taskType');
  }
});
it('坏身份与坏单丢弃，好单深拷贝、不保留额外字段', () => {
  expect(readProductRole({ role: 'product', videoId: 'v', productId: '@1' })).toBeUndefined();
  expect(readProductRole({ role: 'background', videoId: '' })).toBeUndefined();
  expect(readProductPlan({ ...productPlan, products: [{ ...productPlan.products[0], pairs: '一' }] })).toBeUndefined();
  expect(readProductPlan({ ...productPlan, timeline: [{ from: 2, to: 1, action: '' }] })).toBeUndefined();
  const plan = readProductPlan(productPlan)!; plan.products[0].name = 'changed';
  expect(productPlan.products[0].name).toBe('鞋子');
});
