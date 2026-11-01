import { useReactFlow, useStoreApi, type Edge } from '@xyflow/react';
import { rewriteFocusViewport } from '@/domain/rewriteFocus';
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
    const node = flow.getNode(id);
    if (!node) return;
    const measured = flow.getInternalNode(id)?.measured;
    const toolbar = document.querySelector(`.react-flow__node-toolbar[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
    const { width, height } = store.getState();
    const card = { ...node.position, width: measured?.width ?? CARD_WIDTH, height: measured?.height ?? rewriteNodeHeight(node) };
    const panel = toolbar?.width ? { width: toolbar.width, height: toolbar.height } : FALLBACK_PANEL;
    await flow.setViewport(rewriteFocusViewport(card, panel, { width, height }, flow.getZoom()), { duration: 300 });
  };
}
