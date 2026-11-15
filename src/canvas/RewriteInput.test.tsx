import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RewriteInputView } from './RewriteInput';

const props = { text: '', pending: false, keepBackground: true,
  onChange: vi.fn(), onKeepBackground: vi.fn(), onStart: vi.fn() };
it('入口按钮不写价格（11-15 起只走本机 agent，写免费），写词另行操作，空话禁用，有话才可开始', () => {
  const empty = renderToStaticMarkup(<RewriteInputView {...props} />);
  expect(empty).toContain('你想换什么'); expect(empty).toContain('>开始改写（免费）<'); expect(empty).not.toContain('¥');
  expect(empty).toMatch(/<button[^>]*disabled=""/);
  const filled = renderToStaticMarkup(<RewriteInputView {...props} text="换衣服" />);
  expect(filled).not.toContain('disabled=""'); expect(filled).toContain('换衣服');
});
it('进行中说明并禁用；出错时把原话写在下面', () => {
  const running = renderToStaticMarkup(<RewriteInputView {...props} text="换" pending />);
  expect(running).toContain('这条视频正在改写，做完再来'); expect(running).toMatch(/<button[^>]*disabled=""/);
  const failed = renderToStaticMarkup(<RewriteInputView {...props} text="换" error="信息没拿到" />);
  expect(failed).toContain('信息没拿到');
});
it('「背景和原片保持一致」默认勾上；取消勾选说明背景卡留空；11-09 起铺卡不自动出图，勾不勾都免费', () => {
  const kept = renderToStaticMarkup(<RewriteInputView {...props} text="换" />);
  expect(kept).toContain('背景和原片保持一致'); expect(kept).toMatch(/type="checkbox"[^>]*checked=""/);
  expect(kept).not.toContain('背景卡留空');
  const fresh = renderToStaticMarkup(<RewriteInputView {...props} text="换" keepBackground={false} />);
  expect(fresh).toContain('>开始改写（免费）<'); expect(fresh).not.toContain('checked=""');
  expect(fresh).toContain('背景卡留空：你自己上传或生成'); expect(fresh).not.toContain('第一帧');
  const free = { ...props, text: '换' };
  expect(renderToStaticMarkup(<RewriteInputView {...free} keepBackground={false} />)).toContain('开始改写（免费）');
  expect(renderToStaticMarkup(<RewriteInputView {...free} />)).toContain('开始改写（免费）');
  expect(renderToStaticMarkup(<RewriteInputView {...free} keepClothes />)).toContain('开始改写（免费）');
});

it('11-08 用户定：两个勾并排一行，动作参考和开始改写同一行；解释都收进「?」平时藏着', () => {
  const html = renderToStaticMarkup(<RewriteInputView {...props} text="换" keepClothes motionReference="depth"
    onMotionReference={vi.fn()} />);
  const rows = html.split('class="rewrite-input__row"').slice(1);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain('背景和原片保持一致'); expect(rows[0]).toContain('衣服和原片保持一致');
  expect(rows[1]).toContain('动作参考'); expect(rows[1]).toContain('>开始改写（免费）<');
  expect(html).not.toContain('rewrite-input__hint');
  for (const text of ['截原片画面当背景', '没写要换的衣服按原片截图', '深度会带上原人物的发型和衣服轮廓']) {
    expect(html).toMatch(new RegExp(`hidden="">(<span class="help-tip__line">)?${text}`));
  }
});

it('11-10 用户要：标题右边三个常用项人物 / 衣服 / 背景，在输入框上面', () => {
  const html = renderToStaticMarkup(<RewriteInputView {...props} onPick={vi.fn()} />);
  const title = html.split('class="rewrite-input__title"')[1].split('<textarea')[0];
  expect(title).toContain('你想换什么');
  expect([...title.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map(match => match[1])).toEqual(['人物', '衣服', '背景']);
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
