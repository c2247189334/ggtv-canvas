import type { KeyCheck } from "@/api";
import { featureSummary } from "@/domain/settingsPanel";
import type { Health } from "@/types";
import { AgentPicker } from "./AgentPicker";
import { HealthDetails } from "./HealthDetails";
import { KeySection } from "./KeyForm";

type Props = {
  health: Health; keyRejected: boolean; keyEditing: boolean; keyFocus: number;
  onKeyEditing: (editing: boolean) => void; onChanged: () => void; onKeySaved: (check?: KeyCheck) => void;
};

/**
 * 点「设置」弹的面板（11-19 用户定：一个面板里全搞定，点了不跳走、不弹第二个窗口）：
 * 功能（每项一个小标签打勾）/ 火山 Key（填好了只一行打勾）/ 本机 AI 助手（用谁 + 写词强度）。
 */
export function SettingsPanel({ health, keyRejected, keyEditing, keyFocus, onKeyEditing, onChanged, onKeySaved }: Props) {
  const summary = featureSummary(health, keyRejected);
  return <>
    <section className="setp__sec">
      <header className="setp__head">
        <h3>功能</h3>
        <span className={summary.ok ? "setp__state is-ok" : "setp__state is-warn"}>{summary.text}</span>
      </header>
      <HealthDetails health={health} keyRejected={keyRejected} />
    </section>
    <KeySection health={health} keyRejected={keyRejected} editing={keyEditing} focus={keyFocus} onEditing={onKeyEditing} onSaved={onKeySaved} />
    <AgentPicker health={health} onChanged={onChanged} />
  </>;
}
