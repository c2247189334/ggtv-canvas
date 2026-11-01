import { useState } from "react";
import { useBoard } from "./boardContext";
import type { BoardApi } from "./boardContext";
import { pickFiles } from "@/common/pickFiles";
import { IMAGE_ACCEPT, readWorkDrag } from "@/domain/media";
import { rewriteDropPlan, rewriteDropTarget, rewriteImagePatch, type DropPayload } from '@/domain/rewriteDrop';
import { uploadMedia } from "./uploadMedia";
import type { AssetRef, CardNode, ImageCardData } from "@/types";
import type { Point } from '@/domain/placement';

type DropBoard = Pick<BoardApi, 'updateCard' | 'notify'> & {
  addAssets: (source: 'work', refs: AssetRef[], at: Point) => unknown;
  dropFiles: (files: File[], at: Point) => Promise<unknown>;
};

async function uploadFirstImage(files: File[], notify: BoardApi['notify']) {
  const uploaded = (await uploadMedia(files.slice(0, 1), false, notify))[0];
  if (!uploaded) return null;
  const { fileName: _name, ...asset } = uploaded;
  return asset;
}

/** 拖入与按钮共用补图补丁，保留提示词/连线和现有撤销规则。 */
export async function handleCanvasDrop(nodes: readonly CardNode[], id: string | null, payload: DropPayload, at: Point, board: DropBoard,
  getNodes = () => nodes) {
  const plan = rewriteDropPlan(nodes, id, payload);
  if (plan.kind === 'reject') { board.notify(plan.message); return; }
  if (plan.kind === 'new') {
    if (payload.work) {
      const asset = readWorkDrag(payload.work);
      if (asset) board.addAssets('work', [asset], at);
    } else if (payload.files.length) await board.dropFiles(payload.files, at);
    return;
  }
  const asset = plan.kind === 'work' ? plan.asset : await uploadFirstImage([plan.file], board.notify);
  if (!asset) return;
  const target = rewriteDropTarget(getNodes(), plan.id);
  if (!target) return;
  if (target.data.jobs.length) { board.notify('这张卡正在生成，请等生成结束后再放图片。'); return; }
  board.updateCard(plan.id, rewriteImagePatch(target.data, asset));
}

export async function uploadRewriteImage(id: string, data: ImageCardData, board: Pick<BoardApi, "updateCard" | "notify">) {
  const files = await pickFiles(IMAGE_ACCEPT);
  const asset = await uploadFirstImage(files, board.notify);
  if (asset) board.updateCard(id, rewriteImagePatch(data, asset));
}
export function RewriteImageUpload({ id, data }: { id: string; data: ImageCardData }) {
  const board = useBoard();
  const [uploading, setUploading] = useState(false);
  if (!data.rewriteId) return null;
  return <button type="button" disabled={uploading || data.jobs.length > 0} onClick={async () => {
    if (uploading) return;
    setUploading(true);
    try { await uploadRewriteImage(id, data, board); }
    catch (error) { board.notify((error as Error).message); }
    finally { setUploading(false); }
  }}>{uploading ? "上传中…" : "上传这项图片"}</button>;
}
