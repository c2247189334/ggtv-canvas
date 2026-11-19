import { useEffect, useState } from "react";
import { api } from "@/api";
import { loginTargets } from "@/domain/agentChoice";
import type { AgentState, Health } from "@/types";

/** 点了登录以后最多等多久、多久看一次登好了没有。 */
export const LOGIN_WAIT_MS = 5 * 60 * 1000;
export const LOGIN_POLL_MS = 2000;

/** 叫小服务开官方登录窗口：成了回 null，没成回给人看的原话。 */
export async function openLogin(id: string, open: (id: string) => Promise<unknown> = api.openAgentLogin): Promise<string | null> {
  try { await open(id); return null; }
  catch (err) { return (err as Error).message; }
}

export type Waiting = { id: string; name: string; until: number };

/** 等登录的每一步：那个助手登录过了 → done；还没到点 → poll（再读一次体检）；过了 5 分钟 → timeout。 */
export function waitStep(waiting: Waiting, health: Health, now: number): "done" | "poll" | "timeout" {
  if (health.agents?.find(agent => agent.id === waiting.id)?.login) return "done";
  return now < waiting.until ? "poll" : "timeout";
}

/**
 * 「登录 Claude / 登录 Codex」按钮（11-19 用户定：点一下就弹登录窗口，登好了自己弄好）：
 * 点了小服务打开官方登录窗口（会自己开浏览器登录页），这里每 2 秒重读一次体检，那个助手登录好了就说「登好了」，不用再点重新检查；
 * 5 分钟没等到就停下，叫人登好了点重新检查。登录全程在官方窗口和浏览器里，本程序不经手账号密码。
 */
export function AgentLoginButtons({ health, onChanged }: { health: Health; onChanged: () => void }) {
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const loggedIn = waiting ? waitStep(waiting, health, 0) === "done" : false;

  // 体检每次重读回来 health 就变；登录过了 loggedIn 变 true，这里重跑一次就收工。
  useEffect(() => {
    if (!waiting) return;
    if (loggedIn) { setNote({ ok: true, text: `${waiting.name} 登录好了，能用了。` }); setWaiting(null); return; }
    const timer = setInterval(() => {
      if (waitStep(waiting, health, Date.now()) === "poll") { onChanged(); return; }
      setWaiting(null);
      setNote({ ok: false, text: `没等到 ${waiting.name} 登录好。登好了点上面的「重新检查」；登录窗口关掉了就再点一次登录。` });
    }, LOGIN_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, loggedIn]);

  const targets = loginTargets(health);
  if (!targets.length && !note) return null;

  const login = async (agent: AgentState) => {
    setNote(null);
    const problem = await openLogin(agent.id);
    if (problem) { setNote({ ok: false, text: problem }); return; }
    setWaiting({ id: agent.id, name: agent.name, until: Date.now() + LOGIN_WAIT_MS });
  };

  return <>
    {targets.length ? <div className="setp__actions">
      {targets.map(agent => <button key={agent.id} type="button" disabled={Boolean(waiting)} onClick={() => void login(agent)}>
        {waiting?.id === agent.id ? `等你登录 ${agent.name}…` : `登录 ${agent.name}`}
      </button>)}
    </div> : null}
    {waiting ? <p className="settings__hint" role="status">已经打开 {waiting.name} 的官方登录窗口：在弹出的浏览器页面里登录（黑窗口里有提示也照着做），登好了这里会自己变成能用。</p> : null}
    {note ? <p className={note.ok ? "settings__hint is-ok" : "settings__error"} role="status">{note.text}</p> : null}
  </>;
}
