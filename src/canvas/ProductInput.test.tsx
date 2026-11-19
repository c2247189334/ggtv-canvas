import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductInputView } from './ProductInput';

it('入口位置样式沿用小输入框，无背景勾和动作参考；11-15 起只走本机 agent，按钮写免费（11-19 起写「开始改写」）；缺原话、忙时禁用', () => {
  const props = { text: '鞋子', pending: false, onChange: vi.fn(), onStart: vi.fn() };
  const html = renderToStaticMarkup(<ProductInputView {...props} />);
  expect(html).toContain('panel rewrite-input'); expect(html).toContain('>开始改写（免费）<'); expect(html).not.toContain('disabled=""');
  expect(html).not.toContain('checkbox'); expect(html).not.toContain('动作参考');
  for (const change of [{ text: '' }, { pending: true }]) {
    expect(renderToStaticMarkup(<ProductInputView {...props} {...change} />)).toMatch(/<button[^>]*disabled=""/);
  }
});

it('11-19 用户定：最上面三选一，选中的是「不露脸 · 声音按原视频」；点露脸那两种交给外面切输入框', () => {
  const onMode = vi.fn();
  const html = renderToStaticMarkup(<ProductInputView text="鞋子" pending={false} onChange={vi.fn()} onStart={vi.fn()} onMode={onMode} />);
  expect(html.indexOf('这条视频是哪种？')).toBeLessThan(html.indexOf('你想换什么'));
  expect(html).toMatch(/aria-checked="true"[^>]*><span class="rewrite-mode__label">不露脸 · 声音按原视频</);
  expect(html).toMatch(/aria-checked="false"[^>]*><span class="rewrite-mode__label">露脸 · 声音按原视频</);
});
