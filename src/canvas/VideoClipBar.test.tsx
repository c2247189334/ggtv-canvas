import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VideoClipBarView, ClipShortcutHelp } from './VideoClipBar';

const props = { duration: 9, range: { start: 0, end: 3 }, time: 0, thumbnails: [], precise: false,
  snap: false, loop: true, busy: false, help: false, onClose: vi.fn(), onHelp: vi.fn(),
  onSnap: vi.fn(), onLoop: vi.fn(), onConfirm: vi.fn(), onRange: vi.fn(), onSeek: vi.fn() };

it('剪辑条有退出、分隔、快捷键、时间条、吸附、循环和确认，默认标签3.00 s', () => {
  const html = renderToStaticMarkup(<VideoClipBarView {...props} />);
  for (const label of ['退出', '快捷键', '时间条', '左把手', '右把手', '开启整数秒吸附', '关闭选区循环播放', '确认剪辑']) {
    expect(html).toContain(`aria-label="${label}"`);
  }
  expect(html).toContain('role="separator"');
  expect(html).toContain('3.00 s');
  expect(html).not.toContain('截取中…');
  const enabled = renderToStaticMarkup(<VideoClipBarView {...props} snap loop={false} />);
  expect(enabled).toContain('关闭整数秒吸附'); expect(enabled).toContain('开启选区循环播放');
});

it('处理中确认按钮禁用、转圈，显示截取中，退出也不能点', () => {
  const html = renderToStaticMarkup(<VideoClipBarView {...props} busy />);
  expect(html).toMatch(/<button[^>]*aria-label="确认剪辑"[^>]*disabled=""/);
  expect(html).toMatch(/<button[^>]*aria-label="退出"[^>]*disabled=""/);
  expect(html).toContain('busy-spinner'); expect(html).toContain('截取中…');
});

it('快捷键面板有两列八行和独立关闭按钮，按键显示为kbd', () => {
  const html = renderToStaticMarkup(<ClipShortcutHelp onClose={vi.fn()} />);
  for (const text of ['快捷键', '移动选区', '扩展/收缩选区', '设置出点入点', '退出', '精确模式', '快速调整', '播放/暂停', '确认剪辑']) expect(html).toContain(text);
  expect(html.match(/class="clip-help__row"/g)).toHaveLength(8);
  expect(html).toContain('<kbd>Shift</kbd>'); expect(html).toContain('aria-label="关闭快捷键"');
});

it('12张缩略图，选区外压暗，播放头和Shift半秒刻度', () => {
  const html = renderToStaticMarkup(<VideoClipBarView {...props} duration={12} precise thumbnails={Array.from({ length: 12 }, (_, i) => `data:image/jpeg;base64,${i}`)} />);
  expect(html.match(/<img /g)).toHaveLength(12);
  expect(html.match(/class="clip-timeline__tick"/g)).toHaveLength(23);
  expect(html).toContain('clip-timeline__shade'); expect(html).toContain('clip-timeline__head');
  expect(renderToStaticMarkup(<VideoClipBarView {...props} />)).not.toContain('clip-timeline__tick');
});
