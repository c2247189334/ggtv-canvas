import { useEffect, useState } from 'react';
import { api } from '@/api';
import { useEscapeLayer } from '@/common/useEscapeLayer';
import { DEFAULT_GEN } from '@/domain/cards';
import { estimateYuan, formatYuan } from '@/domain/pricing';
import { useBoard } from './boardContext';
import { localMediaProblem } from '@/domain/localMedia';
import { selectedMotionReference, type MotionReference } from '@/domain/motionReference';

type Estimates = { analyzeYuan: number };
type Props = { text: string; pending: boolean; estimates: Estimates | null; error?: string | null; keepBackground: boolean;
  motionReference?: MotionReference; meshProblem?: string | null; onMotionReference?: (kind: MotionReference) => void;
  onChange: (text: string) => void; onKeepBackground: (keep: boolean) => void; onStart: () => void };
export function RewriteInputView({ text, pending, estimates, error, keepBackground, onChange, onKeepBackground, onStart,
  motionReference = 'depth', meshProblem, onMotionReference }: Props) {
  // 10-30 用户定：默认勾上 = 背景自动用第一帧去人出图（多一张图钱）；不勾 = 背景卡留空自己补，不花这份钱。
  const backgroundYuan = keepBackground ? estimateYuan(DEFAULT_GEN.model, 1) : 0;
  return <div className="panel rewrite-input nodrag nopan nowheel">
    <label>你想换什么<textarea className="panel__prompt" aria-label="你想换什么" rows={3} value={text}
      placeholder="例如：人物和每套衣服换成我的，保留动作与节奏" onChange={event => onChange(event.target.value)} /></label>
    <label className="rewrite-input__keep"><input type="checkbox" checked={keepBackground}
      onChange={event => onKeepBackground(event.target.checked)} />背景和原片保持一致</label>
    <div className="depth-choices"><div>动作参考 {(['mesh', 'depth'] as const).map(kind => <button key={kind} type="button"
      className={motionReference === kind ? 'is-on' : ''} aria-pressed={motionReference === kind}
      onClick={() => onMotionReference?.(kind)}>{kind === 'mesh' ? '白模' : '深度'}</button>)}</div></div>
    <div className="rewrite-input__hint">{motionReference === 'mesh' ? '白模只有人：手里的东西和场景不参考，带道具的片选深度；生成时间取决于电脑配置' :
      '深度会带上原人物的发型和衣服轮廓'}</div>
    {meshProblem ? <div className="rewrite-input__hint">白模还没配好：{meshProblem}</div> : null}
    {keepBackground ? null : <div className="rewrite-input__hint">背景卡留空：你自己上传或生成，第一帧连着当机位参考</div>}
    {pending ? <div className="panel__error">这条视频正在改写，做完再来</div> : null}
    <button type="button" disabled={pending || !text.trim() || !estimates} onClick={onStart}>
      开始改写 {estimates ? formatYuan(estimates.analyzeYuan + backgroundYuan) : '估价读取中…'}
    </button>
    {error ? <div className="panel__error">{error}</div> : null}
  </div>;
}
export function RewriteInput({ id }: { id: string }) {
  const board = useBoard();
  const rewrite = board.videoRewrite;
  const [text, setText] = useState(() => rewrite?.textFor(id) ?? '');
  const [keepBackground, setKeepBackground] = useState(true);
  const [estimates, setEstimates] = useState<Estimates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<MotionReference | null>(null);
  const [meshProblem, setMeshProblem] = useState<string | null>('体检读取中…');
  const motionReference = selectedMotionReference(text, meshProblem === null, manual);
  useEscapeLayer(() => rewrite?.close());
  useEffect(() => {
    let alive = true;
    void api.videoRewriteEstimates().then(value => { if (alive) setEstimates(value); }, reason => { if (alive) setError((reason as Error).message); });
    void api.health().then(value => { if (alive) setMeshProblem(localMediaProblem(value, 'mesh')); }, reason => { if (alive) setMeshProblem((reason as Error).message); });
    return () => { alive = false; };
  }, []);
  return <RewriteInputView text={text} estimates={estimates} error={error} pending={rewrite?.isPending(id) ?? false} keepBackground={keepBackground}
    motionReference={motionReference} meshProblem={meshProblem} onMotionReference={setManual}
    onChange={value => { setText(value); rewrite?.remember(id, value); }} onKeepBackground={setKeepBackground}
    onStart={async () => {
      setError(null);
      try { const problem = await rewrite?.run(id, text, keepBackground, motionReference); if (problem) setError(problem); }
      catch (reason) { setError((reason as Error).message); }
    }} />;
}
