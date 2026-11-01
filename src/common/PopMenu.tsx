import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeLayer } from "./useEscapeLayer";
import { menuTop } from "@/domain/menuPosition";

export type MenuItem = { label: string; note?: string; shortcut?: string; onSelect?: () => void; disabled?: boolean; checked?: boolean } | { group: string } | "divider";

type Props = { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void; above?: boolean };

/**
 * 小弹出菜单（双击空白、卡片的 ＋、画布名 ▾、缩放都用它）。
 * 一律挂到 body 上：卡片在画布的缩放层里，菜单放里面会跟着缩放、位置也会错。
 * 点菜单外面或按 Esc 关掉。above = 往上弹（按钮在屏幕底下时用）。
 */
export function PopMenu({ at, items, onClose, above = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const [top, setTop] = useState(at.y);
  useEscapeLayer(onClose);

  useLayoutEffect(() => {
    if (ref.current) setTop(menuTop(at.y, ref.current.getBoundingClientRect().height, viewportHeight, above));
  }, [at.y, above, items, viewportHeight]);

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [onClose]);

  const style = {
    left: Math.max(8, Math.min(at.x, window.innerWidth - 248)),
    top,
    maxHeight: Math.max(0, viewportHeight - 16),
    overflowY: "auto" as const
  };

  return createPortal(
    <div ref={ref} className="pop-menu" style={style} role="menu">
      {items.map((item, index) =>
        item === "divider" ? (
          <div key={index} className="pop-menu__divider" />
        ) : "group" in item ? (
          <div key={index} className="pop-menu__group">{item.group}</div>
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={item.checked ? "pop-menu__item is-checked" : "pop-menu__item"}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
          >
            <span>{item.label}</span>
            {item.note ? <span className="pop-menu__note">{item.note}</span> : null}
            {item.shortcut ? <span className="pop-menu__shortcut">{item.shortcut}</span> : null}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
