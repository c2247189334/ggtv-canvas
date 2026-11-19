import { useState } from "react";
import { api } from "@/api";
import { agentOptions } from "@/domain/agentChoice";
import { STRENGTH_OPTIONS, showAgent, showStrength } from "@/domain/settingsPanel";
import type { Health } from "@/types";
import { AgentLoginButtons } from "./AgentLoginButtons";

/** 保存选择：成了回 null，没成回给人看的原话。 */
export async function saveChoice(id: string, save: (id: string) => Promise<unknown> = api.saveAgent): Promise<string | null> {
  try { await save(id); return null; }
  catch (err) { return (err as Error).message; }
}
export const saveStrength = (id: string, save: (id: string) => Promise<unknown> = api.saveStrength) => saveChoice(id, save);

type Choice = { id: string; label: string; sub?: string };

/** 一排横着的按钮当单选（里面是真单选框，键盘、读屏照常用）。 */
function Segments({ name, items, value, disabled = false, onPick }: { name: string; items: Choice[]; value: string; disabled?: boolean; onPick: (id: string) => void }) {
  return <div className="seg" role="radiogroup">
    {items.map(item => <label key={item.id} className={item.id === value ? "seg__item is-on" : "seg__item"}>
      <input type="radio" name={name} checked={item.id === value} disabled={disabled} onChange={() => onPick(item.id)} />
      <span>{item.label}</span>{item.sub ? <small>{item.sub}</small> : null}
    </label>)}
  </div>;
}

const shortState = (ready: boolean, state: string) => ready ? "✓ 能用" : state.startsWith("已装好") ? "没登录" : "没装";
/** 「自动」下面那行小字：现在会落到谁头上。 */
const autoSub = (health: Health) => { const first = health.agents?.find(agent => agent.ready); return first ? `用 ${first.name}` : "都不能用"; };

/**
 * 设置面板「本机 AI 助手」那块（11-19 用户定：用谁和写词强度放一起）：上面一排选用谁，下面一排选强度，点了立刻保存、不用重启。
 * 强度只对本机 Claude 生效，现在用 Codex 时那排变灰。没登录的助手下面有「登录」按钮（AgentLoginButtons）。假火山模式、小服务没报清单（旧版）时不画。
 */
export function AgentPicker({ health, onChanged }: { health: Health; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!showAgent(health)) return null;
  const options = agentOptions(health);
  const choice = health.agentChoice ?? "auto";
  const picked = options.find(option => option.id === choice);
  const strength = health.agentStrength ?? "";
  const strengthPicked = STRENGTH_OPTIONS.find(option => option.id === strength);
  const codex = health.agent === "codex";

  const run = async (job: Promise<string | null>) => {
    setBusy(true); setError(null);
    const problem = await job;
    setError(problem); setBusy(false);
    if (!problem) onChanged();
  };

  return <section className="setp__sec">
    <header className="setp__head">
      <h3>本机 AI 助手</h3>
      <button type="button" className="setp__link" onClick={onChanged}>重新检查</button>
    </header>
    <fieldset className="setp__group" disabled={busy}>
      <Segments name="ggtv-agent" value={choice} onPick={id => void run(saveChoice(id))}
        items={options.map(option => ({ id: option.id, label: option.label, sub: option.id === "auto" ? autoSub(health) : shortState(option.ready, option.state) }))} />
      {picked && !picked.ready ? <p className="settings__hint">{picked.label}：{picked.state}{picked.hint ? `。${picked.hint}` : ""}</p> : null}
      {!picked && health.agentProblem ? <p className="settings__error">{health.agentProblem}点上面任意一项就能改回来。</p> : null}
      <AgentLoginButtons health={health} onChanged={onChanged} />
      {showStrength(health) ? <div className={codex ? "setp__strength is-off" : "setp__strength"}>
        <span className="setp__label">写词强度</span>
        <Segments name="ggtv-strength" value={strength} disabled={codex} onPick={id => void run(saveStrength(id))}
          items={STRENGTH_OPTIONS.map(option => ({ id: option.id, label: option.label }))} />
      </div> : null}
      {showStrength(health) ? <p className="settings__hint">{codex ? "现在用的是 Codex，写词强度只对 Claude 生效。"
        : strengthPicked ? `${strengthPicked.label}：${strengthPicked.state}。`
        : "现在用的是你在 .env.local 里手填的组合（CLAUDE_MODEL / CLAUDE_EFFORT），点上面任意一档就会改掉它。"}</p> : null}
    </fieldset>
    <p className="settings__hint">拆解、写词靠它，用你自己的账号额度，不花火山的钱。</p>
    {error ? <p className="settings__error" role="status">{error}</p> : null}
  </section>;
}
