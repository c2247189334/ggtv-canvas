import { useCallback, useEffect, useRef, useState } from "react";

export type ToastAction = { label: string; run: () => void };
export type Notify = (text: string, action?: ToastAction, ms?: number) => void;
export type ToastState = { id: number; text: string; action?: ToastAction; ms: number };

/** 底部提示条：一次只显示一条，默认 4 秒后消失；带「撤销」这类按钮的可以多留一会儿。 */
export function useToast(): [ToastState | null, Notify, () => void] {
  const [toast, setToast] = useState<ToastState | null>(null);
  const seq = useRef(0);
  const notify = useCallback<Notify>((text, action, ms = 4000) => {
    seq.current += 1;
    setToast({ id: seq.current, text, action, ms });
  }, []);
  const close = useCallback(() => setToast(null), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((now) => (now?.id === toast.id ? null : now)), toast.ms);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return [toast, notify, close];
}

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <span>{toast.text}</span>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            onClose();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button type="button" className="toast__x" aria-label="关掉" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
