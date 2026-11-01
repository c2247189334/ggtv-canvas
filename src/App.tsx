import { useCallback, useEffect, useState } from "react";
import { api } from "@/api";
import { CanvasBoard } from "@/canvas/CanvasBoard";
import { Confirm } from "@/common/Confirm";
import { ImageViewer } from "@/common/ImageViewer";
import { Toast, useToast } from "@/common/Toast";
import { WorksSidebar } from "@/library/WorksSidebar";
import { SettingsButton } from "@/shell/SettingsButton";
import type { CanvasSummary } from "@/types";

const summaryOf = (doc: { id: string; name: string; updatedAt?: string }): CanvasSummary => ({
  id: doc.id,
  name: doc.name,
  updatedAt: doc.updatedAt ?? ""
});

/** 开页只拿一次画布清单（开发模式下 React 会把开页逻辑跑两遍，防止一下建出两张「画布 1」）。一张都没有就建一张。 */
let firstList: Promise<CanvasSummary[]> | null = null;
function loadFirstList(): Promise<CanvasSummary[]> {
  firstList ??= (async () => {
    const list = await api.listCanvases();
    return list.length ? list : [summaryOf(await api.createCanvas("画布 1"))];
  })().catch((err: unknown) => {
    firstList = null;
    throw err;
  });
  return firstList;
}

export function App() {
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CanvasSummary | null>(null);
  const [worksOpen, setWorksOpen] = useState(false);
  const [viewer, setViewer] = useState<{ url: string; title: string; media?: "image" | "video" | "audio" } | null>(null);
  const [toast, notify, closeToast] = useToast();

  useEffect(() => {
    let alive = true;
    loadFirstList().then(
      (list) => {
        if (!alive) return;
        setCanvases(list);
        setCurrentId(list[0]?.id ?? null);
      },
      (err: Error) => {
        if (alive) setLoadError(err.message);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  const current = canvases.find((c) => c.id === currentId) ?? null;

  const createCanvas = useCallback(async () => {
    try {
      const doc = await api.createCanvas(`画布 ${canvases.length + 1}`);
      setCanvases((list) => [summaryOf(doc), ...list]);
      setCurrentId(doc.id);
    } catch (err) {
      notify((err as Error).message);
    }
  }, [canvases.length, notify]);

  /** 改名只改页面里的名字；画布那边的自动保存会把新名字一起存上。 */
  const renameCanvas = useCallback((id: string, raw: string) => {
    const name = raw.trim().slice(0, 40);
    if (name) setCanvases((list) => list.map((c) => (c.id === id ? { ...c, name } : c)));
  }, []);

  const deleteCanvas = useCallback(
    async (id: string) => {
      setDeleting(null);
      try {
        const rest = canvases.filter((c) => c.id !== id);
        if (!rest.length) rest.push(summaryOf(await api.createCanvas("画布 1")));
        // 先换到别的画布（换走时会顺手存一下这张），再删；存的请求晚到也没事，小服务不会把删掉的画布建回来。
        setCanvases(rest);
        setCurrentId(rest[0].id);
        await api.deleteCanvas(id);
      } catch (err) {
        notify((err as Error).message);
      }
    },
    [canvases, notify]
  );

  const openViewer = useCallback((url: string, title: string, media?: "image" | "video" | "audio") => setViewer({ url, title, media }), []);
  const closeViewer = useCallback(() => setViewer(null), []);

  return (
    <div className="app">
      {worksOpen && current ? (
        <WorksSidebar canvasId={current.id} onClose={() => setWorksOpen(false)} openViewer={openViewer} notify={notify} />
      ) : null}
      <main className="stage">
        {current ? (
          <CanvasBoard
            key={current.id}
            canvas={current}
            canvases={canvases}
            onSwitch={setCurrentId}
            onCreate={() => void createCanvas()}
            onRename={renameCanvas}
            onDelete={(id) => setDeleting(canvases.find((c) => c.id === id) ?? null)}
            worksOpen={worksOpen}
            onToggleWorks={() => setWorksOpen((open) => !open)}
            openViewer={openViewer}
            notify={notify}
          />
        ) : (
          <div className="stage__message">{loadError ? `打不开画布：${loadError}` : "正在打开画布…"}</div>
        )}
        <SettingsButton />
      </main>
      <Toast toast={toast} onClose={closeToast} />
      {viewer ? <ImageViewer url={viewer.url} title={viewer.title} media={viewer.media} onClose={closeViewer} /> : null}
      {deleting ? (
        <Confirm
          text={`删掉「${deleting.name}」？上面的卡片会一起删掉，作品库里的图不受影响。`}
          okLabel="删除"
          onOk={() => void deleteCanvas(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
