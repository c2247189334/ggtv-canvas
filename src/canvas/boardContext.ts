import { createContext, useContext } from "react";
import type { CardPatch } from "@/types";
import type { Notify } from "@/common/Toast";
import type { useVideoRewrite } from './useVideoRewrite';
import type { useVideoClip } from './useVideoClip';

/** 卡片要用到的画布能力。卡片由画布库渲染，拿不到画布的 props，只能走 context。 */
export type BoardApi = {
  videoRewrite?: ReturnType<typeof useVideoRewrite>;
  videoClip?: ReturnType<typeof useVideoClip>;
  openViewer: (url: string, title: string, media?: "image" | "video" | "audio") => void;
  notify: Notify;
  localMedia: (id: string, action: "depth" | "mesh" | "audio", resolution?: "480p" | "720p") => Promise<void>;
  /** 停掉这些卡还在算的深度 / 白模。 */
  stopLocal: (cardIds: string[]) => Promise<void>;
  turnPage: (id: string, delta: number) => void;
  updateCard: (id: string, patch: CardPatch) => void;
  disconnect: (source: string, target: string) => void;
  /** 面板「＋参考」：从当前画布连续选择参考。 */
  startRefPick: (id: string) => void;
  /** 左边 ＋：添加上下文图片或资源。 */
  openRefMenu: (id: string, anchor: DOMRect) => void;
  /** 右边 ＋：弹「引用该节点生成」图片 / 视频。 */
  openNextMenu: (id: string, anchor: DOMRect) => void;
  /** 点「发送」。出错抛人话。 */
  send: (id: string) => Promise<void>;
};

export const BoardContext = createContext<BoardApi | null>(null);

export function useBoard(): BoardApi {
  const api = useContext(BoardContext);
  if (!api) throw new Error("卡片必须放在画布里面用。");
  return api;
}
