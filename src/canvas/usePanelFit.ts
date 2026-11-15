import { useLayoutEffect, type RefObject } from 'react';
import { panelFit } from '@/domain/panelFit';

/**
 * 提示词面板跟着画布挪动时按屏幕重新摆（11-08 用户定）：右 / 左出屏就横着挪回来，
 * 最高到屏幕底边，多出来的由提示词框变矮、提醒区滚动消化，发送那一行始终看得见。
 * 跟 `CardTools.tsx` 的工具条一样，听画布库定位层 style 变化和窗口大小变化。
 */
export function usePanelFit(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const panel = ref.current, layer = panel?.closest<HTMLElement>('.react-flow__node-toolbar');
    if (!panel || !layer) return;
    const update = () => {
      const fit = panelFit(layer.getBoundingClientRect(), { width: innerWidth, height: innerHeight });
      panel.style.transform = fit.shift ? `translateX(${fit.shift}px)` : '';
      panel.style.maxHeight = `${fit.maxHeight}px`;
    };
    update();
    const movement = new MutationObserver(update);
    movement.observe(layer, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', update);
    return () => { movement.disconnect(); window.removeEventListener('resize', update); };
  }, [ref]);
}
