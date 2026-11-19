import { HelpTip } from '@/common/HelpTip';
import { REWRITE_MODES, TALKING_NO_AUDIO, type RewriteMode } from '@/domain/rewriteMode';

type Props = { mode: RewriteMode; noAudio?: boolean; onMode: (mode: RewriteMode) => void };
/** 「视频改写」输入框最上面的三选一（11-19 用户定）：单选，每项下面一行灰字举例；原片没声音时「AI 自己配音」灰掉。 */
export function RewriteModePicker({ mode, noAudio = false, onMode }: Props) {
  return <div className="rewrite-mode">
    <div className="rewrite-input__title">这条视频是哪种？
      <HelpTip>{REWRITE_MODES.map(item => <span className="help-tip__line" key={item.id}>{item.label}：{item.tip}</span>)}</HelpTip></div>
    <div className="rewrite-mode__options" role="radiogroup" aria-label="这条视频是哪种？">
      {REWRITE_MODES.map(item => {
        const off = item.id === 'talking' && noAudio;
        return <button key={item.id} type="button" role="radio" aria-checked={mode === item.id} className={mode === item.id ? 'is-on' : ''}
          disabled={off} onClick={() => { if (item.id !== mode) onMode(item.id); }}>
          <span className="rewrite-mode__label">{item.label}</span>
          <span className="rewrite-mode__hint">{off ? TALKING_NO_AUDIO : item.hint}</span>
        </button>;
      })}
    </div>
  </div>;
}
