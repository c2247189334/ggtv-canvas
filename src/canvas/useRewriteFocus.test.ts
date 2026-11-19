import { beforeEach, expect, it, vi } from 'vitest';
import { newVideoCard } from '@/domain/cards';
import { TOOLBAR_SPACE, rewriteFocusViewport } from '@/domain/rewriteFocus';
import { useCardFocus, useRewriteFocus } from './useRewriteFocus';

const state = vi.hoisted(() => ({ frame: 0, readyAt: 0, appearsAt: 0, deselectAt: Infinity, hidden: 0,
  sizes: new Map<number, number>(), selectors: [] as string[], setViewport: vi.fn() }));
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({
    getNode: () => ({ id: 'v', selected: state.frame < state.deselectAt, position: { x: 860, y: 534 }, data: newVideoCard('generate', 1) }),
    getInternalNode: () => ({ measured: { width: 280, height: 426 } }),
    getZoom: () => 1, setViewport: state.setViewport
  }),
  useStoreApi: () => ({ getState: () => ({ width: 1600, height: 1100 }) })
}));

beforeEach(() => {
  state.frame = 0; state.readyAt = 0; state.appearsAt = 0; state.deselectAt = Infinity; state.hidden = 0;
  state.selectors = []; state.sizes.clear(); state.setViewport.mockReset();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const frame = ++state.frame; queueMicrotask(() => callback(frame * 16)); return frame;
  });
  vi.stubGlobal('CSS', { escape: (id: string) => id });
  vi.stubGlobal('document', { querySelector: (selector: string) => {
    state.selectors.push(selector);
    if (!selector.includes(':has(.panel)')) return { getBoundingClientRect: () => ({ width: 200, height: 40 }) };
    if (state.frame < state.appearsAt) return null;
    return {
      querySelector: () => ({ getAttribute: () => state.frame >= state.readyAt ? 'true' : 'false',
        ...(state.hidden ? { scrollHeight: 300 + state.hidden, clientHeight: 300 } : {}) }),
      getBoundingClientRect: () => ({ width: 560, height: state.sizes.get(state.frame) ?? 387 })
    };
  } });
});

it('同卡有按钮工具条时量带.panel的提示词面板，卡和面板一同居中入屏', async () => {
  await useRewriteFocus()('v');
  const expected = rewriteFocusViewport({ x: 860, y: 534, width: 280, height: 426 },
    { width: 560, height: 387 }, { width: 1600, height: 1100 }, 1);
  expect(state.setViewport).toHaveBeenCalledWith(expected, { duration: 300 });
  expect(state.selectors.every(selector => selector.includes(':has(.panel)'))).toBe(true);
  expect(expected.y + 534 * expected.zoom + 426 * expected.zoom + 14 + 387).toBeLessThanOrEqual(1076);
  expect(expected.zoom).toBeLessThanOrEqual(1);
});

it('等选中后的面板出现、配置就绪且量到稳定尺寸，不能提前用按钮条或兜底尺寸', async () => {
  state.appearsAt = 5; state.readyAt = 8;
  state.sizes.set(8, 320);
  await useRewriteFocus()('v');
  expect(state.frame).toBeGreaterThanOrEqual(10);
  const view = state.setViewport.mock.calls[0]?.[0];
  expect(view).toEqual(rewriteFocusViewport({ x: 860, y: 534, width: 280, height: 426 },
    { width: 560, height: 387 }, { width: 1600, height: 1100 }, 1));
});

it('11-19 面板被屏幕限高、里面要滚动：按完整高度（加上滚动藏起来的那截）缩放，双击也一样', async () => {
  state.hidden = 126;
  await useRewriteFocus()('v');
  const full = { width: 560, height: 387 + 126 };
  expect(state.setViewport).toHaveBeenCalledWith(rewriteFocusViewport({ x: 860, y: 534, width: 280, height: 426 }, full, { width: 1600, height: 1100 }, 1), { duration: 300 });
  state.setViewport.mockReset();
  useCardFocus()('v');
  expect(state.setViewport).toHaveBeenCalledWith(rewriteFocusViewport({ x: 860, y: 534, width: 280, height: 426 }, full, { width: 1600, height: 1100 }, 1,
    { maxZoom: 1.5, align: 'center', top: TOOLBAR_SPACE }), { duration: 300 });
});

it('等面板时用户已经取消选中，不再把画面拉回来', async () => {
  state.appearsAt = 5; state.deselectAt = 4;
  await useRewriteFocus()('v');
  expect(state.setViewport).not.toHaveBeenCalled();
});

it('双击卡片：量现有面板，最多放到 1.5 倍、普通卡居中；没有面板就只按卡算', () => {
  useCardFocus()('v');
  expect(state.setViewport).toHaveBeenCalledWith(rewriteFocusViewport({ x: 860, y: 534, width: 280, height: 426 },
    { width: 560, height: 387 }, { width: 1600, height: 1100 }, 1, { maxZoom: 1.5, align: 'center', top: TOOLBAR_SPACE }), { duration: 300 });
  state.setViewport.mockReset(); state.appearsAt = Infinity;
  useCardFocus()('v');
  expect(state.setViewport.mock.calls[0]?.[0].zoom).toBe(1.5);
});
