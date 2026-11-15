import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductInputView } from './ProductInput';

it('入口位置样式沿用小输入框，无背景勾和动作参考；11-15 起只走本机 agent，按钮写免费；缺原话、忙时禁用', () => {
  const props = { text: '鞋子', pending: false, onChange: vi.fn(), onStart: vi.fn() };
  const html = renderToStaticMarkup(<ProductInputView {...props} />);
  expect(html).toContain('panel rewrite-input'); expect(html).toContain('开始拆解（免费）'); expect(html).not.toContain('disabled=""');
  expect(html).not.toContain('checkbox'); expect(html).not.toContain('动作参考');
  for (const change of [{ text: '' }, { pending: true }]) {
    expect(renderToStaticMarkup(<ProductInputView {...props} {...change} />)).toMatch(/<button[^>]*disabled=""/);
  }
});
