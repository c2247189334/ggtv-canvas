import { expect, it } from 'vitest';
import * as recovery from './localRecovery';
import { newVideoCard } from './cards';
import { fromDoc, toDoc } from './canvasDoc';
import { settleDepth } from './localMedia';
import type { CardNode, DepthJobView } from '@/types';
const pending = (id: string, source: 'depth' | 'mesh' = 'depth'): CardNode => ({ id, type: 'card', position: { x: 0, y: 0 },
  data: { ...newVideoCard(source, 1), startedAt: '2026-10-31T12:00:00Z', mediaSource: { type: 'upload', id: 'u', media: 'video' } } });
const job = (kind: 'depth' | 'mesh', status: DepthJobView['status'] = 'running') => ({ id: 'job', cardId: 'child', kind, status,
  count: 1, createdAt: '', phase: status === 'running' ? 'processing' as const : null, works: [], error: null, errorCode: null,
  source: { type: 'upload' as const, id: 'u' }, resolution: '480p' as const });

it('刷新还原的缺单号卡按卡id接回任务，正在执行的继续现有轮询并能正常收结果', () => {
  const loaded = fromDoc(toDoc({ id: 'c', name: 'c' }, [pending('child')], [])).nodes;
  const result = recovery.restoreLocalJobs(loaded, [job('depth')]);
  expect(result[0].data.depthJobId).toBe('job');
  const done = settleDepth(result[0].data, { ...job('depth'), status: 'succeeded', phase: null, works: ['work'] });
  expect(done.results).toEqual([{ type: 'work', id: 'work', media: 'video', depth: true }]);
  expect(done.startedAt).toBeUndefined(); expect(done.depthJobId).toBeUndefined();
});
it('找不到、错种类的任务都停止转圈并给中文重新操作提示', () => {
  for (const views of [[], [job('mesh')]]) {
    const restored = recovery.restoreLocalJobs([pending('child')], views);
    expect(restored[0].data).toMatchObject({ note: '上次没做完，可以再点一次', results: [] });
    expect(restored[0].data.startedAt).toBeUndefined(); expect(restored[0].data.depthJobId).toBeUndefined();
  }
});
it('白模已完成或失败都立即接回终态，旧结果及已有单号不被重新发单', () => {
  const mesh = pending('child', 'mesh');
  const done = recovery.restoreLocalJobs([mesh], [{ ...job('mesh', 'succeeded'), works: ['w'] }]);
  expect(done[0].data.results).toEqual([{ type: 'work', id: 'w', media: 'video', mesh: true }]);
  expect(done[0].data.startedAt).toBeUndefined();
  const failed = recovery.restoreLocalJobs([mesh], [{ ...job('mesh', 'failed'), error: '白模没算完，请重试' }]);
  expect(failed[0].data.note).toBe('白模没算完，请重试'); expect(failed[0].data.startedAt).toBeUndefined();
  const tracked = pending('tracked'); tracked.data.depthJobId = 'existing';
  const ready = pending('ready'); ready.data.results = [{ type: 'work', id: 'old' }];
  expect(recovery.localRecoveryIds([mesh, tracked, ready])).toEqual(['child']);
  expect(recovery.restoreLocalJobs([tracked, ready], [])).toEqual([tracked, ready]);
});

it('查询暂时失败停止转圈但保留恢复标记，下次读档仍能查询并清掉临时提示', () => {
  const unavailable = recovery.restoreLocalJobs([pending('child')], null);
  expect(unavailable[0].data).toMatchObject({ note: '暂时查不到本机任务记录，请刷新页面重试', startedAt: '2026-10-31T12:00:00Z' });
  const loaded = fromDoc(toDoc({ id: 'c', name: 'c' }, unavailable, [])).nodes;
  expect(recovery.localRecoveryIds(loaded)).toEqual(['child']);
  const found = recovery.restoreLocalJobs(loaded, [job('depth')]);
  expect(found[0].data).toMatchObject({ depthJobId: 'job', note: null });
  const missing = recovery.restoreLocalJobs(loaded, []);
  expect(missing[0].data).toMatchObject({ note: '上次没做完，可以再点一次' });
  expect(missing[0].data.startedAt).toBeUndefined();
});
