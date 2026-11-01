import { useState } from "react";

/**
 * 卡上「生成中」遮罩：转圈 + 一句话，不写已用时间（用户 10-31 定：开源给所有人用，快慢看各人电脑）。
 * 本机算的（深度、白模）多一行配置说明；火山出的图和视频在火山上算，跟电脑无关，不写这句。
 * 10-31 用户：本机算的能停（onStop），点了换成「正在停止…」，等后台中断收尾后卡上写已停止。
 */
export function BusyOverlay({ text, local = false, onStop }: { text: string; local?: boolean; onStop?: () => void }) {
  const [stopping, setStopping] = useState(false);
  return <div className="card__busy"><span className="busy-label"><span className="busy-spinner" aria-hidden="true" />{stopping ? "正在停止…" : text}</span>
    {local ? <span className="busy-hint">生成速度取决于电脑配置</span> : null}
    {onStop ? <button type="button" className="busy-stop nodrag nopan" disabled={stopping}
      onClick={event => { event.stopPropagation(); setStopping(true); onStop(); }}>停止</button> : null}</div>;
}
