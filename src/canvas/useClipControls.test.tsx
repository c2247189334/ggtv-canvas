import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useClipControls } from './useClipControls';

const harness = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect); },
  useLayoutEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect); }
}));
const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); vi.unstubAllGlobals(); });

function setup(busy = false) {
  const target = Object.assign(new EventTarget(), { requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() });
  vi.stubGlobal('window', target);
  const element = Object.assign(new EventTarget(), { currentTime: 0, paused: true, ended: false,
    play: vi.fn(async () => { element.paused = false; }), pause: vi.fn(() => { element.paused = true; }) });
  const onClose = vi.fn(), onConfirm = vi.fn(), notify = vi.fn();
  let controls!: ReturnType<typeof useClipControls>;
  function Harness() { controls = useClipControls({ duration: 9, video: { current: element as unknown as HTMLVideoElement }, busy, onClose, onConfirm, notify }); return null; }
  renderToStaticMarkup(<Harness />);
  for (const effect of harness.effects.splice(0)) { const dispose = effect(); if (dispose) cleanup.push(dispose); }
  const key = (key: string, options = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key, code: key === ' ' ? 'Space' : key, ctrlKey: false, metaKey: false, ...options });
    target.dispatchEvent(event); return event;
  };
  return { controls, target, element, key, onClose, onConfirm, notify };
}

it('Esc使用统一弹层消费，忙时不关，Enter也不提交；方向和Delete等不能到画布', () => {
  const h = setup(true), canvasKey = vi.fn();
  h.target.addEventListener('keydown', canvasKey);
  for (const key of ['ArrowLeft', ' ', 'Delete', 'z', 'v', 'h', 'Escape', 'Enter']) expect(h.key(key).defaultPrevented).toBe(true);
  expect(canvasKey).not.toHaveBeenCalled(); expect(h.onClose).not.toHaveBeenCalled(); expect(h.onConfirm).not.toHaveBeenCalled();
});
it('Space控制同一个播放器，方向键跳开头，Ctrl步长1，I/O，Enter提交当前选区', async () => {
  const h = setup(); h.key('ArrowRight'); expect(h.element.currentTime).toBe(0.1);
  h.key('ArrowRight', { ctrlKey: true }); expect(h.element.currentTime).toBe(1.1);
  h.key('ArrowUp'); h.key('Enter'); expect(h.onConfirm).toHaveBeenLastCalledWith({ start: 1.1, end: 4 });
  h.element.currentTime = 2; h.key('i'); expect(h.element.currentTime).toBe(2);
  h.element.currentTime = 5; h.key('o'); h.key('Enter'); expect(h.onConfirm).toHaveBeenLastCalledWith({ start: 2, end: 5 });
  h.key(' '); await Promise.resolve(); expect(h.element.play).toHaveBeenCalledTimes(1); expect(h.element.paused).toBe(false);
  h.key(' '); expect(h.element.paused).toBe(true);
  h.key('Escape'); expect(h.onClose).toHaveBeenCalledTimes(1);
});
it('播到选区结尾回到开头，结束事件恢复播放；播放失败提示原话', async () => {
  const h = setup(); h.element.paused = false; h.element.currentTime = 3.1; h.element.dispatchEvent(new Event('timeupdate'));
  expect(h.element.currentTime).toBe(0);
  h.element.ended = true; h.element.paused = true; h.element.currentTime = 9; h.element.dispatchEvent(new Event('ended'));
  expect(h.element.currentTime).toBe(0); expect(h.element.play).toHaveBeenCalledTimes(1);
  h.element.ended = false; h.element.paused = true; h.element.play.mockRejectedValueOnce(new Error('播放被拒绝'));
  h.key(' '); await Promise.resolve(); await Promise.resolve();
  expect(h.notify).toHaveBeenCalledWith('视频没播起来，请再点播放按钮试一次。');
});
it('暂停时点选区以外只挪播放头，不被循环拉回；只有正在播放才循环', () => {
  const h = setup(); h.element.currentTime = 7; h.element.dispatchEvent(new Event('seeking'));
  expect(h.element.currentTime).toBe(7);
  h.element.paused = false; h.element.dispatchEvent(new Event('timeupdate'));
  expect(h.element.currentTime).toBe(0);
});
