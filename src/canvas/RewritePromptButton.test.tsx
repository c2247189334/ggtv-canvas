import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RewritePromptButtonView } from './RewritePromptButton';

it('10-30 起提示词由代码拼：按钮写明免费、不读估价；缺图显示张数与名字并禁用，补齐可点', () => {
  const missing = renderToStaticMarkup(<RewritePromptButtonView reason="还差 2 张图：衣服 2、衣服 3" loading={false} onRun={vi.fn()} />);
  expect(missing).toContain('还差 2 张图：衣服 2、衣服 3');
  expect(missing).toContain('生成提示词（免费）'); expect(missing).toContain('disabled=""');
  const ready = renderToStaticMarkup(<RewritePromptButtonView reason={null} loading={false} onRun={vi.fn()} />);
  expect(ready).toContain('生成提示词（免费）'); expect(ready).not.toContain('disabled=""'); expect(ready).not.toContain('¥');
});

it('连了要换的人物图：按钮写看图估价、看图中写「正在看图…」；估价没读到时不能点', () => {
  const paid = renderToStaticMarkup(<RewritePromptButtonView reason={null} loading={false} paid estimate={0.03} onRun={vi.fn()} />);
  expect(paid).toContain('生成提示词 约 ¥0.03'); expect(paid).not.toContain('disabled=""'); expect(paid).not.toContain('免费');
  const reading = renderToStaticMarkup(<RewritePromptButtonView reason={null} loading={false} paid estimate={null} onRun={vi.fn()} />);
  expect(reading).toContain('生成提示词 估价读取中…'); expect(reading).toContain('disabled=""');
  const looking = renderToStaticMarkup(<RewritePromptButtonView reason="正在生成提示词，请稍等。" loading paid estimate={0.03} onRun={vi.fn()} />);
  expect(looking).toContain('正在看图…'); expect(looking).toContain('disabled=""');
});

it('生成中禁用，防连点', () => {
  const running = renderToStaticMarkup(<RewritePromptButtonView reason="正在生成提示词，请稍等。" loading onRun={vi.fn()} />);
  expect(running).toContain('正在生成…'); expect(running).toContain('disabled=""');
});
