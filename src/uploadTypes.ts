import type { MediaWorkView } from "@/types";

/** 「我上传的」清单里的一条（小服务 GET /api/uploads/list）。只有从电脑传的图片和视频。 */
export type UploadView = {
  id: string;
  kind: "image" | "video";
  /** 原文件名。 */
  name: string;
  bytes?: number;
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  fps?: number | null;
  createdAt: string;
  /** 最近一次上传（同一份内容再传会更新）。 */
  uploadedAt: string;
  /** 正在用它的画布编号。 */
  canvases: string[];
};

export type UploadList = { items: UploadView[]; bytes: number };

/** 「从作品库选」弹窗选中的：一件作品，或「我上传的」里的一个素材。 */
export type PickedMedia = { source: "work"; work: MediaWorkView } | { source: "upload"; upload: UploadView };
