import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { tipPosition, type TipPlace } from '@/domain/tipPosition';

type Props = { children: ReactNode; label?: string; name?: string };

/**
 * 11-08 用户定：解释文字不铺在面板里，收进一个「?」，鼠标移上去（或 Tab 聚焦、点一下）才浮出来。
 * 气泡挂到 body 上，不被面板的滚动区裁掉；鼠标从问号挪进气泡不会关，长说明能在气泡里滚着看、选字复制。
 * 说明原文另放一份在隐藏块里，读屏软件经 aria-describedby 读到。label 是问号前的小字（如「3 条提醒」）。
 */
export function HelpTip({ children, label, name = '说明' }: Props) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const closeTimer = useRef(0);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<TipPlace | null>(null);
  const show = () => { window.clearTimeout(closeTimer.current); setOpen(true); };
  const hide = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => { setOpen(false); setPlace(null); }, 150);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    setPlace(tipPosition(anchor.current.getBoundingClientRect(), { width: bubble.current.offsetWidth, height: bubble.current.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }));
  }, [open]);
  // 气泡在 React 树里仍挂在卡片下面：点、双击不能冒到卡片（会选卡、放大画布）。
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  return <button ref={anchor} type="button" className="help-tip" aria-label={label ? `${label}，${name}` : name} aria-describedby={id}
    onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={event => { stop(event); show(); }} onDoubleClick={stop}>
    {label ? <span className="help-tip__label">{label}</span> : null}
    <span className="help-tip__mark" aria-hidden="true">?</span>
    <span id={id} hidden>{children}</span>
    {open ? createPortal(<div ref={bubble} className="help-tip__bubble nodrag nowheel nopan" role="tooltip"
      style={place ?? { left: -9999, top: 0, visibility: 'hidden' }}
      onMouseEnter={show} onMouseLeave={hide} onPointerDown={stop} onClick={stop} onDoubleClick={stop}>{children}</div>, document.body) : null}
  </button>;
}
