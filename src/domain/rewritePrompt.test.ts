import { expect, it, vi } from 'vitest';
import { newCard, newVideoCard } from './cards';
import { createLookPromptAction, lookPromptPaid, lookPromptProblem, lookPromptRequest } from './rewritePrompt';
import type { CardNode } from '@/types';
import type { WriteVideoResult } from '@/videoRewriteApiTypes';
import type { RewritePlan } from '@/videoRewriteTypes';

function setup() {
  const data = { ...newVideoCard('generate', 2), rewriteId: 'batch', rewriteUserText: '换衣服', prompt: '原来的词', rewriteWarnings: ['旧提醒'],
    rewriteSource: { type: 'upload' as const, id: 'source', media: 'video' as const, seconds: 6 },
    rewritePlan: { summary: '展示', items: [{ id: 'c', kind: '衣服' as const, desc: '原视频长裙', from: 0, to: 6, frame: 2 }],
      replace: ['c'], changes: [], actions: [{ from: 0, to: 6, desc: '站立' }], unsure: [] } };
  data.video.duration = 6;
  const nodes: CardNode[] = [{ id: 'image', type: 'card', position: { x: 0, y: 0 },
    data: { ...newCard('upload', 1, [{ type: 'upload', id: 'picture' }]), title: '衣服 1', rewriteItem: data.rewritePlan.items[0] } }];
  const state = { id: 'video', data, nodes, edges: [{ source: 'image', target: 'video' }] };
  let resolve!: (value: WriteVideoResult) => void, reject!: (error: Error) => void;
  const request = vi.fn(() => new Promise<WriteVideoResult>((yes, no) => { resolve = yes; reject = no; }));
  const notify = vi.fn(), onError = vi.fn(), onLoading = vi.fn(); let time = 0;
  const options = { getState: () => state, request, notify, onError, onLoading, now: () => time,
    apply: (patch: object) => { Object.assign(state.data, patch); } };
  const run = createLookPromptAction(options);
  return { state, run, request, notify, onError, onLoading, options, resolve: (result: WriteVideoResult) => resolve(result),
    reject: (error: Error) => reject(error), time: (value: number) => { time = value; } };
}
const result: WriteVideoResult = { videoPrompt: '新词', warnings: ['拆解没把握：上方那团看不清'], issues: [], yuan: 0, costUnknown: false };

it('旧卡、缺图、正在写三种禁用原因清楚；缺图数和名字按当前连线', () => {
  const s = setup();
  expect(lookPromptProblem({ ...s.state, data: { ...s.state.data, rewritePlan: undefined } })).toContain('旧版做的，没存拆解结果');
  s.state.nodes[0].data.results = [];
  s.state.nodes.push({ ...s.state.nodes[0], id: 'other', data: { ...s.state.nodes[0].data, title: '衣服 2' } });
  s.state.edges.push({ source: 'other', target: 'video' });
  expect(lookPromptProblem(s.state)).toBe('还差 2 张图：衣服 1、衣服 2');
  expect(lookPromptProblem(s.state, true)).toBe('正在生成提示词，请稍等。');
});

it('请求从当前卡设置和快照取单子，图片按当前入线附当前结果，支持上传和作品', () => {
  const s = setup();
  expect(lookPromptRequest(s.state)).toMatchObject({ cardId: 'video', plan: s.state.data.rewritePlan, userText: '换衣服', duration: 6,
    materials: [{ tag: '@图片1', itemId: 'c', originalDesc: '原视频长裙', asset: { type: 'upload', id: 'picture' } }] });
  s.state.nodes[0].data.results.push({ type: 'work', id: 'new-picture' }); s.state.nodes[0].data.page = 1;
  expect(lookPromptRequest(s.state).materials[0].asset).toEqual({ type: 'work', id: 'new-picture' });
});

it('生成时长跟视频卡当前设置，原片时长仅用于检查拆解单，不重复存卡', () => {
  const s = setup(); s.state.data.video.duration = 4;
  expect(lookPromptRequest(s.state)).toMatchObject({ duration: 4, sourceDuration: 6, plan: s.state.data.rewritePlan });
});

it('空词也能写，一次点击只发一单（跨控制器同卡也锁），成功覆盖/提醒/十秒撤销', async () => {
  const s = setup(); s.state.data.prompt = '';
  const pending = s.run(); await s.run(); await createLookPromptAction(s.options)();
  expect(s.request).toHaveBeenCalledTimes(1); expect(s.onLoading).toHaveBeenCalledWith(true);
  s.resolve(result); await pending;
  expect(s.state.data).toMatchObject({ prompt: '新词', rewriteWarnings: result.warnings });
  const [message, action, ms] = s.notify.mock.calls[0];
  expect(message).toBe('提示词已生成（不花钱）'); expect(action.label).toBe('撤销'); expect(ms).toBe(10000);
  s.time(9999); action.run();
  expect(s.state.data).toMatchObject({ prompt: '', rewriteWarnings: ['旧提醒'] });
});

it('撤销过期或后来编辑不覆盖，换图后允许用户再次点击再发一单', async () => {
  for (const edited of [false, true]) {
    const s = setup(); const pending = s.run(); s.resolve(result); await pending;
    if (edited) s.state.data.prompt = '用户继续改'; else s.time(10000);
    s.notify.mock.calls[0][1].run(); expect(s.state.data.prompt).toBe(edited ? '用户继续改' : '新词');
    s.state.nodes[0].data.results = [{ type: 'work', id: 'changed' }];
    const again = s.run(); s.resolve({ ...result, warnings: ['新提醒'] }); await again;
    expect(s.request).toHaveBeenCalledTimes(2); expect(s.state.data.rewriteWarnings).toEqual(['新提醒']);
  }
});

function addPerson(s: ReturnType<typeof setup>) {
  const plan = s.state.data.rewritePlan as RewritePlan;
  plan.items.push({ id: 'p', kind: '人物', desc: '原视频女生', from: 0, to: 6, frame: 0 }); plan.replace.push('p');
  s.state.nodes.push({ id: 'person', type: 'card', position: { x: 0, y: 0 },
    data: { ...newCard('upload', 2, [{ type: 'upload', id: 'face' }]), title: '人物', rewriteItem: plan.items[1] } });
  s.state.edges.push({ source: 'person', target: 'video' });
}

it('连了要换的人物图才要看图花钱；只连衣服图照旧免费', () => {
  const s = setup();
  expect(lookPromptPaid(s.state)).toBe(false);
  addPerson(s);
  expect(lookPromptPaid(s.state)).toBe(true);
  s.state.data.rewritePlan.replace = ['c'];
  expect(lookPromptPaid(s.state)).toBe(false);
});

it('看图花了钱：成功提示写已花多少；失败也写已花多少', async () => {
  const s = setup(); addPerson(s);
  const pending = s.run(); s.resolve({ ...result, yuan: 0.018 }); await pending;
  expect(s.notify.mock.calls[0][0]).toBe('提示词已生成，已花 ¥0.018');
  const t = setup(); addPerson(t);
  const failed = t.run(); t.reject(Object.assign(Error('看图回话不对'), { yuan: 0.02, costUnknown: false })); await failed;
  expect(t.onError.mock.calls.at(-1)?.[0]).toBe('生成提示词没成功：看图回话不对（已花 ¥0.02）');
});

it('缺图不请求；失败显示原话，保留原词与提醒，无自动重试', async () => {
  const s = setup(); const original = structuredClone(s.state.data);
  const pending = s.run(); s.reject(Error('改写单不合法原话')); await pending;
  expect(s.state.data).toEqual(original); expect(s.request).toHaveBeenCalledTimes(1);
  expect(s.onError.mock.calls.at(-1)?.[0]).toBe('生成提示词没成功：改写单不合法原话');
  expect(s.notify.mock.calls.at(-1)?.[0]).toContain('改写单不合法原话'); expect(s.onLoading).toHaveBeenLastCalledWith(false);
  s.state.nodes[0].data.results = []; await s.run(); expect(s.request).toHaveBeenCalledTimes(1);
});

it('生成期间换图或改词，旧回话不覆盖当前内容', async () => {
  const s = setup(); const pending = s.run(); s.state.data.prompt = '等待时新编辑'; s.resolve(result); await pending;
  expect(s.state.data.prompt).toBe('等待时新编辑'); expect(s.notify.mock.calls.at(-1)?.[0]).toBe('生成期间素材或提示词已变动，已保留当前内容。');
});
