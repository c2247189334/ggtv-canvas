import { useState } from "react";
import { api } from "@/api";
import { agentOptions } from "@/domain/agentChoice";
import type { Health } from "@/types";

/** 保存选择：成了回 null，没成回给人看的原话。 */
export async function saveChoice(id: string, save: (id: string) => Promise<unknown> = api.saveAgent): Promise<string | null> {
  try { await save(id); return null; }
  catch (err) { return (err as Error).message; }
}

/**
 * 设置面板「本机 AI 助手」：看 Claude、Codex 各自装没装登没登录，点选用谁（11-17 用户定，原来要手改 .env.local）。
 * 点了立刻保存、立刻生效，不用重启。假火山模式用不到本机助手，不画。
 */
export function AgentPicker({ health, onChanged }: { health: Health; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = agentOptions(health);
  if (health.fake || !options.length) return null;
  const choice = health.agentChoice ?? "auto";
  const known = options.some(option => option.id === choice);

  const pick = async (id: string) => {
    setBusy(true); setError(null);
    const problem = await saveChoice(id);
    setError(problem); setBusy(false);
    if (!problem) onChanged();
  };

  return <fieldset className="agents" disabled={busy}>
    <legend>本机 AI 助手用谁</legend>
    <p className="settings__hint">视频改写、拆解、帮我改写要用它看视频、写提示词，走你自己的 Claude / Codex 账号额度，不花火山的钱。点一下就换，不用重启。</p>
    {options.map(option => <label key={option.id} className="agents__row">
      <input type="radio" name="ggtv-agent" checked={choice === option.id} onChange={() => void pick(option.id)} />
      <div><b>{option.label}</b>：{option.state}{option.hint ? <p className="settings__hint">{option.hint}</p> : null}</div>
    </label>)}
    {!known && health.agentProblem ? <p className="settings__error">{health.agentProblem}点上面任意一项就能改回来。</p> : null}
    <button type="button" onClick={onChanged}>重新检查</button>
    {error ? <p className="settings__error" role="status">{error}</p> : null}
  </fieldset>;
}
