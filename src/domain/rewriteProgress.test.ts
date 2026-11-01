import { expect, it } from 'vitest';
import { restoreRewriteProgress, rewriteCharge } from './rewriteProgress';
import { newCard, newVideoCard } from './cards';
import type { CardNode, VideoCardData } from '@/types';

function source(status: VideoCardData['rewriteStatus'] = { status: 'pending' }): CardNode {
  const data: VideoCardData = { ...newVideoCard('upload', 1, [{ type: 'upload', id: 'v', media: 'video', seconds: 6 }]),
    rewriteBusy: 'analyzing', rewriteStatus: status };
  return { id: 'source', type: 'card', position: { x: 0, y: 0 }, data };
}

it('已确认金额累计，缺少回执的付费请求标为费用待确认', () => {
  expect(rewriteCharge({ yuan: 0.04, costUnknown: false }, { yuan: 0.01, costUnknown: true })).toEqual({ yuan: 0.05, costUnknown: true });
  expect(rewriteCharge({ yuan: 0, costUnknown: false }, new Error('断线'))).toEqual({ yuan: 0, costUnknown: true });
  expect(rewriteCharge({ yuan: 0, costUnknown: false }, { yuan: 0, costUnknown: false })).toEqual({ yuan: 0, costUnknown: false });
});

it('撤销恢复回来的「正在改写」若这页没在跑，改成上次没做完并清瞬态，不改原卡', () => {
  const original = source(); const nodes = [original];
  const restored = restoreRewriteProgress(nodes, new Set());
  expect(restored).not.toBe(nodes);
  expect(restored[0].data).toMatchObject({ rewriteStatus: { status: 'interrupted' }, results: original.data.results });
  expect(restored[0].data).not.toHaveProperty('rewriteBusy');
  expect(original.data.rewriteBusy).toBe('analyzing');
});

it('仍在跑的来源、已失败的来源和普通卡都不动，无改动返回原数组', () => {
  const failed = { ...source({ status: 'failed', error: '断线', yuan: 0.02, costUnknown: true }), id: 'failed' };
  const image: CardNode = { id: 'image', type: 'card', position: { x: 0, y: 0 }, data: newCard('generate', 2) };
  const running = source(); const nodes = [running, failed, image];
  expect(restoreRewriteProgress(nodes, new Set(['source']))).toBe(nodes);
});
