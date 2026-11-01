import { useRef, useState } from "react";
import { VIDEO_MODELS, VIDEO_RATIOS, normalizeVideoSettings, videoModelOf, type VideoSettings } from "@/domain/videoModels";
import { videoEstimate, videoModeLabel, videoSummary } from "@/domain/videoPanel";
import type { AssetRef, VideoGenSettings } from "@/types";
import { FloatingPanel } from "./FloatingPanel";

type SettingsProps = { video: VideoGenSettings; onChange: (video: VideoGenSettings) => void };
type MenuProps = SettingsProps & { onClose: () => void };
type Props = SettingsProps & { refs: AssetRef[]; sending: boolean; disabled: boolean; onSend: () => void };

export function VideoModelMenu({ video, onChange, onClose }: MenuProps) {
  return <div role="menu" aria-label="视频模型">{VIDEO_MODELS.map(model => (
    <button key={model.id} type="button" role="menuitemradio" aria-checked={video.model === model.id}
      className="model-menu__item" onClick={() => {
        onChange({ ...normalizeVideoSettings({ ...video, model: model.id }), count: video.count });
        onClose();
      }}><span className="model-icon" aria-hidden="true" /><span>{model.name}</span></button>
  ))}</div>;
}

export function VideoModeMenu({ video, onChange, onClose }: MenuProps) {
  return <><h3>视频生成模式</h3><div role="menu" aria-label="视频生成模式">
    {([['reference', '全能参考'], ['first_frame', '图生视频']] as const).map(([mode, label]) => (
      <button key={mode} type="button" role="menuitemradio" aria-checked={video.mode === mode}
        className="model-menu__item" onClick={() => {
          onChange({ ...normalizeVideoSettings({ ...video, mode }), count: video.count });
          onClose();
        }}>{label}</button>
    ))}
  </div></>;
}

/** 视频底行复用图片面板的浮层与按钮样式。 */
export function VideoOptions({ video, refs, sending, disabled, onChange, onSend }: Props) {
  const [open, setOpen] = useState<"model" | "mode" | "settings" | null>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const modeButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const anchor = open === "model" ? modelButton.current : open === "mode" ? modeButton.current : settingsButton.current;
  const model = videoModelOf(video.model)!;
  const estimate = videoEstimate(video, refs);
  const menuProps = { video, onChange, onClose: () => setOpen(null) };
  return <div className="gen gen--video">
    <button ref={modelButton} type="button" className="gen__model" aria-haspopup="menu" aria-expanded={open === "model"}
      onClick={() => setOpen(open === "model" ? null : "model")}><span className="model-icon" aria-hidden="true" />{model.name.replace("Seedance ", "")}</button>
    <button ref={modeButton} type="button" aria-haspopup="menu" aria-expanded={open === "mode"}
      onClick={() => setOpen(open === "mode" ? null : "mode")}>{videoModeLabel(video.mode, refs.length)}</button>
    <button ref={settingsButton} type="button" className="gen__settings" aria-haspopup="dialog" aria-expanded={open === "settings"}
      onClick={() => setOpen(open === "settings" ? null : "settings")}>{videoSummary(video)}</button>
    {open && anchor ? <FloatingPanel anchor={anchor} keepAnchor direction="up" className="gen-options" onClose={() => setOpen(null)}>
      {open === "model" ? <VideoModelMenu {...menuProps} /> : open === "mode" ? <VideoModeMenu {...menuProps} /> : <VideoOptionChoices video={video} onChange={onChange} />}
    </FloatingPanel> : null}
    <span className="gen__price" title={estimate.note}>¥{estimate.yuan.toFixed(2)}</span>
    <button type="button" className="gen__send" disabled={sending || disabled} onClick={onSend}>{sending ? "发送中…" : "发送"}</button>
  </div>;
}

export function VideoOptionChoices({ video, onChange }: SettingsProps) {
  const model = videoModelOf(video.model)!;
  const autoOnly = video.mode === "first_frame" && model.id === VIDEO_MODELS[3].id;
  const change = (patch: Partial<VideoSettings>) => onChange({ ...normalizeVideoSettings({ ...video, ...patch }), count: video.count });
  return <>
    <h3>比例</h3><div className="gen-options__choices video-ratios">
      {["adaptive", ...VIDEO_RATIOS.filter(ratio => ratio !== "adaptive")].map(ratio => {
        const [width, height] = (ratio === "adaptive" ? "16:9" : ratio).split(":").map(Number);
        return <button key={ratio} type="button" aria-pressed={video.ratio === ratio} disabled={autoOnly && ratio !== "adaptive"}
          onClick={() => change({ ratio: ratio as VideoSettings["ratio"] })}>
          <span className="video-ratio-icon" aria-hidden="true" style={{ width: 16 * width / Math.max(width, height), height: 16 * height / Math.max(width, height) }} />
          {ratio === "adaptive" ? "Auto" : ratio}</button>;
      })}
    </div>
    <h3>清晰度</h3><div className="gen-options__choices">{model.resolutions.map(resolution => (
      <button key={resolution} type="button" aria-pressed={video.resolution === resolution}
        onClick={() => change({ resolution: resolution as VideoSettings["resolution"] })}>{resolution.toUpperCase()}</button>
    ))}</div>
    <h3>视频时长</h3><div className="video-duration">
      <input type="range" aria-label="视频时长滑块" min={model.minDuration} max={model.maxDuration} step={1} value={video.duration}
        onChange={event => change({ duration: Number(event.target.value) })} />
      <input type="number" aria-label="视频时长秒数" min={model.minDuration} max={model.maxDuration} step={1} value={video.duration}
        onChange={event => change({ duration: Number(event.target.value) })} /><span>s</span>
    </div>
    <h3>生成音频</h3><div className="gen-options__choices">{[true, false].map(audio => (
      <button key={String(audio)} type="button" aria-pressed={video.audio === audio} onClick={() => change({ audio })}>{audio ? "开启" : "关闭"}</button>
    ))}</div>
    <h3>生成数量</h3><div className="gen-options__choices">{([1, 2, 4] as const).map(count => (
      <button key={count} type="button" aria-pressed={video.count === count} onClick={() => onChange({ ...video, count })}>{count}个</button>
    ))}</div>
  </>;
}
