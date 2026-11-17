import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/api";
import { WorksGrid } from "@/library/WorksGrid";
import { UploadsGrid } from "@/library/UploadsGrid";
import { useEscapeLayer } from "@/common/useEscapeLayer";
import type { MediaWorkView } from "@/types";
import type { PickedMedia, UploadView } from "@/uploadTypes";

type Tab = "works" | "uploads";

/** 「从作品库选」弹窗：作品 / 我上传的 两栏，点一个就选中它；取消、Esc、点外面都返回 null。 */
export function WorksPicker({ onPick, includeVideo = true }: { onPick: (picked: PickedMedia | null) => void; includeVideo?: boolean }) {
  const [tab, setTab] = useState<Tab>("works");
  const [works, setWorks] = useState<MediaWorkView[] | null>(null);
  const [uploads, setUploads] = useState<UploadView[] | null>(null);
  const [error, setError] = useState<{ tab: Tab; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api.listMediaWorks().then(list => { if (alive) setWorks(list); }, (err: Error) => { if (alive) setError({ tab: "works", text: err.message }); });
    api.listUploads().then(list => { if (alive) setUploads(list.items); }, (err: Error) => { if (alive) setError({ tab: "uploads", text: err.message }); });
    return () => {
      alive = false;
    };
  }, []);

  useEscapeLayer(() => onPick(null), true, 1150);

  const shown = tab === "works" ? works : uploads;
  return createPortal(
    <div className="picker" onMouseDown={(event) => { if (event.target === event.currentTarget) onPick(null); }}>
      <div className="picker__box" role="dialog" aria-modal="true" aria-label="从作品库选">
        <header className="picker__head">
          <strong>从作品库选{includeVideo ? "作品" : "图片"}</strong>
          <button type="button" onClick={() => onPick(null)}>取消</button>
        </header>
        <div className="works__filters">
          <button type="button" className={tab === "works" ? "is-on" : ""} onClick={() => setTab("works")}>作品</button>
          <button type="button" className={tab === "uploads" ? "is-on" : ""} onClick={() => setTab("uploads")}>我上传的</button>
        </div>
        {error?.tab === tab ? <p className="works__error">{error.text}</p> : shown === null ? <p className="works__empty">读取中…</p>
          : tab === "works" ? <WorksGrid works={(works ?? []).filter(work => !("layer" in work && work.layer) && (includeVideo || work.kind === "image"))} onOpen={work => onPick({ source: "work", work })} />
          : <UploadsGrid items={(uploads ?? []).filter(upload => includeVideo || upload.kind === "image")} onOpen={upload => onPick({ source: "upload", upload })} />}
      </div>
    </div>,
    document.body
  );
}
