import { useState } from 'react';
import { MAX_REDRAW_TEXT, REDRAW_TEXT } from '@/domain/layerRedraw';
import type { EditLayer } from '@/domain/layers';

type Props = {
  layer: EditLayer;
  /** 这张图有一层正在重绘（一次只跑一单）。 */
  busy: boolean;
  onRedraw: (layer: EditLayer, text: string) => Promise<void>;
};

/**
 * 图层编辑右边、选中一层时的「图层重绘」：写一句话，AI 只重画这一层（花一张图的钱）。
 * 照参考软件直接发送、不弹确认；花多少写在按钮旁边。出好后自动换上，能撤销。
 */
export function LayerRedrawBox({ layer, busy, onRedraw }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = text.trim().length > 0 && !busy && !sending;

  const send = async () => {
    if (!ready) return;
    setSending(true);
    setError(null);
    try {
      await onRedraw(layer, text.trim());
      setText('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="layer-redraw">
      <textarea className="layer-redraw__input" value={text} rows={2} maxLength={MAX_REDRAW_TEXT} placeholder={REDRAW_TEXT.input}
        aria-label={REDRAW_TEXT.input} onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }} />
      <div className="layer-redraw__row">
        <small>{busy ? `${REDRAW_TEXT.busy}…出好后自动换上` : REDRAW_TEXT.cost}</small>
        <button type="button" className="layer-redraw__send" disabled={!ready} onClick={() => void send()}>
          {sending ? '发送中…' : REDRAW_TEXT.button}</button>
      </div>
      {error ? <p className="layer-redraw__error" role="alert">{error}</p> : null}
    </div>
  );
}
