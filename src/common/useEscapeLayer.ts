import { useLayoutEffect, useRef } from "react";
import { registerEscapeLayer } from "./escapeLayers";

/** 优先级对应现有CSS层级；回调更新不改变弹层打开顺序。 */
export function useEscapeLayer(onClose: () => void, open = true, priority = 1000) {
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; });
  useLayoutEffect(() => {
    if (open) return registerEscapeLayer(window, () => close.current(), priority);
  }, [open, priority]);
}
