import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RewriteInputView } from './RewriteInput';

const props = { text: '', pending: false, estimates: { analyzeYuan: 0.05 }, keepBackground: true,
  onChange: vi.fn(), onKeepBackground: vi.fn(), onStart: vi.fn() };
it('入口只算两轮拆解加一张背景图合计约0.17，写词另行操作，空话禁用，有话才可开始', () => {
  const empty = renderToStaticMarkup(<RewriteInputView {...props} />);
  expect(empty).toContain('你想换什么'); expect(empty).toContain('开始改写 约 ¥0.17');
  expect(empty).toMatch(/<button[^>]*disabled=""/);
  const filled = renderToStaticMarkup(<RewriteInputView {...props} text="换衣服" />);
  expect(filled).not.toContain('disabled=""'); expect(filled).toContain('换衣服');
});
it('进行中说明并禁用；接口估价未到或失败也不能开始', () => {
  const running = renderToStaticMarkup(<RewriteInputView {...props} text="换" pending />);
  expect(running).toContain('这条视频正在改写，做完再来'); expect(running).toMatch(/<button[^>]*disabled=""/);
  const failed = renderToStaticMarkup(<RewriteInputView {...props} text="换" estimates={null} error="估价没拿到" />);
  expect(failed).toContain('估价没拿到'); expect(failed).toMatch(/<button[^>]*disabled=""/);
});
it('「背景和原片保持一致」默认勾上、价格含背景图；取消勾选少背景图那份，说明背景卡留空', () => {
  const kept = renderToStaticMarkup(<RewriteInputView {...props} text="换" />);
  expect(kept).toContain('背景和原片保持一致'); expect(kept).toMatch(/type="checkbox"[^>]*checked=""/);
  expect(kept).not.toContain('背景卡留空');
  const fresh = renderToStaticMarkup(<RewriteInputView {...props} text="换" keepBackground={false} />);
  expect(fresh).toContain('开始改写 约 ¥0.05'); expect(fresh).not.toContain('checked=""');
  expect(fresh).toContain('背景卡留空：你自己上传或生成，第一帧连着当机位参考');
});

it('动作参考在背景勾选下面，按选择显示提示，未配好仍可点白模并列缺项', () => {
  const mesh = renderToStaticMarkup(<RewriteInputView {...props} text="换人" motionReference="mesh" onMotionReference={vi.fn()} />);
  expect(mesh.indexOf('背景和原片保持一致')).toBeLessThan(mesh.indexOf('动作参考'));
  expect(mesh).toMatch(/aria-pressed="true"[^>]*>白模/);
  expect(mesh).toContain('白模只有人：手里的东西和场景不参考，带道具的片选深度；生成时间取决于电脑配置');
  expect(mesh).not.toContain('分钟');
  const depth = renderToStaticMarkup(<RewriteInputView {...props} text="换人" motionReference="depth" meshProblem="缺 COMFYUI_DIR" onMotionReference={vi.fn()} />);
  expect(depth).toMatch(/aria-pressed="false"[^>]*>白模/);
  expect(depth).toMatch(/aria-pressed="true"[^>]*>深度/);
  expect(depth).toContain('深度会带上原人物的发型和衣服轮廓');
  expect(depth).toContain('白模还没配好：缺 COMFYUI_DIR');
});
