import { expect, it, vi } from 'vitest';
import { newCard, newVideoCard } from './cards';
import { productMaterials, productPromptRequest, productPromptProblem, createProductPromptAction } from './productPrompt';
import { collectSendRefs } from './sendRefs';
import type { CardNode, VideoCardData } from '@/types';
import type { ProductPlan } from '@/productRemakeTypes';
const plan: ProductPlan = { products: [{ id: 'A', name: '鞋子', look: '旧鞋', pairs: 1, pieces: 2, layout: '脚上' }],
  visible: '手和腿', face: false, looks: [], timeline: [{ from: 0, to: 6, action: '迈步' }], unsure: [] };
function setup() {
  const source = { type: 'upload' as const, id: 'original', media: 'video' as const, seconds: 6, hasAudio: true };
  const data: VideoCardData = { ...newVideoCard('generate', 2), rewriteKind: 'product', rewriteId: 'batch', productPlan: plan, rewriteUserText: '鞋子',
    rewriteSource: source, rewriteSourceId: 'source', prompt: '旧词', rewriteWarnings: ['旧提醒'] };
  const nodes: CardNode[] = [{ id: 'source', type: 'card', position: { x: 0, y: 0 }, data: newVideoCard('upload', 0, [{ ...source, id: 'flipped' }]) },
    { id: 'image', type: 'card', position: { x: 0, y: 0 }, data: { ...newCard('generate', 1, [{ type: 'work', id: 'picture' }]),
      title: '商品A · 鞋子', productRole: { role: 'product' as const, videoId: 'v', productId: 'A' }, group: { id: 'g', name: '商品A · 鞋子', productId: 'A', videoId: 'v' } } },
    { id: 'v', type: 'card', position: { x: 800, y: 0 }, data }];
  const edges = [{ id: 's-v', source: 'source', target: 'v' }, { id: 'i-v', source: 'image', target: 'v' }];
  return { id: 'v', data, nodes, edges };
}
it('按入线编号附身份/当前商品图与原商品描述；原视频始终用来源快照', () => {
  const state = setup(); const materials = productMaterials(state.nodes, state.edges, 'v');
  expect(materials).toMatchObject([{ tag: '@视频1', purpose: '参考视频', asset: { id: 'original' } },
    { tag: '@图片1', productId: 'A', role: 'product', originalDesc: '旧鞋', asset: { id: 'picture' } }]);
  expect(collectSendRefs(state.nodes, state.edges, 'v', 'video')[0].id).toBe('original');
  const request = productPromptRequest(state); expect(request).toMatchObject({ cardId: 'v', model: state.data.video.model, plan, sourceDuration: 6 });
  request.plan.products[0].name = 'mutated'; expect(plan.products[0].name).toBe('鞋子');
});
it('缺图写出名字，旧卡和忙态禁用，无身份图仍交给免费检查标红；手动新组补入plan', () => {
  const state = setup(); state.nodes[1].data.results = [];
  expect(productPromptProblem(state)).toBe('还差 1 张图：商品A · 鞋子');
  state.nodes[1].data.results = [{ type: 'upload', id: 'i' }]; expect(productPromptProblem(state)).toBeNull();
  expect(productPromptProblem({ ...state, data: { ...state.data, productPlan: undefined } })).toContain('没存拆解结果');
  state.nodes.push({ id: 'b', type: 'card', position: { x: 0, y: 0 }, data: { ...newCard('generate', 3, [{ type: 'upload', id: 'b' }]),
    group: { id: 'gb', name: '商品B', productId: 'B', videoId: 'v' }, productRole: { role: 'product' as const, videoId: 'v', productId: 'B' } } });
  state.edges.push({ id: 'b-v', source: 'b', target: 'v' });
  expect(productPromptRequest(state).plan.products).toContainEqual(expect.objectContaining({ id: 'B', name: '商品' }));
  state.nodes[1].data = { ...newCard('generate', 1, [{ type: 'upload', id: 'unknown' }]) };
  expect(productMaterials(state.nodes, state.edges, 'v')[1]).not.toHaveProperty('role');
});
it('组归属优先：放进商品组获得身份；跨视频的组或卡不能冒充本卡商品', () => {
  const state = setup(); state.nodes[1].data = { ...newCard('generate', 1), group: { id: 'g', name: '商品A', productId: 'A', videoId: 'v' } };
  expect(productMaterials(state.nodes, state.edges, 'v')[1]).toMatchObject({ role: 'product', productId: 'A' });
  state.nodes[1].data.group!.videoId = 'other'; expect(productMaterials(state.nodes, state.edges, 'v')[1]).not.toHaveProperty('role');
});
it('原片线缺失或不再是@视频1时不生成；不能把另一视频冒充原片', () => {
  const state = setup(); state.edges.shift();
  state.nodes.push({ id: 'other-video', type: 'card', position: { x: 0, y: 0 }, data: newVideoCard('upload', 0, [{ type: 'upload', id: 'other', media: 'video', seconds: 6 }]) });
  state.edges.unshift({ id: 'o-v', source: 'other-video', target: 'v' });
  expect(productPromptProblem(state)).toContain('原视频');
  state.edges.push({ id: 's-v', source: 'source', target: 'v' });
  expect(productPromptProblem(state)).toContain('@视频1');
});
it('成功填词能撤销，失败保留旧词、不写金额，不自动重试；并发按钮只发一次', async () => {
  const state = setup(); const notify = vi.fn(), onError = vi.fn();
  let resolve!: (v: { videoPrompt: string; warnings: string[]; issues: string[]; yuan: number }) => void;
  const request = vi.fn(() => new Promise<Parameters<typeof resolve>[0]>(done => { resolve = done; }));
  const options = { getState: () => state, request, notify, onError, apply: (patch: object) => Object.assign(state.data, patch) };
  const run = createProductPromptAction(options); const pending = run(); await createProductPromptAction(options)();
  expect(request).toHaveBeenCalledTimes(1); resolve({ videoPrompt: '新词', warnings: ['新提醒'], issues: [], yuan: 0.03 }); await pending;
  expect(state.data.prompt).toBe('新词'); expect(notify.mock.calls[0][0]).toBe('提示词已生成');
  notify.mock.calls[0][1].run(); expect(state.data.prompt).toBe('旧词'); expect(state.data.rewriteWarnings).toEqual(['旧提醒']);
  const failure = vi.fn(async () => { throw Object.assign(Error('看图失败原话'), { yuan: 0.02 }); });
  await createProductPromptAction({ ...options, request: failure })(); expect(failure).toHaveBeenCalledTimes(1);
  expect(state.data.prompt).toBe('旧词'); expect(onError.mock.calls.at(-1)?.[0]).toBe('生成提示词没成功：看图失败原话');
});
it('等待时改词/换图/改身份不覆盖旧响应', async () => {
  const state = setup(); const notify = vi.fn();
  let resolve!: (v: { videoPrompt: string; warnings: string[]; issues: string[]; yuan: number }) => void;
  const pending = createProductPromptAction({ getState: () => state, request: () => new Promise(done => { resolve = done; }), notify,
    onError: () => {}, apply: (patch: object) => Object.assign(state.data, patch) })();
  state.data.prompt = '用户新词'; resolve({ videoPrompt: '过时', warnings: [], issues: [], yuan: 0 }); await pending;
  expect(state.data.prompt).toBe('用户新词'); expect(notify.mock.calls[0][0]).toContain('已保留当前内容');
});
