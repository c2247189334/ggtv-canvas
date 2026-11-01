import { useEffect, useRef } from "react";
import { Handle, Position } from "@xyflow/react";
import { connectionDragged } from "@/domain/connectionGesture";

type Props = { type: "source" | "target"; visible: boolean; showPlus: boolean; onClick: (anchor: DOMRect) => void };

/** 不是生成卡、但有来源线（深度卡、声音卡）的左接点：看不见、不能拖线，只让线有地方落。 */
export function LineEnd() {
  return <Handle className="card__handle card__handle--hidden" type="target" position={Position.Left} isConnectable={false} />;
}

/** ＋在原Handle内，真实mousedown/touchstart自然冒泡，由React Flow负责拉线。 */
export function CardHandle({ type, visible, showPlus, onClick }: Props) {
  const press = useRef<{ x: number; y: number; pointerId: number; dragged: boolean; active: boolean } | null>(null);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const start = press.current;
      if (!start?.active || start.pointerId !== event.pointerId) return;
      start.dragged = connectionDragged(start.dragged, start, { x: event.clientX, y: event.clientY });
    };
    const up = (event: PointerEvent) => {
      move(event);
      if (press.current?.pointerId === event.pointerId) press.current.active = false;
    };
    const cancel = () => { press.current = null; };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  const left = type === "target";
  return <Handle className={visible ? "card__handle" : "card__handle card__handle--hidden"}
    type={type} position={left ? Position.Left : Position.Right}>
    {showPlus ? <button type="button" className={`card__plus card__plus--${left ? "left" : "right"} nodrag nopan`}
      title={left ? "接参考图" : "用这张图生成"}
      onPointerDown={event => {
        if (event.button === 0) press.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, dragged: false, active: true };
      }}
      onClick={event => {
        event.stopPropagation();
        if (event.detail === 0 || (press.current && !press.current.dragged)) onClick(event.currentTarget.getBoundingClientRect());
        press.current = null;
      }}>＋</button> : null}
  </Handle>;
}
