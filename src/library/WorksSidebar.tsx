import { useEffect, useRef, useState } from "react";
import { api, workDownloadUrl } from "@/api";
import { Confirm } from "@/common/Confirm";
import type { Notify } from "@/common/Toast";
import { assetUrl } from "@/domain/cards";
import { filterWorks, workTitle, type WorkKindFilter } from "@/domain/works";
import { WorksGrid } from "@/library/WorksGrid";
import { markWorkDeleted, useWorksVersion } from "@/library/worksEvents";
import type { MediaWorkView } from "@/types";
import { useLibraryData } from './useLibraryData';
import { CharactersPanel } from './CharactersPanel';
import { UploadsPanel } from './UploadsPanel';
import { loadWorkDeletion } from './workDeletion';

type LibraryFilter = WorkKindFilter | 'character' | 'uploads';
const KINDS: Array<{ id: LibraryFilter; label: string }> = [
  { id: 'character', label: '人物' },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
  { id: "audio", label: "声音" },
  { id: "all", label: "全部" },
  { id: 'uploads', label: '我上传的' }
];

type Props = { canvasId: string; onClose: () => void; openViewer: (url: string, title: string, media?: "image" | "video" | "audio") => void; notify: Notify };

/**
 * 作品库 = 推开画布的左侧栏：图片、视频和提取的声音可筛选、拖入、下载、删除和预览；「我上传的」放从电脑传过的素材。
 */
export function WorksSidebar({ canvasId, onClose, openViewer, notify }: Props) {
  const version = useWorksVersion();
  const library = useLibraryData(version);
  const { works, workError } = library;
  const [kind, setKind] = useState<LibraryFilter>('character');
  const [onlyHere, setOnlyHere] = useState(false);
  const [deleting, setDeleting] = useState<{ work: MediaWorkView; text: string } | null>(null);
  const alive = useRef(true), deletionRequest = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const requestDelete = async (work: MediaWorkView) => {
    const request = ++deletionRequest.current;
    try {
      const confirmation = await loadWorkDeletion(work);
      if (alive.current && request === deletionRequest.current) setDeleting(confirmation);
    } catch (reason) {
      if (alive.current && request === deletionRequest.current) notify((reason as Error).message);
    }
  };

  const remove = async (work: MediaWorkView) => {
    setDeleting(null);
    try {
      await api.deleteWork(work.id);
      markWorkDeleted(work.id);
    } catch (err) {
      notify((err as Error).message);
    }
  };

  const shown = works && kind !== 'character' && kind !== 'uploads' ? filterWorks(works, kind, onlyHere ? canvasId : null) : [];

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
        {kind !== 'character' ? <label>
          <input type="checkbox" checked={onlyHere} onChange={(event) => setOnlyHere(event.target.checked)} />
          只看这张画布的
        </label> : null}
      </div>
      {kind === 'character' ? <CharactersPanel characters={library.characters} error={library.characterError} notify={notify}
        onUpdate={library.updateCharacter} onRemove={library.removeCharacter} /> : kind === 'uploads' ? (
        <UploadsPanel canvasId={onlyHere ? canvasId : null} openViewer={openViewer} notify={notify} />
      ) : workError ? (
        <p className="works__error">{workError}</p>
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
              <button type="button" onClick={() => void requestDelete(work)}>删除</button>
            </>
          )}
        />
      )}
      <p className="works__tip">把图片、视频或声音拖进画布就能接着用。</p>
      {deleting ? (
        <Confirm
          text={deleting.text}
          okLabel="删除"
          onOk={() => void remove(deleting.work)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </aside>
  );
}
