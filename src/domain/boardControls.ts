import { SelectionMode } from "@xyflow/react";

/** 左键框选，中键 / 滚轮平移，Ctrl + 滚轮缩放；按住空格时临时开启左键平移。 */
export const boardPointerControls = {
  panOnScroll: true,
  panOnScrollSpeed: 1,
  panOnDrag: [1],
  selectionOnDrag: true,
  selectionMode: SelectionMode.Partial,
  panActivationKeyCode: "Space"
};

export function isOnlySelectedCard(selected: boolean, selectedCount: number): boolean {
  return selected && selectedCount === 1;
}

export function shouldShowMultiSelection(selectedCount: number): boolean {
  return selectedCount >= 2;
}
