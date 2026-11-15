import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { toolbarPosition } from '@/domain/toolbarPosition';

/**
 * 卡上方工具条的外壳：只在库显示工具条时挂载；跟随库定位层的位移，按钮保持屏幕像素大小，按屏幕摆（见 `toolbarPosition`）。
 * panelBelow：卡下面挂着提示词 / 改写面板，贴屏幕上边时工具条不能往下放（11-09）。
 */
export function ViewportTools({ children, panelBelow = false }: { children: ReactNode; panelBelow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tools = ref.current, layer = tools?.closest<HTMLElement>('.react-flow__node-toolbar');
    if (!tools || !layer) return;
    const update = () => {
      const node = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node'))
        .find(element => element.dataset.id === layer.dataset.id);
      if (!node) return;
      const position = toolbarPosition(node.getBoundingClientRect(),
        { width: tools.offsetWidth, height: tools.offsetHeight }, { width: innerWidth, height: innerHeight }, panelBelow);
      const original = layer.getBoundingClientRect();
      tools.style.transform = `translate(${position.left - original.left}px, ${position.top - original.top}px)`;
    };
    update();
    const movement = new MutationObserver(update);
    movement.observe(layer, { attributes: true, attributeFilter: ['style'] });
    const size = new ResizeObserver(update); size.observe(tools);
    window.addEventListener('resize', update);
    return () => { movement.disconnect(); size.disconnect(); window.removeEventListener('resize', update); };
  }, [panelBelow]);
  return <div className="card-tools" ref={ref}>{children}</div>;
}
