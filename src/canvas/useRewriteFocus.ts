import { useReactFlow, useStoreApi, type Edge } from '@xyflow/react';
import { DOUBLE_CLICK_ZOOM, TOOLBAR_SPACE, rewriteFocusViewport } from '@/domain/rewriteFocus';
import { CARD_WIDTH } from '@/domain/placement';
import { rewriteNodeHeight } from '@/domain/videoRewriteLayout';
import type { CardNode } from '@/types';

const FALLBACK_PANEL = { width: 520, height: 320 };
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/** 等新视频卡和它的提示词面板画出来再量尺寸，把画面挪到两者都看得见。 */
export function useRewriteFocus() {
  const flow = useReactFlow<CardNode, Edge>();
  const store = useStoreApi<CardNode, Edge>();
  return async (id: string) => {
    await nextFrame(); await nextFrame();
    let previous: { width: number; height: number } | null = null;
    for (let frame = 0; frame < 600; frame++) {
      const node = flow.getNode(id);
      if (!node) return;
      const needsPanel = node.data.source === 'generate' && node.data.kind !== 'audio';
      if (needsPanel && !node.selected) return;
      // 商品拆解卡上方还有「加商品 / 加背景」小工具条（同一个 data-id），只量带提示词面板的那条。
      const toolbar = document.querySelector(`.react-flow__node-toolbar[data-id="${CSS.escape(id)}"]:has(.panel)`);
      const bounds = toolbar?.getBoundingClientRect();
      const ready = bounds && bounds.width > 0 && bounds.height > 0 &&
        toolbar?.querySelector('.panel')?.getAttribute('data-focus-ready') !== 'false';
      if (!needsPanel || ready && previous?.width === bounds.width && previous.height === bounds.height) {
        const measured = flow.getInternalNode(id)?.measured;
        const { width, height } = store.getState();
        const card = { ...node.position, width: measured?.width ?? CARD_WIDTH, height: measured?.height ?? rewriteNodeHeight(node) };
        const panel = ready ? { width: bounds.width, height: bounds.height } : FALLBACK_PANEL;
        await flow.setViewport(rewriteFocusViewport(card, panel, { width, height }, flow.getZoom()), { duration: 300 });
        return;
      }
      previous = ready ? { width: bounds.width, height: bounds.height } : null;
      await nextFrame();
    }
  };
}

/** 双击卡片（11-08 用户定）：马上量已显示的提示词面板（没有就只看卡），最多放到 1.5 倍，卡和面板一起进屏幕。 */
export function useCardFocus() {
  const flow = useReactFlow<CardNode, Edge>();
  const store = useStoreApi<CardNode, Edge>();
  return (id: string) => {
    const node = flow.getNode(id);
    if (!node) return;
    const bounds = document.querySelector(`.react-flow__node-toolbar[data-id="${CSS.escape(id)}"]:has(.panel)`)?.getBoundingClientRect();
    const measured = flow.getInternalNode(id)?.measured;
    const { width, height } = store.getState();
    const card = { ...node.position, width: measured?.width ?? CARD_WIDTH, height: measured?.height ?? rewriteNodeHeight(node) };
    const panel = bounds ? { width: bounds.width, height: bounds.height } : { width: 0, height: 0 };
    const align = node.data.kind === 'video' && node.data.rewriteId ? 'start' : 'center';
    void flow.setViewport(rewriteFocusViewport(card, panel, { width, height }, flow.getZoom(), { maxZoom: DOUBLE_CLICK_ZOOM, align, top: TOOLBAR_SPACE }), { duration: 300 });
  };
}
