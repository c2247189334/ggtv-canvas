import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { RewriteInput } from './RewriteInput';

// 无浏览器 DOM 的接线测试：保留组件在连续 render 之间的 state，真实调用其输入/按钮回调。
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as Array<() => void>, run: vi.fn(), remember: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); }
}));
vi.mock('@/common/useEscapeLayer', () => ({ useEscapeLayer: () => {} }));
vi.mock('./boardContext', () => ({ useBoard: () => ({ videoRewrite: { textFor: () => '', remember: hooks.remember, run: hooks.run, isPending: () => false } }) }));
vi.mock('@/api', () => ({ api: { videoRewriteEstimates: vi.fn(), health: vi.fn() } }));

const view = () => { hooks.index = 0; return RewriteInput({ id: 'source' }); };
beforeEach(() => {
  hooks.values = []; hooks.effects = []; hooks.index = 0; vi.clearAllMocks();
  vi.mocked(api.videoRewriteEstimates).mockResolvedValue({ analyzeYuan: 0.05, lookYuan: 0.03 });
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Awaited<ReturnType<typeof api.health>>);
});

it('原话变更跟默认，手动白模锁住选择；开始把动作种类作为第四参数交给run，重新打开重算', async () => {
  view(); hooks.effects.splice(0).forEach(effect => effect());
  await Promise.resolve();
  view().props.onChange('人物换成我的');
  expect(view().props.motionReference).toBe('mesh');
  view().props.onChange('背景换成海边');
  expect(view().props.motionReference).toBe('depth');
  view().props.onMotionReference('mesh');
  view().props.onChange('把背景换掉');
  expect(view().props.motionReference).toBe('mesh');
  view().props.onStart();
  expect(hooks.run).toHaveBeenCalledWith('source', '把背景换掉', true, 'mesh');
  hooks.values = []; view(); hooks.effects.splice(0).forEach(effect => effect()); await Promise.resolve();
  expect(view().props.motionReference).toBe('depth');
});

it('体检缺白模配置默认深度，仍允许手动选并保留缺项说明', async () => {
  vi.mocked(api.health).mockResolvedValue({ fake: false, ffmpegFound: true,
    mesh: { ready: false, url: { filled: false, found: true }, directory: { filled: false, found: false } } } as Awaited<ReturnType<typeof api.health>>);
  view(); hooks.effects.splice(0).forEach(effect => effect()); await Promise.resolve();
  view().props.onChange('人物换成我的');
  expect(view().props.motionReference).toBe('depth');
  expect(view().props.meshProblem).toContain('COMFYUI_DIR');
  view().props.onMotionReference('mesh');
  expect(view().props.motionReference).toBe('mesh');
});

it('开始预检返回缺项时留在输入框显示，不丢原话或手选动作参考', async () => {
  hooks.run.mockResolvedValueOnce('请在 .env.local 填好 ARK_API_KEY，没花钱。');
  view().props.onChange('人物换成我的'); view().props.onMotionReference('mesh');
  await view().props.onStart();
  expect(view().props.error).toContain('ARK_API_KEY');
  expect(view().props.text).toBe('人物换成我的'); expect(view().props.motionReference).toBe('mesh');
});
