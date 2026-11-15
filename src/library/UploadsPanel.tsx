import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import { Confirm } from "@/common/Confirm";
import type { Notify } from "@/common/Toast";
import { assetDownloadUrl, assetUrl } from "@/domain/cards";
import { filterUploads, uploadDeleteText, uploadsSummary } from "@/domain/uploads";
import { markUploadDeleted, useWorksVersion } from "@/library/worksEvents";
import { UploadsGrid } from "@/library/UploadsGrid";
import type { UploadList, UploadView } from "@/uploadTypes";

type Props = { canvasId: string | null; openViewer: (url: string, title: string, media?: "image" | "video" | "audio") => void; notify: Notify };

/** 作品库「我上传的」：从电脑传过的图片和视频，长期留着；能拖进画布、看、下载、删。 */
export function UploadsPanel({ canvasId, openViewer, notify }: Props) {
  const version = useWorksVersion();
  const [list, setList] = useState<UploadList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ upload: UploadView; text: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    api.listUploads().then(value => { if (alive.current) { setList(value); setError(null); } },
      (reason: Error) => { if (alive.current) setError(reason.message); });
  }, [version]);

  const requestDelete = async (upload: UploadView) => {
    try {
      const text = uploadDeleteText(upload, await api.listCharacters());
      if (alive.current) setDeleting({ upload, text });
    } catch (reason) { notify((reason as Error).message); }
  };
  const remove = async (upload: UploadView) => {
    setDeleting(null);
    try {
      await api.deleteUpload(upload.id);
      markUploadDeleted(upload.id);
    } catch (reason) { notify((reason as Error).message); }
  };

  if (error) return <p className="works__error">{error}</p>;
  if (!list) return <p className="works__empty">读取中…</p>;
  const shown = filterUploads(list.items, canvasId);
  return <>
    {list.items.length ? <p className="works__tip">{uploadsSummary(list.items.length, list.bytes)}</p> : null}
    <UploadsGrid items={shown} draggable
      onOpen={upload => openViewer(assetUrl({ type: "upload", id: upload.id }), upload.name, upload.kind)}
      actions={upload => <>
        <a href={assetDownloadUrl({ type: "upload", id: upload.id })} download={upload.name}>下载</a>
        <button type="button" onClick={() => void requestDelete(upload)}>删除</button>
      </>} />
    {deleting ? <Confirm text={deleting.text} okLabel="删除" onOk={() => void remove(deleting.upload)} onCancel={() => setDeleting(null)} /> : null}
  </>;
}
