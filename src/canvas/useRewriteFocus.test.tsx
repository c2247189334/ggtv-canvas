import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { rewriteFocusViewport } from '@/domain/rewriteFocus';
import { useRewriteFocus } from './useRewriteFocus';

const flow = vi.hoisted(() => ({ setViewport: vi.fn() }));
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ getNode: () => ({ id: 'v', selected: true, position: { x: 760, y: 0 }, data: { kind: 'video', source: 'generate' } }), getInternalNode: () => ({ measured: { width: 280, height: 400 } }),
    getZoom: () => 1, setViewport: flow.setViewport }),
  useStoreApi: () => ({ getState: () => ({ width: 1400, height: 900 }) }),
}));
const bar = (width: number, height: number, panel: boolean) =>
  ({ querySelector: () => panel ? { getAttribute: () => 'true' } : null, getBoundingClientRect: () => ({ width, height }) });
afterEach(() => { vi.unstubAllGlobals(); });

it('商品拆解卡上方还有「加商品 / 加背景」小工具条时，只量下方提示词面板', async () => {
  const bars = [bar(137, 36, false), bar(560, 281, true)];
  vi.stubGlobal('document', { querySelector: (selector: string) => selector.includes(':has(.panel)') ? bars[1] : bars[0] });
  vi.stubGlobal('CSS', { escape: (s: string) => s });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 0; });
  let focus!: ReturnType<typeof useRewriteFocus>;
  function Harness() { focus = useRewriteFocus(); return null; }
  renderToStaticMarkup(<Harness />);
  await focus('v');
  expect(flow.setViewport).toHaveBeenCalledWith(rewriteFocusViewport({ x: 760, y: 0, width: 280, height: 400 },
    { width: 560, height: 281 }, { width: 1400, height: 900 }, 1), { duration: 300 });
});
