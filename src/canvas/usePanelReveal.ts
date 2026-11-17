import { useCallback } from 'react';
import { useReactFlow, type Edge } from '@xyflow/react';
import { revealShift } from '@/domain/panelReveal';
import { rewriteFocusViewport } from '@/domain/rewriteFocus';
import { CARD_WIDTH } from '@/domain/placement';
import { rewriteNodeHeight } from '@/domain/videoRewriteLayout';
import type { CardNode } from '@/types';

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/**
 * 新建生成卡、点「视频改写 / 拆解」后调：等这张卡下面的面板画出来、尺寸稳住，
 * 面板掉出屏幕就把画布平移到卡和面板都看得见（11-17 用户定，纯计算在 `domain/panelReveal.ts`）。
 * 平移救不了（卡加面板比屏幕高）才照双击对准那样缩小。只在这两种主动操作后调，不跟着点选卡片走，免得拖卡时画布乱动。
 */
export function usePanelReveal(): (id: string) => void {
  const flow = useReactFlow<CardNode, Edge>();
  return useCallback((id: string) => void (async () => {
    await nextFrame(); await nextFrame();
    let previous: { width: number; height: number } | null = null;
    for (let frame = 0; frame < 120; frame++) {
      const node = flow.getNode(id);
      if (!node || !node.selected) return;
      const escaped = CSS.escape(id);
      const panel = document.querySelector(`.react-flow__node-toolbar[data-id="${escaped}"] .panel`);
      const card = document.querySelector(`.react-flow__node[data-id="${escaped}"]`)?.getBoundingClientRect();
      const bounds = panel?.getBoundingClientRect();
      const ready = card && bounds && bounds.width > 0 && bounds.height > 0 && panel?.getAttribute('data-focus-ready') !== 'false';
      if (ready && previous?.width === bounds.width && previous.height === bounds.height) {
        const screen = { width: innerWidth, height: innerHeight };
        const shift = revealShift(card, bounds, screen);
        const view = flow.getViewport();
        if (shift && !shift.dx && !shift.dy) return;
        if (shift) { await flow.setViewport({ x: view.x + shift.dx, y: view.y + shift.dy, zoom: view.zoom }, { duration: 200 }); return; }
        const measured = flow.getInternalNode(id)?.measured;
        const box = { ...node.position, width: measured?.width ?? CARD_WIDTH, height: measured?.height ?? rewriteNodeHeight(node) };
        const align = node.data.kind === 'video' && node.data.rewriteId ? 'start' : 'center';
        await flow.setViewport(rewriteFocusViewport(box, { width: bounds.width, height: bounds.height }, screen, view.zoom, { align }), { duration: 200 });
        return;
      }
      previous = ready ? { width: bounds.width, height: bounds.height } : null;
      await nextFrame();
    }
  })(), [flow]);
}
