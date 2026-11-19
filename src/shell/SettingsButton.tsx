import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import { useEscapeLayer } from "@/common/useEscapeLayer";
import { subscribeOpenSettings } from "@/common/keyNeeded";
import type { Health } from "@/types";
import { SettingsPanel } from "./SettingsPanel";

/** 每台电脑只自动弹一次「还没填 Key」；读写不了本地存储就不自动弹，只留黄牌子。 */
const ASKED = "ggtv.keyAsked";
function firstTimeAsk(): boolean {
  try {
    if (localStorage.getItem(ASKED)) return false;
    localStorage.setItem(ASKED, "1");
    return true;
  } catch { return false; }
}

/**
 * 按下的地方算不算「面板外面」。面板里的「?」气泡挂在 body 上、不在面板里，也不算外面：
 * 否则按下气泡里的「API Key 管理」等链接，面板就关了、没保存的字也丢了（11-19 上传前审查发现）。
 */
export function clickedOutside(target: EventTarget | null, panel: { contains(node: Node | null): boolean } | null): boolean {
  if (!panel) return false;
  const element = target as (Node & { closest?: (selector: string) => unknown }) | null;
  if (typeof element?.closest === "function" && element.closest(".help-tip__bubble")) return false;
  return !panel.contains(element);
}

/**
 * 右上角「设置」（11-19 用户定：一个面板里全搞定）：点开是 SettingsPanel，在里面改完不关、不跳走；点外面或按 Esc 才关。
 * 假火山模式旁边挂黄牌子；没填 Key 挂「还没填火山 Key」，点它打开面板并滚到填 Key 那块。
 */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // 这次保存时火山说 Key 不对（只记在页面里）：黄牌子和功能清单照「还不能用」显示，重新保存验过了才清。
  const [keyRejected, setKeyRejected] = useState(false);
  // 填好了的 Key 默认收成一行；点「重新填」或从别处叫来填 Key 才摊开。keyFocus 每叫一次加 1，那块就滚到眼前。
  const [keyEditing, setKeyEditing] = useState(false);
  const [keyFocus, setKeyFocus] = useState(0);
  const asked = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); setKeyEditing(false); setKeyFocus(0); };
  const openKeys = () => { setOpen(true); setKeyEditing(true); setKeyFocus(n => n + 1); };
  useEscapeLayer(close, open, 10);
  // 「要先填火山 Key」弹框里的「去填 Key」会叫这里打开填 Key。
  useEffect(() => subscribeOpenSettings(openKeys), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (clickedOutside(event.target, ref.current)) close();
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
        // 第一次打开、真模式又没填 Key：自动打开一次面板，告诉普通人在哪填。
        if (!asked.current && !h.fake && !h.keyReady) { asked.current = true; if (firstTimeAsk()) openKeys(); }
      },
      (err: Error) => {
        if (alive) setError(err.message);
      }
    );
    return () => {
      alive = false;
    };
  }, [open, reload]);

  const refresh = () => setReload(n => n + 1);
  const needKey = health && !health.fake && !health.keyReady;
  return (
    <div className="settings" ref={ref}>
      {health?.fake ? <span className="settings__chip">假火山 · 免费</span> : null}
      {needKey || keyRejected ? <button type="button" className="settings__chip settings__chip--warn" onClick={openKeys}>{needKey ? "还没填火山 Key" : "火山 Key 不对"}</button> : null}
      <button type="button" onClick={() => (open ? close() : setOpen(true))}>设置</button>
      {open ? (
        <div className="settings__panel">
          {error ? <p className="settings__error">{error}</p> : !health ? <p>读取中…</p>
            : <SettingsPanel health={health} keyRejected={keyRejected} keyEditing={keyEditing} keyFocus={keyFocus}
              onKeyEditing={setKeyEditing} onChanged={refresh}
              onKeySaved={check => { if (check) setKeyRejected(check === "rejected"); refresh(); }} />}
        </div>
      ) : null}
    </div>
  );
}
