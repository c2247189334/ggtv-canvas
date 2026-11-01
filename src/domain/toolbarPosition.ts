type Anchor = { left: number; right: number; top: number; bottom: number };
type Size = { width: number; height: number };

export function toolbarPosition(anchor: Anchor, toolbar: Size, viewport: Size) {
  const clamp = (value: number, max: number) => Math.max(8, Math.min(value, max - 8));
  const above = anchor.top - toolbar.height - 10;
  return {
    left: clamp((anchor.left + anchor.right - toolbar.width) / 2, viewport.width - toolbar.width),
    top: clamp(above >= 8 ? above : anchor.bottom + 10, viewport.height - toolbar.height)
  };
}
