import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelpTip } from './HelpTip';

it('平时只露问号，说明藏起来、读屏能读到；不开气泡', () => {
  const html = renderToStaticMarkup(<HelpTip>深度会带上原人物的发型</HelpTip>);
  expect(html).toMatch(/^<button type="button" class="help-tip" aria-label="说明" aria-describedby="([^"]+)"/);
  const id = html.match(/aria-describedby="([^"]+)"/)![1];
  expect(html).toContain(`<span id="${id}" hidden="">深度会带上原人物的发型</span>`);
  expect(html).toContain('<span class="help-tip__mark" aria-hidden="true">?</span>');
  expect(html).not.toContain('role="tooltip"');
});

it('带小字时小字在问号前，名字一起读', () => {
  const html = renderToStaticMarkup(<HelpTip label="3 条提醒" name="提醒">x</HelpTip>);
  expect(html).toContain('aria-label="3 条提醒，提醒"');
  expect(html.indexOf('help-tip__label">3 条提醒')).toBeLessThan(html.indexOf('help-tip__mark'));
});
