import { durationLabel } from "@/domain/videoPanel";
import type { RefMedia } from "@/domain/mention";

type Reference = { sourceId: string; number: number; url: string | null; title: string; media?: RefMedia; seconds?: number };
const LABEL = { image: "图片", video: "视频", audio: "音频" };

export function MentionMenu({ refs, grouped = false, onSelect }: { refs: Reference[]; grouped?: boolean; onSelect: (number: number, media?: RefMedia) => void }) {
  const item = (ref: Reference) => (
    <button key={ref.sourceId} type="button" className="mention-menu__item" onClick={() => onSelect(ref.number, ref.media)}>
      {ref.media === "audio" ? <span className="mention-menu__audio">♪</span> : ref.url ? ref.media === "video" ? <video src={ref.url} preload="metadata" muted playsInline /> : <img src={ref.url} alt={ref.title} draggable={false} />
        : <span className="mention-menu__empty">{ref.media === "video" ? "还没视频" : "还没图"}</span>}
      <span>{LABEL[ref.media ?? "image"]}{ref.number}</span>
      {ref.media === "video" || ref.media === "audio" ? <span>{ref.media === "audio" ? "♪" : "▶"} {durationLabel(ref.seconds)}</span> : null}
    </button>
  );
  return (
    <div className="mention-menu">
      <h3>素材引用</h3>
      {refs.length ? grouped ? (["image", "video", "audio"] as const).map(media => {
        const group = refs.filter(ref => (ref.media ?? "image") === media);
        return group.length ? <section key={media}><h3>{LABEL[media]}</h3>{group.map(item)}</section> : null;
      }) : refs.map(item) : <p>暂无可引用资产，请连入后操作</p>}
    </div>
  );
}
