import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import { useEscapeLayer } from "@/common/useEscapeLayer";
import { subscribeOpenSettings } from "@/common/keyNeeded";
import { featureChecklist, type FeatureRow } from "@/domain/featureChecklist";
import type { Health } from "@/types";
import { AgentPicker } from "./AgentPicker";
import { KeyForm } from "./KeyForm";

function Feature({ row }: { row: FeatureRow }) {
  return <li className={row.ok ? "features__row is-ok" : "features__row"}>
    <span className="features__mark" aria-hidden="true">{row.ok ? "✓" : "!"}</span>
    <div><b>{row.name}</b>：{row.state}{row.fix ? <p className="settings__hint">{row.fix}</p> : null}</div>
  </li>;
}

/** 功能清单：每行一个功能，能不能用、缺什么、怎么办。深度、白模是选装，默认折叠（11-17 用户定，原来是一排变量名）。 */
export function HealthDetails({ health, keyRejected = false }: { health: Health; keyRejected?: boolean }) {
  const { main, optional } = featureChecklist(health, keyRejected);
  const optionalReady = optional.filter(row => row.ok).length;
  return <>
    {health.fake ? <p className="settings__hint">现在是假火山模式：出的是纯色假图，免费，数据存在 .fake-data 文件夹。</p> : null}
    <ul className="features">{main.map(row => <Feature key={row.name} row={row} />)}</ul>
    <details className="features__optional">
      <summary>选装功能（不装不影响别的）：{optionalReady === optional.length ? "都装好了" : `${optional.length - optionalReady} 项没装`}</summary>
      <ul className="features">{optional.map(row => <Feature key={row.name} row={row} />)}</ul>
    </details>
    {!health.keyReady ? <p className="settings__hint">没填 Key 也能先用画布、上传、剪辑；出图、出视频那一步才要。</p> : null}
  </>;
}

/** 每台电脑只自动弹一次「还没填 Key」；读写不了本地存储就不自动弹，只留黄牌子。 */
const ASKED = "ggtv.keyAsked";
function firstTimeAsk(): boolean {
  try {
    if (localStorage.getItem(ASKED)) return false;
    localStorage.setItem(ASKED, "1");
    return true;
  } catch { return false; }
}

/** 右上角「设置」：填 Key、看各项填没填。假火山模式时旁边挂个黄牌子；没填 Key 时挂「还没填火山 Key」。点外面或按 Esc 关掉。 */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // 这次保存时火山说 Key 不对（只记在页面里）：黄牌子和功能清单照「还不能用」显示，重新保存验过了才清。
  const [keyRejected, setKeyRejected] = useState(false);
  const asked = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  useEscapeLayer(() => setOpen(false), open, 10);
  // 「要先填火山 Key」弹框里的「去填 Key」会叫这里打开。
  useEffect(() => subscribeOpenSettings(() => setOpen(true)), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open]);

  useEffect(() => {
    let alive = true;
    api.health().then(
      (h) => {
        if (!alive) return;
        setHealth(h);
        setError(null);
        // 第一次打开、真模式又没填 Key：自动展开一次，告诉普通人在哪填。
        if (!asked.current && !h.fake && !h.keyReady) { asked.current = true; if (firstTimeAsk()) setOpen(true); }
      },
      (err: Error) => {
        if (alive) setError(err.message);
      }
    );
    return () => {
      alive = false;
    };
  }, [open, reload]);

  // 每次打开面板时定一次顺序，开着的这段时间不变。
  const orderAtOpen = useRef<boolean | null>(null);
  if (!open) orderAtOpen.current = null;
  const formFirst = (h: Health) => (orderAtOpen.current ??= !h.fake && (!h.keyReady || keyRejected));
  const needKey = health && !health.fake && !health.keyReady;
  return (
    <div className="settings" ref={ref}>
      {health?.fake ? <span className="settings__chip">假火山 · 免费</span> : null}
      {needKey || keyRejected ? <button type="button" className="settings__chip settings__chip--warn" onClick={() => setOpen(true)}>{needKey ? "还没填火山 Key" : "火山 Key 不对"}</button> : null}
      <button type="button" onClick={() => setOpen((o) => !o)}>设置</button>
      {open ? (
        <div className="settings__panel">
          {error ? (
            <p className="settings__error">{error}</p>
          ) : !health ? (
            <p>读取中…</p>
          ) : (
            // 没填 Key 时填写框放最上面，新手一打开就看到；填好了下次打开才退到状态清单下面
            // （开着的时候不挪，「已保存」那句话才不会被挤到屏幕外）。
            (formFirst(health) ? ["keys", "health"] : ["health", "keys"]).map(part => part === "keys"
              ? <KeyForm key="keys" health={health} onSaved={check => { if (check) setKeyRejected(check === "rejected"); setReload(n => n + 1); }} />
              : <div key="health"><HealthDetails health={health} keyRejected={keyRejected} /><AgentPicker health={health} onChanged={() => setReload(n => n + 1)} /></div>)
          )}
        </div>
      ) : null}
    </div>
  );
}
