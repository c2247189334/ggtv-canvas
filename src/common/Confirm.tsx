import { useEscapeLayer } from "./useEscapeLayer";
import { createPortal } from "react-dom";

type Props = { text: string; okLabel: string; onOk: () => void; onCancel: () => void };

/** 页面里的确认框。不用浏览器自带的 confirm：那个会卡住整个页面，也没法自动化验收。Esc 取消。 */
export function Confirm({ text, okLabel, onOk, onCancel }: Props) {
  useEscapeLayer(onCancel, true, 1250);

  return createPortal(
    <div className="confirm" role="dialog" aria-modal="true"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="confirm__box">
        <p>{text}</p>
        <div className="confirm__actions">
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="confirm__ok" onClick={onOk}>{okLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
