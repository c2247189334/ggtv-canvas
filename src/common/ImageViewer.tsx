import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useEscapeLayer } from "./useEscapeLayer";
import { fitSize, panWithin, VIEWER_RESET, wheelZoom, type Size } from "@/domain/viewerZoom";

type Props = { url: string; title: string; onClose: () => void };

/** 看大图：卡上「预览」和作品库点开都走这里。Esc 关。 */
export function ImageViewer({ url, title, media, onClose }: Props & { media?: "image" | "video" | "audio" }) {
  useEscapeLayer(onClose, true, 1200);
  return createPortal(
    media === "audio" ? <AudioPreview url={url} title={title} onClose={onClose} /> :
      media === "video" ? <VideoPreview url={url} title={title} onClose={onClose} /> : <ImagePreview url={url} title={title} onClose={onClose} />,
    document.body
  );
}

/** 声音预览复用媒体查看层的整屏黑底和关闭入口，不自动播放。 */
export function AudioPreview({ url, title, onClose }: Props) {
  return (
    <div className="viewer viewer--audio" role="dialog" aria-modal="true" aria-label={title}>
      <div className="viewer__top">
        <span className="viewer__name">{title}</span>
        <button type="button" onClick={onClose}>关闭（Esc）</button>
      </div>
      <div className="viewer__audio"><audio src={url} controls aria-label={title} /></div>
    </div>
  );
}

/** 视频预览：整屏黑底，顶栏左边名字、右边关闭；原生有声播放器，不自动播放。 */
export function VideoPreview({ url, title, onClose }: Props) {
  return (
    <div className="viewer viewer--video" role="dialog" aria-modal="true" aria-label={title}>
      <div className="viewer__top">
        <span className="viewer__name">{title}</span>
        <button type="button" onClick={onClose}>关闭（Esc）</button>
      </div>
      <video className="viewer__video" src={url} controls playsInline aria-label={title} />
    </div>
  );
}

/** 图片预览：半透明黑底，图在框里按比例放满，框角一个关闭钮，不写标题；点黑底关。 */
export function ImagePreview({ url, title, onClose }: Props) {
  const backdrop = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const natural = useRef<Size>({ width: 0, height: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [view, setView] = useState(VIEWER_RESET);

  const limits = () => {
    const box = { width: frame.current?.clientWidth ?? 0, height: frame.current?.clientHeight ?? 0 };
    return [box, fitSize(box, natural.current)] as const;
  };

  // React 的 onWheel 是被动监听，拦不住 Ctrl + 滚轮缩放整个网页，只能自己挂。
  useEffect(() => {
    const el = backdrop.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setView(v => panWithin(wheelZoom(v, event.deltaY), 0, 0, ...limits()));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerMove = (event: PointerEvent) => {
    const start = drag.current;
    if (!start) return;
    drag.current = { x: event.clientX, y: event.clientY };
    setView(v => panWithin(v, event.clientX - start.x, event.clientY - start.y, ...limits()));
  };

  return (
    <div ref={backdrop} className="viewer" role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={frame} className="viewer__frame">
        <div className="viewer__clip">
          <img className="viewer__image" src={url} alt={title} draggable={false}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            onLoad={event => { natural.current = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }; }}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY }; }}
            onPointerMove={onPointerMove}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onDoubleClick={() => setView(VIEWER_RESET)} />
        </div>
        <button type="button" className="viewer__close" aria-label="关闭（Esc）" onClick={onClose}>×</button>
      </div>
    </div>
  );
}
