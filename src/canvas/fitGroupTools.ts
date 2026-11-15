import { toolbarPosition } from '@/domain/toolbarPosition';

/** 组名在组框外上方：工具条原本离框顶 34，按「卡顶往上 24」交给 toolbarPosition（它离卡 10），没贴边时位置不变。 */
const NAME_SPACE = 24;

/**
 * 组工具条（排列 / 解组…）按屏幕摆（11-09）：组框贴屏幕上边 / 右边时工具条会出屏、钻进四角按钮栏被盖住，
 * 用 CSS translate 挪回来，不碰 React 管的 transform。给 ref 用，返回清理函数（React 19）。
 * 画布挪动听视口层，组被拖动 / 变大听组框，缩放后 React 改工具条自己的 transform 也要听（缩放和重画不在同一刻，11-09 实测）。
 */
export function fitGroupTools(tools: HTMLElement | null) {
  if (!tools) return;
  const id = tools.dataset.toolsFor ?? '';
  const frame = document.querySelector<HTMLElement>(`.group-frame[data-group-id="${CSS.escape(id)}"]`);
  const viewport = tools.closest<HTMLElement>('.react-flow__viewport');
  if (!frame) return;
  // translate 写在画布坐标里（父层随缩放），屏幕上挪的量 = 它 × 当前缩放。
  let applied = { x: 0, y: 0 };
  const update = () => {
    const box = frame.getBoundingClientRect();
    const zoom = frame.offsetWidth ? box.width / frame.offsetWidth : 1;
    const rect = tools.getBoundingClientRect();
    const natural = { left: rect.left - applied.x * zoom, top: rect.top - applied.y * zoom };
    const want = toolbarPosition({ left: box.left, right: box.right, top: box.top - NAME_SPACE, bottom: box.bottom },
      { width: rect.width, height: rect.height }, { width: innerWidth, height: innerHeight });
    const dx = want.left - natural.left, dy = want.top - natural.top;
    if (Math.abs(dx - applied.x * zoom) < 0.5 && Math.abs(dy - applied.y * zoom) < 0.5) return;
    applied = Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 ? { x: 0, y: 0 } : { x: dx / zoom, y: dy / zoom };
    tools.style.translate = applied.x || applied.y ? `${applied.x}px ${applied.y}px` : '';
  };
  update();
  const movement = new MutationObserver(update);
  for (const target of [frame, tools, viewport]) if (target) movement.observe(target, { attributes: true, attributeFilter: ['style'] });
  const size = new ResizeObserver(update); size.observe(tools);
  window.addEventListener('resize', update);
  return () => { movement.disconnect(); size.disconnect(); window.removeEventListener('resize', update); };
}
