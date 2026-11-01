import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RewriteProgress } from './RewriteProgress';
import { newVideoCard } from '@/domain/cards';
it('原视频运行时只有状态行，不拦拖卡；完成消失', () => {
  const data = { ...newVideoCard('upload', 1), rewriteBusy: 'analyzing' as const,
    rewriteStatus: { status: 'pending' as const } };
  const pending = renderToStaticMarkup(<RewriteProgress data={data} />);
  expect(pending).toContain('正在拆解'); expect(pending).toContain('busy-spinner'); expect(pending).not.toContain('已用');
  expect(pending).not.toContain('nodrag');
  expect(renderToStaticMarkup(<RewriteProgress data={{ ...data, rewriteBusy: undefined, rewriteStatus: undefined }} />)).toBe('');
});
it('失败保留原话与已花金额，未知费用明确标示，未结束存档说明重来', () => {
  const data = { ...newVideoCard('upload', 1), rewriteStatus: { status: 'failed' as const, error: '第二轮断线', yuan: 0.012, costUnknown: true } };
  const html = renderToStaticMarkup(<RewriteProgress data={data} />);
  expect(html).toContain('第二轮断线'); expect(html).toContain('已花 ¥0.012'); expect(html).toContain('另有费用待确认');
  expect(renderToStaticMarkup(<RewriteProgress data={{ ...data, rewriteStatus: { status: 'interrupted' } }} />)).toContain('上次没做完，再点一次「视频改写」重来');
});
