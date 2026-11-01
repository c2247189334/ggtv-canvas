import { useEffect, useRef, useState } from "react";
import { SHORTCUT_GROUPS } from "@/domain/shortcuts";
import { useEscapeLayer } from "@/common/useEscapeLayer";

export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEscapeLayer(() => setOpen(false), open, 5);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [open]);
  return <div ref={root} className="shortcut-help nodrag nopan nowheel">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>快捷键</button>
    {open ? <div className="shortcut-help__panel" role="dialog" aria-label="快捷键说明">
      <div className="shortcut-help__heading"><strong>快捷键</strong><button type="button" aria-label="关闭快捷键说明" onClick={() => setOpen(false)}>×</button></div>
      {SHORTCUT_GROUPS.map(group => <section key={group.title}><h3>{group.title}</h3>
        {group.items.map(([label, key]) => <div className="shortcut-help__row" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}
      </section>)}
    </div> : null}
  </div>;
}
