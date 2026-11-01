import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PointerEvent, ReactElement } from 'react';
import { VideoClipTimeline } from './VideoClipTimeline';

function setup() {
  const onRange = vi.fn(), onSeek = vi.fn(); let tree!: ReactElement<Record<string, (event: unknown) => void>>;
  function Harness() { tree = VideoClipTimeline({ duration: 12, range: { start: 2, end: 6 }, time: 0, thumbnails: [], precise: false, snap: false, busy: false, onRange, onSeek }); return tree; }
  renderToStaticMarkup(<Harness />);
  const currentTarget = { getBoundingClientRect: () => ({ left: 0, width: 350 }), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  const event = (second: number, handle?: string) => ({ button: 0, pointerId: 1, clientX: second / 12 * 350,
    preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget,
    target: { closest: () => handle ? { getAttribute: () => handle } : null } } as unknown as PointerEvent<HTMLDivElement>);
  return { onRange, onSeek, tree, event };
}
it('拖左侧和中间跳开头、拖右侧不跳；点选区外只移动播放头', () => {
  const h = setup();
  h.tree.props.onPointerDown(h.event(2, 'start')); h.tree.props.onPointerMove(h.event(3)); h.tree.props.onPointerUp(h.event(3));
  expect(h.onRange).toHaveBeenLastCalledWith({ start: 3, end: 6 }, true);
  h.tree.props.onPointerDown(h.event(6, 'end')); h.tree.props.onPointerMove(h.event(8)); h.tree.props.onPointerUp(h.event(8));
  expect(h.onRange).toHaveBeenLastCalledWith({ start: 2, end: 8 }, false);
  h.tree.props.onPointerDown(h.event(4)); h.tree.props.onPointerMove(h.event(5)); h.tree.props.onPointerUp(h.event(5));
  expect(h.onRange).toHaveBeenLastCalledWith({ start: 3, end: 7 }, true);
  h.onRange.mockClear(); h.tree.props.onPointerDown(h.event(10));
  expect(h.onSeek).toHaveBeenCalledWith(10); expect(h.onRange).not.toHaveBeenCalled();
});
