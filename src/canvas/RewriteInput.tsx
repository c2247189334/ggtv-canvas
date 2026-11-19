import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { useEscapeLayer } from '@/common/useEscapeLayer';
import { HelpTip } from '@/common/HelpTip';
import { useBoard } from './boardContext';
import { usePanelFit } from './usePanelFit';
import { localMediaProblem } from '@/domain/localMedia';
import type { MotionReference } from '@/domain/motionReference';
import { addRewriteSubject, REWRITE_SUBJECTS, type RewriteSubject } from '@/domain/rewriteSubjects';
import type { RewriteMode } from '@/domain/rewriteMode';
import { RewriteModePicker } from './RewriteModePicker';

type Props = { text: string; pending: boolean; error?: string | null; keepBackground: boolean; keepClothes?: boolean;
  motionReference?: MotionReference; meshProblem?: string | null; onMotionReference?: (kind: MotionReference) => void; onPick?: (subject: RewriteSubject) => void;
  onChange: (text: string) => void; onKeepBackground: (keep: boolean) => void; onKeepClothes?: (keep: boolean) => void; onStart: () => void;
  /** 11-19 三选一：这里只管两种露脸的；选「不露脸」由外面换成拆解（无人物）的输入框。 */
  mode?: RewriteMode; noAudio?: boolean; onMode?: (mode: RewriteMode) => void };
/**
 * 「视频改写」输入框。11-08 用户定：少占地方——两个勾并排一行、动作参考和「开始改写」同一行，
 * 解释全收进旁边的「?」（鼠标移上去才看），面板不出屏，「开始改写」点得到。
 */
export function RewriteInputView({ text, pending, error, keepBackground, keepClothes = false, onChange, onKeepBackground, onKeepClothes, onStart,
  motionReference = 'depth', meshProblem, onMotionReference, onPick, mode = 'face', noAudio, onMode }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  usePanelFit(panel);
  // 11-06 用户定：默认勾上 = 截原片当背景（11-09 起每个场景由拆解挑帧），没人直接用、有人铺去人的卡；不勾 = 不截图，背景卡留空自己补。
  // 11-06 用户：只写换人时衣服跟原片，默认勾上；不勾 = 不抽衣服图。
  // 11-09 用户定：铺卡不自动出图（去人、衣服图都等用户点），开始改写花不花钱只看拆解。
  return <div ref={panel} className="panel rewrite-input nodrag nopan nowheel">
    {onMode ? <RewriteModePicker mode={mode} noAudio={noAudio} onMode={onMode} /> : null}
    <div className="rewrite-input__title">你想换什么
      <span className="rewrite-input__picks">{REWRITE_SUBJECTS.map(subject => <button key={subject.label} type="button"
        onClick={() => onPick?.(subject)}>{subject.label}</button>)}</span></div>
    <textarea className="panel__prompt" aria-label="你想换什么" rows={3} value={text}
      placeholder="例如：人物和每套衣服换成我的，保留动作与节奏" onChange={event => onChange(event.target.value)} />
    <div className="rewrite-input__row">
      <span className="rewrite-input__option"><label className="rewrite-input__keep"><input type="checkbox" checked={keepBackground}
        onChange={event => onKeepBackground(event.target.checked)} />背景和原片保持一致</label>
        <HelpTip>{keepBackground ? '截原片画面当背景：每个场景由拆解挑一帧人最少、没被挡的；没人直接用，有人铺一张去人的卡、写好词，你点生成' : '背景卡留空：你自己上传或生成'}</HelpTip></span>
      <span className="rewrite-input__option"><label className="rewrite-input__keep"><input type="checkbox" checked={keepClothes}
        onChange={event => onKeepClothes?.(event.target.checked)} />衣服和原片保持一致</label>
        <HelpTip>{keepClothes ? '没写要换的衣服按原片截图、铺卡连好、写好词，你点生成；每套算一次出图' : '不抽衣服图：衣服按人物图或文字描述来'}</HelpTip></span>
    </div>
    <div className="rewrite-input__row">
      <span className="rewrite-input__option">动作参考{(['mesh', 'depth'] as const).map(kind => <button key={kind} type="button"
        className={motionReference === kind ? 'is-on' : ''} aria-pressed={motionReference === kind}
        onClick={() => onMotionReference?.(kind)}>{kind === 'mesh' ? '白模' : '深度'}</button>)}
        <HelpTip><span className="help-tip__line">{motionReference === 'mesh' ? '白模只有人：手里的东西和场景不参考，带道具的片选深度；生成时间取决于电脑配置' :
          '深度会带上原人物的发型和衣服轮廓'}</span>
          {meshProblem ? <span className="help-tip__line">白模还没配好：{meshProblem}</span> : null}</HelpTip></span>
      <button type="button" className="rewrite-input__start" disabled={pending || !text.trim()} onClick={onStart}>
        开始改写（免费）
      </button>
    </div>
    {pending ? <div className="panel__error">这条视频正在改写，做完再来</div> : null}
    {error ? <div className="panel__error">{error}</div> : null}
  </div>;
}
export function RewriteInput({ id, noAudio = false }: { id: string; noAudio?: boolean }) {
  const board = useBoard();
  const rewrite = board.videoRewrite;
  const [text, setText] = useState(() => rewrite?.textFor(id) ?? '');
  // 11-19 用户定：每次打开回到「露脸 · 声音按原视频」；从「不露脸」切过来时带着切过来的那种。
  const [mode, setMode] = useState<RewriteMode>(() => rewrite?.openedMode?.() ?? 'face');
  const [keepBackground, setKeepBackground] = useState(true);
  const [keepClothes, setKeepClothes] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 11-08 用户定：默认深度，只有手点白模才换；不跟着原话自动切（原话写「人物」也不变）。
  const [motionReference, setMotionReference] = useState<MotionReference>('depth');
  const [meshProblem, setMeshProblem] = useState<string | null>('体检读取中…');
  useEscapeLayer(() => rewrite?.close());
  useEffect(() => {
    let alive = true;
    void api.health().then(value => { if (alive) setMeshProblem(localMediaProblem(value, 'mesh')); }, reason => { if (alive) setMeshProblem((reason as Error).message); });
    return () => { alive = false; };
  }, []);
  const change = (value: string) => { setText(value); rewrite?.remember(id, value); };
  return <RewriteInputView text={text} error={error} pending={rewrite?.isPending(id) ?? false} keepBackground={keepBackground} keepClothes={keepClothes}
    motionReference={motionReference} meshProblem={meshProblem} onMotionReference={setMotionReference}
    mode={mode} noAudio={noAudio} onMode={next => {
      if (next !== 'faceless') { setMode(next); return; }
      // 写过的原话三种共用一份草稿。
      board.productRemake?.remember(id, text); rewrite?.close(); board.productRemake?.start(id);
    }}
    onChange={change} onKeepBackground={setKeepBackground} onKeepClothes={setKeepClothes}
    onPick={subject => {
      // 11-10：点了要换背景 / 衣服，对应的「和原片保持一致」就取消（背景只看这个勾，不取消会照样截原片）。
      change(addRewriteSubject(text, subject));
      if (subject.label === '背景') setKeepBackground(false);
      if (subject.label === '衣服') setKeepClothes(false);
    }}
    onStart={async () => {
      setError(null);
      try { const problem = await rewrite?.run(id, text, keepBackground, motionReference, keepClothes, mode === 'talking'); if (problem) setError(problem); }
      catch (reason) { setError((reason as Error).message); }
    }} />;
}
