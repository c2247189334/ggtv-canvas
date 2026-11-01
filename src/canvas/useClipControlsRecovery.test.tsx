import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useClipControls } from './useClipControls';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], refs: [] as Array<{ current: unknown }>, cursor: 0, ref: 0, effect: 0,
  effects: [] as Array<{ deps: unknown[]; cleanup?: () => void }>, pending: [] as Array<() => void> }));
vi.mock('react', async original => {
  const effect = (run: () => void | (() => void), deps: unknown[] = []) => {
    const index = hooks.effect++, previous = hooks.effects[index];
    if (previous && deps.length === previous.deps.length && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
    hooks.pending.push(() => { previous?.cleanup?.(); hooks.effects[index] = { deps, cleanup: run() || undefined }; });
  };
  return { ...await original<typeof import('react')>(), useEffect: effect, useLayoutEffect: effect,
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.values[index], (next: unknown) => { hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next; }];
    }, useRef: (current: unknown) => { const index = hooks.ref++; return hooks.refs[index] ?? (hooks.refs[index] = { current }); } };
});

it('原视频网络重试重建后，选区保持，Space和循环监听转接新播放器', () => {
  hooks.values = []; hooks.refs = []; hooks.effects = []; hooks.pending = [];
  const target = Object.assign(new EventTarget(), { requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() });
  // Node的EventTarget移除捕获监听需对象参数，归一成浏览器的捕获参数语义。
  const remove = target.removeEventListener.bind(target);
  target.removeEventListener = (type, callback, options) => remove(type, callback, typeof options === 'boolean' ? { capture: options } : options);
  vi.stubGlobal('window', target);
  const player = () => {
    const element = Object.assign(new EventTarget(), { currentTime: 0, paused: true, ended: false,
      play: vi.fn(async () => { element.paused = false; }), pause: vi.fn(() => { element.paused = true; }) });
    return element;
  };
  const old = player(), fresh = player(), video = { current: old as unknown as HTMLVideoElement };
  let version = 0, controls!: ReturnType<typeof useClipControls>;
  function Harness() { controls = useClipControls({ duration: 9, video, playerVersion: version, busy: false,
    onClose: vi.fn(), onConfirm: vi.fn(), notify: vi.fn() }); return null; }
  const render = () => {
    hooks.cursor = 0; hooks.ref = 0; hooks.effect = 0; renderToStaticMarkup(<Harness />);
    for (const effect of hooks.pending.splice(0)) effect();
  };
  const key = (key: string) => target.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key, code: key === ' ' ? 'Space' : key }));
  try {
    render(); controls.onRange({ start: 1, end: 4 }, true); render();
    video.current = fresh as unknown as HTMLVideoElement; version++; render();
    key(' '); expect(fresh.play).toHaveBeenCalledTimes(1); expect(old.play).not.toHaveBeenCalled();
    expect(controls.range).toEqual({ start: 1, end: 4 });
    fresh.currentTime = 4.1; fresh.dispatchEvent(new Event('timeupdate')); expect(fresh.currentTime).toBe(1);
  } finally { for (const effect of hooks.effects) effect.cleanup?.(); vi.unstubAllGlobals(); }
});
