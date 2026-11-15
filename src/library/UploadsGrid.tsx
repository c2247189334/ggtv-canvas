import type { ReactNode } from "react";
import { assetUrl } from "@/domain/cards";
import { durationLabel } from "@/domain/videoPanel";
import { WORK_IMAGE_DRAG_TYPE } from "@/domain/media";
import { uploadDragData } from "@/domain/uploads";
import { WORK_DRAG_TYPE } from "@/library/WorksGrid";
import type { UploadView } from "@/uploadTypes";

type Props = { items: UploadView[]; onOpen: (upload: UploadView) => void; draggable?: boolean; actions?: (upload: UploadView) => ReactNode };

/** 「我上传的」网格：作品库侧栏和「从作品库选」弹窗共用；格子上写原文件名。 */
export function UploadsGrid({ items, onOpen, draggable = false, actions }: Props) {
  if (!items.length) return <p className="works__empty">还没有上传过素材。从电脑传的图片和视频会自动留在这里。</p>;
  return (
    <div className="works__grid">
      {items.map((upload) => (
        <figure key={upload.id} className="works__tile" title={upload.name} draggable={draggable}
          onDragStart={draggable ? (event) => {
            event.dataTransfer.setData(WORK_DRAG_TYPE, uploadDragData(upload));
            event.dataTransfer.effectAllowed = "copy";
            if (upload.kind === "image") event.dataTransfer.setData(WORK_IMAGE_DRAG_TYPE, "image");
          } : undefined}>
          {upload.kind === "video" ? <>
            <video src={`${assetUrl({ type: "upload", id: upload.id })}#t=0.001`} muted preload="metadata" playsInline aria-label={upload.name} onClick={() => onOpen(upload)} />
            <button className="works__play" type="button" aria-label={`播放 ${upload.name}`} onClick={() => onOpen(upload)}>▶</button>
            <span className="works__duration">{durationLabel(upload.duration)}</span>
          </> : <img src={assetUrl({ type: "upload", id: upload.id })} alt={upload.name} loading="lazy" draggable={false} onClick={() => onOpen(upload)} />}
          <span className="works__name">{upload.name}</span>
          {actions ? <figcaption className="works__actions">{actions(upload)}</figcaption> : null}
        </figure>
      ))}
    </div>
  );
}
