import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscapeLayer } from "@/common/useEscapeLayer";
import { panelPosition } from "@/domain/panelPosition";

type Props = {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  keepAnchor?: boolean;
  direction?: "up" | "down";
};

/** 放到画布缩放层外，点外面和 Esc 关闭。 */
export function FloatingPanel({ anchor, onClose, children, className = "", keepAnchor = false, direction = "down" }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  useEscapeLayer(onClose);
  const rect = anchor.getBoundingClientRect();
  useLayoutEffect(() => {
    const element = panel.current;
    if (direction === "down" && element) {
      setContentHeight(element.scrollHeight + element.offsetHeight - element.clientHeight);
    }
  }, [children, direction]);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (panel.current?.contains(event.target as Node)) return;
      if (keepAnchor && anchor.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [anchor, keepAnchor, onClose]);

  return createPortal(
    <div ref={panel} className={`panel-popup nodrag nowheel nopan ${className}`} role="dialog"
      style={panelPosition(rect, { width: window.innerWidth, height: window.innerHeight }, direction, contentHeight)}
      onPointerDown={(event) => event.stopPropagation()}>
      {children}
    </div>, document.body
  );
}
