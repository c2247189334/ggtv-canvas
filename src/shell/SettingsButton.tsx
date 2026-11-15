import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import { useEscapeLayer } from "@/common/useEscapeLayer";
import { missingDepthConfig, meshConfigProblem } from "@/domain/health";
import type { Health } from "@/types";

export function HealthDetails({ health }: { health: Health }) {
  const missing = missingDepthConfig(health.depth);
  const meshProblem = meshConfigProblem(health.mesh);
  return <>
    {health.fake ? <p className="settings__hint">现在是假火山模式：出的是纯色假图，免费，数据存在 .fake-data 文件夹。</p> : null}
    <p>火山 Key：{health.keyReady ? "已填好" : "没填"}</p>
    <p>TOS（存参考视频）：{health.tosReady ? "已填" : "没填"}</p>
    <p>深度动作捕捉：{missing.length ? `缺 ${missing.join("、")}（填在 .env.local）` : "已就绪"}</p>
    <p>白模动作捕捉：{health.fake || !meshProblem ? '已就绪' : meshProblem.replace(/^白模动作捕捉/, '')}</p>
    <p>白模地址：{health.mesh?.url.filled ? `已填，${health.mesh.url.found ? '本机地址' : '地址不对'}` : '默认本机地址'}</p>
    <p>白模文件夹：{health.mesh?.directory.filled ? `已填，${health.mesh.directory.found ? '已找到' : '没找到'}` : '没填（可使用已打开的 ComfyUI）'}</p>
    <p>ffmpeg：{health.ffmpegFound ? "已找到" : "没找到"}</p>
    <p>本机 agent（视频改写、拆解、帮我改写要用；只出图出视频不需要）：{health.agentReady ? `${health.agentName} 已就绪，模型 ${health.agentModel}` : health.agentProblem}</p>
    {!health.keyReady ? <p className="settings__hint">填在项目文件夹里的 .env.local 文件，ARK_API_KEY= 后面。填好不用重启。</p> : null}
  </>;
}

/** 右上角「设置」：Key 填没填。假火山模式时旁边挂个黄牌子。点外面或按 Esc 关掉。 */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEscapeLayer(() => setOpen(false), open, 10);

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
      },
      (err: Error) => {
        if (alive) setError(err.message);
      }
    );
    return () => {
      alive = false;
    };
  }, [open]);

  return (
    <div className="settings" ref={ref}>
      {health?.fake ? <span className="settings__chip">假火山 · 免费</span> : null}
      <button type="button" onClick={() => setOpen((o) => !o)}>设置</button>
      {open ? (
        <div className="settings__panel">
          {error ? (
            <p className="settings__error">{error}</p>
          ) : !health ? (
            <p>读取中…</p>
          ) : (
            <HealthDetails health={health} />
          )}
        </div>
      ) : null}
    </div>
  );
}
