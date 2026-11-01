import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/api";
import { WorksGrid } from "@/library/WorksGrid";
import { useEscapeLayer } from "@/common/useEscapeLayer";
import type { MediaWorkView } from "@/types";

/** 「从作品库选」弹窗：点一张就选中它；取消、Esc、点外面都返回 null。 */
export function WorksPicker({ onPick, includeVideo = true }: { onPick: (work: MediaWorkView | null) => void; includeVideo?: boolean }) {
  const [works, setWorks] = useState<MediaWorkView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.listMediaWorks().then(
      (list) => {
        if (alive) setWorks(list);
      },
      (err: Error) => {
        if (alive) setError(err.message);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  useEscapeLayer(() => onPick(null), true, 1150);

  return createPortal(
    <div className="picker" onMouseDown={(event) => { if (event.target === event.currentTarget) onPick(null); }}>
      <div className="picker__box" role="dialog" aria-label="从作品库选">
        <header className="picker__head">
          <strong>从作品库选{includeVideo ? "作品" : "图片"}</strong>
          <button type="button" onClick={() => onPick(null)}>取消</button>
        </header>
        {error ? <p className="works__error">{error}</p> : works === null ? <p className="works__empty">读取中…</p> : <WorksGrid works={includeVideo ? works : works.filter(work => work.kind === "image")} onOpen={onPick} />}
      </div>
    </div>,
    document.body
  );
}
