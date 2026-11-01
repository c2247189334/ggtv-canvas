import type { ReactNode } from "react";
import { assetUrl } from "@/domain/cards";
import { workTitle } from "@/domain/works";
import { durationLabel } from "@/domain/videoPanel";
import { WORK_IMAGE_DRAG_TYPE } from '@/domain/media';
import type { MediaWorkView } from "@/types";

/** 作品拖进画布时带的数据类型（画布的 onDrop 认这个）。 */
export const WORK_DRAG_TYPE = "application/x-canvas-work";

type Props = { works: MediaWorkView[]; onOpen: (work: MediaWorkView) => void; draggable?: boolean; actions?: (work: MediaWorkView) => ReactNode };

/** 作品网格：作品库侧栏和「从作品库选」弹窗共用。 */
export function WorksGrid({ works, onOpen, draggable = false, actions }: Props) {
  if (!works.length) return <p className="works__empty">还没有作品。图片、视频和提取的声音会自动出现在这里。</p>;
  return (
    <div className="works__grid">
      {works.map((work) => (
        <figure
          key={work.id}
          className="works__tile"
          title={workTitle(work)}
          draggable={draggable}
          onDragStart={
            draggable
              ? (event) => {
                  event.dataTransfer.setData(WORK_DRAG_TYPE, JSON.stringify({ id: work.id, kind: work.kind, duration: work.duration,
                    ...(work.kind === "video" ? { hasAudio: work.hasAudio, fps: work.fps, depth: work.depth, mesh: work.mesh } : {}),
                    ...(work.kind === "audio" ? {} : { width: work.width, height: work.height }) }));
                  event.dataTransfer.effectAllowed = "copy";
                  if (work.kind === 'image') event.dataTransfer.setData(WORK_IMAGE_DRAG_TYPE, 'image');
                }
              : undefined
          }
        >
          {work.kind === "audio" ? <>
            <button className="works__audio" type="button" aria-label={`播放 ${workTitle(work)}`} onClick={() => onOpen(work)}>♪</button>
            <span className="works__duration">{durationLabel(work.duration)}</span>
          </> : work.kind === "video" ? <>
            <video src={`${assetUrl({ type: "work", id: work.id })}#t=0.001`} muted preload="metadata" playsInline aria-label={workTitle(work)} onClick={() => onOpen(work)} />
            <button className="works__play" type="button" aria-label={`播放 ${workTitle(work)}`} onClick={() => onOpen(work)}>▶</button>
            <span className="works__duration">{durationLabel(work.duration)}</span>
            {work.depth ? <span className="works__depth">深度</span> : null}
            {work.mesh ? <span className="works__depth">白模</span> : null}
          </> : <img src={assetUrl({ type: "work", id: work.id })} alt={workTitle(work)} loading="lazy" draggable={false} onClick={() => onOpen(work)} />}
          {actions ? <figcaption className="works__actions">{actions(work)}</figcaption> : null}
        </figure>
      ))}
    </div>
  );
}
