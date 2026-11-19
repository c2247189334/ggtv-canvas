import { useRef, useState } from 'react';
import { useEscapeLayer } from '@/common/useEscapeLayer';
import { useBoard } from './boardContext';
import { usePanelFit } from './usePanelFit';
import type { RewriteMode } from '@/domain/rewriteMode';
import { RewriteModePicker } from './RewriteModePicker';

type Props = { text: string; pending: boolean; error?: string | null;
  onChange: (value: string) => void; onStart: () => void; noAudio?: boolean; onMode?: (mode: RewriteMode) => void };
/**
 * 「视频改写」三选一里「不露脸 · 声音按原视频」的输入框（做法就是原来的拆解（无人物），11-19 入口收进视频改写）；
 * 和露脸的输入框同样子，说明收进标题旁的「?」（11-08 用户定）。
 */
export function ProductInputView({ text, pending, error, onChange, onStart, noAudio, onMode }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  usePanelFit(panel);
  return <div ref={panel} className="panel rewrite-input nodrag nopan nowheel">
    {onMode ? <RewriteModePicker mode="faceless" noAudio={noAudio} onMode={onMode} /> : null}
    <div className="rewrite-input__title">你想换什么</div>
    <textarea className="panel__prompt" aria-label="你想换什么" rows={3} value={text}
      placeholder="例如：鞋子" onChange={event => onChange(event.target.value)} />
    {pending ? <div className="panel__error">这条视频正在拆解，做完再来</div> : null}
    <div className="rewrite-input__row">
      <button type="button" className="rewrite-input__start" disabled={pending || !text.trim()} onClick={onStart}>
        开始改写（免费）
      </button>
    </div>
    {error ? <div className="panel__error">{error}</div> : null}
  </div>;
}
export function ProductInput({ id, noAudio = false }: { id: string; noAudio?: boolean }) {
  const board = useBoard();
  const action = board.productRemake;
  const [text, setText] = useState(() => action?.textFor(id) ?? '');
  const [error, setError] = useState<string | null>(null);
  useEscapeLayer(() => action?.close());
  return <ProductInputView text={text} pending={action?.isPending(id) ?? false} error={error} noAudio={noAudio}
    onMode={mode => { if (mode === 'faceless') return; board.videoRewrite?.remember(id, text); action?.close(); board.videoRewrite?.start(id, mode); }}
    onChange={value => { setText(value); action?.remember(id, value); }} onStart={() => {
      setError(null);
      void action?.run(id, text).then(problem => { if (problem) setError(problem); }, reason => setError((reason as Error).message));
    }} />;
}
