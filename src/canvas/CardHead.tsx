import type { ReactNode } from "react";
import { useStore } from "@xyflow/react";
import { staleNote } from "@/domain/staleInputs";
import type { CardNode } from "@/types";

type Size = { width: number; height: number } | null | undefined;

/**
 * 图片 / 视频卡的标题行（11-08 用户定）：左边标题（长了省略，悬停看全名），
 * 右边分辨率；生成卡出结果后上游或提示词变了，再亮「输入已更新」，悬停看变了什么。
 */
export function CardHead({ id, title, size, children }: { id: string; title: string; size?: Size; children?: ReactNode }) {
  const stale = useStore(state => staleNote(state.nodes as CardNode[], state.edges ?? [], id));
  return <div className="card__head">
    <div className="card__title" title={title}>{title}{children}</div>
    {size ? <span className="card__size">{size.width} × {size.height}</span> : null}
    {stale ? <span className="card__stale" title={`上次生成后：${stale}`}>输入已更新</span> : null}
  </div>;
}
