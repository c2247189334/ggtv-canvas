import { expect, it } from 'vitest';
import { absorbJob, newVideoCard } from './cards';
import { toDoc } from './canvasDoc';
import { absorbJobViews } from './jobResults';
import type { JobView, CardNode } from '@/types';

it('查询断网提示随轮询更新、恢复与终态清除，不删除单号或存入画布', () => {
  const card = { ...newVideoCard('generate', 1), jobs: ['j'], phase: 'waiting' as const };
  const job = { id: 'j', kind: 'video', status: 'running', phase: 'waiting', createdAt: '', count: 1,
    works: [], error: null, warning: '暂时查不到火山的结果，网络恢复后会自动接着查。' } as JobView;
  const warned = absorbJob(card, job);
  expect(warned).toMatchObject({ jobs: ['j'], jobWarning: job.warning });
  expect(warned.note).toBeNull();
  const node: CardNode = { id: 'v', type: 'card', position: { x: 0, y: 0 }, data: warned };
  expect(toDoc({ id: 'c', name: '画布' }, [node], []).nodes[0].data).not.toHaveProperty('jobWarning');
  const recovered = absorbJob(warned, { ...job, warning: null });
  expect(recovered.jobWarning).toBeNull(); expect(recovered.jobs).toEqual(['j']);
  const finished = absorbJob(warned, { ...job, status: 'succeeded', works: ['w'], warning: null });
  expect(finished.jobWarning).toBeUndefined(); expect(finished.jobs).toEqual([]);
});

it('同卡多单中一单仍断网，其他单健康或完成也不能把提醒抹掉', () => {
  const node: CardNode = { id: 'v', type: 'card', position: { x: 0, y: 0 },
    data: { ...newVideoCard('generate', 1), jobs: ['offline', 'healthy'] } };
  const base: JobView = { id: 'offline', kind: 'video', status: 'running', phase: 'waiting', createdAt: '', count: 1,
    works: [], error: null, warning: '暂时查不到火山的结果' };
  for (const status of ['running', 'succeeded'] as const) {
    const views: JobView[] = [base, { ...base, id: 'healthy', status, warning: null }];
    expect(absorbJobViews([node], [], views)[0].data.jobWarning).toBe(base.warning);
  }
});
