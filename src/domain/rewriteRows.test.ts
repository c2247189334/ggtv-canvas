import { expect, it } from 'vitest';
import type { AssetRef, CardNode } from '@/types';
import type { RewriteItem, RewritePlan } from '@/videoRewriteTypes';
import { compareSecond, frameAspect } from './rewriteRows';
import { measuredRewriteColumn } from './videoRewriteLayout';
import { newCard, newVideoCard } from './cards';
import { fromDoc, toDoc } from './canvasDoc';
import { REWRITE_NEW_SCENE_PURPOSE, rewriteChangeSeconds, scenesInUse } from './videoRewrite';

const source: AssetRef = { type: 'upload', id: 'v', media: 'video', seconds: 12, width: 1080, height: 2160 };
const item = (id: string, kind: RewriteItem['kind'], from: number, to: number, frame: number, extra: Partial<RewriteItem> = {}): RewriteItem =>
  ({ id, kind, desc: id, from, to, frame, ...extra });
const planOf = (items: RewriteItem[]): RewritePlan => ({ summary: '拆解', items, replace: [], changes: [], actions: [], unsure: [] });

it('截图宽高比：整帧照原片，分屏只截半边时那一边减半；没量到尺寸不给', () => {
  expect(frameAspect(source)).toBe(0.5);
  expect(frameAspect(source, 'top')).toBe(1);
  expect(frameAspect(source, 'left')).toBe(0.25);
  expect(frameAspect({ type: 'upload', id: 'x' })).toBeUndefined();
});

it('要换的项截原片哪一秒：衣服用拆解挑的帧；人用自己第一套衣服那帧，没衣服取在场正中；东西不截', () => {
  const plan = planOf([item('P1', '人物', 0, 12, 0), item('P2', '人物', 2, 10, 2), item('C2', '衣服', 6, 12, 8, { person: 'P1' }),
    item('C1', '衣服', 0, 6, 1.5, { person: 'P1' }), item('D1', '道具', 0, 12, 0)]);
  expect(compareSecond(plan.items[4], plan)).toBeUndefined();
  expect(compareSecond(plan.items[2], plan)).toBe(8);
  expect(compareSecond(plan.items[0], plan)).toBe(1.5);
  expect(compareSecond(plan.items[1], plan)).toBe(6);
  const single = planOf([item('P1', '人物', 0, 12, 0), item('C1', '衣服', 3, 12, 4)]);
  expect(compareSecond(single.items[0], single)).toBe(4);
});

const card = (id: string, x: number, y: number, height: number): CardNode =>
  ({ id, type: 'card', position: { x, y }, measured: { width: 280, height }, data: newCard('upload', 0) });

it('一行一对：截图和要补的卡顶边对齐，行高按高的那张、行间隔 40；量好尺寸前不排', () => {
  const nodes = [card('f1', 0, 999, 600), card('b1', 0, 0, 200), card('f2', 0, 0, 300), card('c2', 0, 0, 500), card('c3', 0, 0, 320)];
  const rows = [{ left: 'f1', right: 'b1' }, { left: 'f2', right: 'c2' }, { right: 'c3' }];
  const column = { ids: nodes.map(node => node.id), movableIds: nodes.map(node => node.id), origin: { x: 760, y: 10 }, rows };
  const placed = measuredRewriteColumn(nodes, column)!;
  const at = (id: string) => placed.find(node => node.id === id)!.position;
  expect([at('f1'), at('b1')]).toEqual([{ x: 760, y: 10 }, { x: 1140, y: 10 }]);
  expect([at('f2'), at('c2')]).toEqual([{ x: 760, y: 650 }, { x: 1140, y: 650 }]);
  expect(at('c3')).toEqual({ x: 1140, y: 1190 });
  expect(measuredRewriteColumn(placed, column)).toBe(placed);
  expect(measuredRewriteColumn([{ ...nodes[0], measured: undefined }, ...nodes.slice(1)], column)).toBeNull();
});

it('这两列里上次留下的卡：整行跳过它往下排，不压在上面；别的列的卡不管', () => {
  const old = card('old', 1140, 0, 400), far = card('far', 1520, 0, 2000);
  const nodes = [old, far, card('f1', 0, 0, 300), card('b1', 0, 0, 300)];
  const column = { ids: ['f1', 'b1'], movableIds: ['f1', 'b1'], origin: { x: 760, y: 0 }, rows: [{ left: 'f1', right: 'b1' }] };
  const placed = measuredRewriteColumn(nodes, column)!;
  expect(placed.find(node => node.id === 'f1')!.position).toEqual({ x: 760, y: 440 });
  expect(placed.find(node => node.id === 'b1')!.position).toEqual({ x: 1140, y: 440 });
});

it('换新背景删掉多的背景卡：只算还连着的场景，换场秒数跟着少；跟原片时不动（和小服务同名函数一致）', () => {
  const plan = planOf([item('P1', '人物', 0, 12, 0), item('S1', '场景', 0, 4, 2), item('S2', '场景', 4, 8, 6), item('S3', '场景', 8, 12, 10)]);
  const fresh = (itemId: string, n: number) => ({ tag: `@图片${n}`, purpose: REWRITE_NEW_SCENE_PURPOSE, itemId });
  const video = { ...newVideoCard('generate', 1), rewritePlan: plan };
  video.video.duration = 12;
  expect(rewriteChangeSeconds(video, [fresh('S1', 1), fresh('S2', 2), fresh('S3', 3)])).toEqual([4, 8]);
  expect(rewriteChangeSeconds(video, [fresh('S1', 1), fresh('S3', 2)])).toEqual([8]);
  expect(rewriteChangeSeconds(video, [fresh('S1', 1)])).toEqual([]);
  expect(scenesInUse(plan, [{ tag: '@图片1', purpose: '背景', itemId: 'S1' }])).toBe(plan);
  expect(rewriteChangeSeconds(video)).toEqual([4, 8]);
});

it('emptyAspect 存档读回不丢，乱写的值丢掉', () => {
  const nodes: CardNode[] = [{ id: 'a', type: 'card', position: { x: 0, y: 0 }, data: { ...newCard('generate', 1), emptyAspect: 0.5 } },
    { id: 'b', type: 'card', position: { x: 0, y: 0 }, data: { ...newCard('generate', 2), emptyAspect: 99 } }];
  const back = fromDoc(toDoc({ id: 'c', name: 'n' }, nodes, [])).nodes;
  expect(back[0].data).toMatchObject({ emptyAspect: 0.5 });
  expect(back[1].data).not.toHaveProperty('emptyAspect');
});
