import { useRef, useState } from 'react';
import { useEscapeLayer } from '@/common/useEscapeLayer';
import { useBoard } from './boardContext';
import { usePanelFit } from './usePanelFit';

type Props = { text: string; pending: boolean; error?: string | null;
  onChange: (value: string) => void; onStart: () => void };
/** 「拆解（无人物）」输入框；和视频改写输入框同样子，说明收进标题旁的「?」（11-08 用户定）。 */
export function ProductInputView({ text, pending, error, onChange, onStart }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  usePanelFit(panel);
  return <div ref={panel} className="panel rewrite-input nodrag nopan nowheel">
    <div className="rewrite-input__title">你想换什么</div>
    <textarea className="panel__prompt" aria-label="你想换什么" rows={3} value={text}
      placeholder="例如：鞋子" onChange={event => onChange(event.target.value)} />
    {pending ? <div className="panel__error">这条视频正在拆解，做完再来</div> : null}
    <div className="rewrite-input__row">
      <button type="button" className="rewrite-input__start" disabled={pending || !text.trim()} onClick={onStart}>
        开始拆解（免费）
      </button>
    </div>
    {error ? <div className="panel__error">{error}</div> : null}
  </div>;
}
export function ProductInput({ id }: { id: string }) {
  const action = useBoard().productRemake;
  const [text, setText] = useState(() => action?.textFor(id) ?? '');
  const [error, setError] = useState<string | null>(null);
  useEscapeLayer(() => action?.close());
  return <ProductInputView text={text} pending={action?.isPending(id) ?? false} error={error}
    onChange={value => { setText(value); action?.remember(id, value); }} onStart={() => {
      setError(null);
      void action?.run(id, text).then(problem => { if (problem) setError(problem); }, reason => setError((reason as Error).message));
    }} />;
}
