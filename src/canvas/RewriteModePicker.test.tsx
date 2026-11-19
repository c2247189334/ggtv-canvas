import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RewriteInputView } from './RewriteInput';
import { RewriteModePicker } from './RewriteModePicker';

const props = { text: '换人', pending: false, keepBackground: true, onChange: vi.fn(), onKeepBackground: vi.fn(), onStart: vi.fn() };

it('11-19 用户定：视频改写输入框最上面三选一，用户起的叫法和举例，默认「露脸 · 声音按原视频」', () => {
  const html = renderToStaticMarkup(<RewriteInputView {...props} onMode={vi.fn()} />);
  expect(html.indexOf('这条视频是哪种？')).toBeLessThan(html.indexOf('你想换什么'));
  const labels = [...html.matchAll(/rewrite-mode__label">([^<]+)</g)].map(match => match[1]);
  expect(labels).toEqual(['露脸 · 声音按原视频', '露脸 · AI 自己配音', '不露脸 · 声音按原视频']);
  const hints = [...html.matchAll(/rewrite-mode__hint">([^<]+)</g)].map(match => match[1]);
  expect(hints).toEqual(['跳舞、走秀', '口播、讲解', '只拍商品和手脚']);
  expect(html).toMatch(/aria-checked="true"[^>]*><span class="rewrite-mode__label">露脸 · 声音按原视频</);
  // 露脸两种照旧有背景 / 衣服勾和动作参考。
  expect(html).toContain('背景和原片保持一致'); expect(html).toContain('动作参考');
  expect(renderToStaticMarkup(<RewriteInputView {...props} />)).not.toContain('这条视频是哪种？');
});

it('原片没有声音：「AI 自己配音」灰掉、灰字写原因；问号里写每种怎么做，不露脸不能换人', () => {
  const html = renderToStaticMarkup(<RewriteModePicker mode="face" noAudio onMode={vi.fn()} />);
  expect(html).toMatch(/disabled=""><span class="rewrite-mode__label">露脸 · AI 自己配音<\/span><span class="rewrite-mode__hint">原片没有声音</);
  expect(renderToStaticMarkup(<RewriteModePicker mode="talking" onMode={vi.fn()} />)).toMatch(/aria-checked="true"[^>]*><span class="rewrite-mode__label">露脸 · AI 自己配音</);
});

it('点选：点别的那种才回调，点已选中的不回调', () => {
  const onMode = vi.fn();
  const element = RewriteModePicker({ mode: 'face', onMode });
  const buttons = element.props.children[1].props.children as Array<{ props: { onClick: () => void } }>;
  buttons[0].props.onClick(); expect(onMode).not.toHaveBeenCalled();
  buttons[1].props.onClick(); expect(onMode).toHaveBeenCalledWith('talking');
  buttons[2].props.onClick(); expect(onMode).toHaveBeenCalledWith('faceless');
});
