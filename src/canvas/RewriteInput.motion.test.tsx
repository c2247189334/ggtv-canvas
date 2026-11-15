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
vi.mock('@/api', () => ({ api: { health: vi.fn() } }));

const view = () => { hooks.index = 0; return RewriteInput({ id: 'source' }); };
beforeEach(() => {
  hooks.values = []; hooks.effects = []; hooks.index = 0; vi.clearAllMocks();
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Awaited<ReturnType<typeof api.health>>);
});

it('11-08 用户定：默认深度，原话写了人物、衣服也不自动变白模；开始改写交的就是深度', async () => {
  view(); hooks.effects.splice(0).forEach(effect => effect());
  await Promise.resolve();
  expect(view().props.motionReference).toBe('depth');
  view().props.onChange('人物和每套衣服换成我的，换个发型');
  expect(view().props.motionReference).toBe('depth');
  view().props.onStart();
  expect(hooks.run).toHaveBeenCalledWith('source', '人物和每套衣服换成我的，换个发型', true, 'depth', true);
});

it('手点白模才用白模，改原话也不变回；开始把动作种类作为第四参数交给run，重新打开回到深度', async () => {
  view(); hooks.effects.splice(0).forEach(effect => effect());
  await Promise.resolve();
  view().props.onMotionReference('mesh');
  view().props.onChange('把背景换掉');
  expect(view().props.motionReference).toBe('mesh');
  view().props.onStart();
  expect(hooks.run).toHaveBeenCalledWith('source', '把背景换掉', true, 'mesh', true);
  hooks.values = []; view(); hooks.effects.splice(0).forEach(effect => effect()); await Promise.resolve();
  expect(view().props.motionReference).toBe('depth');
});

it('11-10 用户要：点常用项把字拼进原话；点背景 / 衣服顺手取消对应的「和原片保持一致」，开始改写照此交', async () => {
  view().props.onPick({ label: '人物', words: '人物' });
  expect(view().props.text).toBe('人物换成我的');
  expect(hooks.remember).toHaveBeenLastCalledWith('source', '人物换成我的');
  expect(view().props.keepBackground).toBe(true); expect(view().props.keepClothes).toBe(true);
  view().props.onPick({ label: '衣服', words: '每套衣服' });
  expect(view().props.keepClothes).toBe(false); expect(view().props.keepBackground).toBe(true);
  view().props.onPick({ label: '背景', words: '背景' });
  expect(view().props.text).toBe('人物、每套衣服和背景换成我的');
  expect(view().props.keepBackground).toBe(false);
  view().props.onStart();
  expect(hooks.run).toHaveBeenCalledWith('source', '人物、每套衣服和背景换成我的', false, 'depth', false);
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
