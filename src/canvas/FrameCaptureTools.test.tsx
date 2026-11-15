import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { CardTools } from './CardTools';
import { FrameCaptureItems } from './FrameCaptureTools';

vi.mock('@xyflow/react', () => ({ Position: { Top: 'top' }, NodeToolbar: ({ children }: { children: ReactNode }) => children }));
vi.mock('./boardContext', () => ({ useBoard: () => ({ openViewer: () => {} }) }));

const text = (html: string) => html.replace(/<[^>]*>/g, '');
const playhead = () => ({ time: 0, duration: 9 });

it('11-09 用户定：视频截图是下载左边的小图标，点开三项；原视频卡在竖线后面，深度卡也有', () => {
  const video = renderToStaticMarkup(<CardTools asset={{ type: 'upload', id: 'v', media: 'video', seconds: 9 }} title="视频 1" media="video"
    cardId="v" frame={{ cardId: 'v', playhead }} />);
  const order = ['>更多 ▾<', 'card-tools__sep', 'aria-label="视频截图"', 'aria-label="下载"', 'aria-label="预览"'].map(part => video.indexOf(part));
  expect(order.every(index => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(video).toMatch(/aria-label="视频截图"[^>]*title="视频截图"[^>]*aria-haspopup="menu" aria-expanded="false"/);
  for (const hidden of ['截取当前帧', '截取首帧', '截取尾帧']) expect(video).not.toContain(hidden);

  const depth = renderToStaticMarkup(<CardTools asset={{ type: 'work', id: 'd', depth: true }} title="视频 2 · 深度" media="video"
    frame={{ cardId: 'd', playhead }} />);
  expect(depth).toContain('aria-label="视频截图"');
  expect(depth).not.toContain('card-tools__sep');
  expect(text(depth)).toBe('');
  const image = renderToStaticMarkup(<CardTools asset={{ type: 'upload', id: 'i' }} title="图片 1" media="image" />);
  expect(image).not.toContain('视频截图');
});

it('菜单三项依次：截取当前帧、截取首帧、截取尾帧，点哪项传哪种', () => {
  const picked: string[] = [];
  const element = FrameCaptureItems({ onPick: kind => picked.push(kind) });
  const html = renderToStaticMarkup(element);
  const order = ['截取当前帧', '截取首帧', '截取尾帧'].map(name => html.indexOf(`>${name}<`));
  expect(order.every(index => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(html.match(/role="menuitem"/g)).toHaveLength(3);
  const buttons = (element.props as { children: Array<{ props: { onClick: () => void } }> }).children;
  buttons.forEach(button => button.props.onClick());
  expect(picked).toEqual(['current', 'first', 'last']);
});
