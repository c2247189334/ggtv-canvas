import { useEffect, useState } from "react";
import { api, workDownloadUrl } from "@/api";
import { Confirm } from "@/common/Confirm";
import type { Notify } from "@/common/Toast";
import { assetUrl } from "@/domain/cards";
import { filterWorks, workTitle, type WorkKindFilter } from "@/domain/works";
import { WorksGrid } from "@/library/WorksGrid";
import { markWorkDeleted, useWorksVersion } from "@/library/worksEvents";
import type { MediaWorkView } from "@/types";

const WORKS_REFRESH_INTERVAL_MS = 5000;

// 用户 10-30 定：默认看图片，「全部」放最后。
const KINDS: Array<{ id: WorkKindFilter; label: string }> = [
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "audio", label: "声音" },
  { id: "all", label: "全部" }
];

type Props = { canvasId: string; onClose: () => void; openViewer: (url: string, title: string, media?: "image" | "video" | "audio") => void; notify: Notify };

/**
 * 作品库 = 推开画布的左侧栏：图片、视频和提取的声音可筛选、拖入、下载、删除和预览。
 */
export function WorksSidebar({ canvasId, onClose, openViewer, notify }: Props) {
  const version = useWorksVersion();
  const [works, setWorks] = useState<MediaWorkView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<WorkKindFilter>("image");
  const [onlyHere, setOnlyHere] = useState(false);
  const [deleting, setDeleting] = useState<MediaWorkView | null>(null);

  useEffect(() => {
    let alive = true;
    let loading = false;
    const refresh = async (silent: boolean) => {
      if (loading) return;
      loading = true;
      try {
        const list = await api.listMediaWorks();
        if (alive) {
          setWorks((current) => JSON.stringify(current) === JSON.stringify(list) ? current : list);
          setError(null);
        }
      } catch (err) {
        if (alive && !silent) setError((err as Error).message);
      } finally {
        loading = false;
      }
    };
    void refresh(false);
    const timer = window.setInterval(() => void refresh(true), WORKS_REFRESH_INTERVAL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [version]);

  const remove = async (work: MediaWorkView) => {
    setDeleting(null);
    try {
      await api.deleteWork(work.id);
      markWorkDeleted(work.id);
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const shown = works ? filterWorks(works, kind, onlyHere ? canvasId : null) : [];

  return (
    <aside className="works">
      <header className="works__head">
        <strong>作品库</strong>
        <button type="button" onClick={onClose}>收起</button>
      </header>
      <div className="works__filters">
        {KINDS.map((k) => (
          <button key={k.id} type="button" className={kind === k.id ? "is-on" : ""} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
        <label>
          <input type="checkbox" checked={onlyHere} onChange={(event) => setOnlyHere(event.target.checked)} />
          只看这张画布的
        </label>
      </div>
      {error ? (
        <p className="works__error">{error}</p>
      ) : works === null ? (
        <p className="works__empty">读取中…</p>
      ) : (
        <WorksGrid
          works={shown}
          draggable
          onOpen={(work) => openViewer(assetUrl({ type: "work", id: work.id }), workTitle(work), work.kind)}
          actions={(work) => (
            <>
              <a href={workDownloadUrl(work.id)} download>下载</a>
              <button type="button" onClick={() => setDeleting(work)}>删除</button>
            </>
          )}
        />
      )}
      <p className="works__tip">把图片、视频或声音拖进画布就能接着用。</p>
      {deleting ? (
        <Confirm
          text="删掉这件作品？硬盘上的文件会一起删掉，画布上用到它的卡片会显示「作品已删除」。"
          okLabel="删除"
          onOk={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </aside>
  );
}
