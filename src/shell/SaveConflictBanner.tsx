import { useSyncExternalStore } from "react";
import { hasSaveConflict, subscribeSaveConflicts } from "@/domain/saveConflicts";

const reloadPage = () => window.location.reload();

/** 这张画布存档冲突后一直挂在顶上的提醒，不自动消失：这一页已经不保存了，用户得知道，刷新才恢复。 */
export function SaveConflictBanner({ canvasId, onReload = reloadPage }: { canvasId: string; onReload?: () => void }) {
  const conflicted = useSyncExternalStore(subscribeSaveConflicts, () => hasSaveConflict(canvasId), () => hasSaveConflict(canvasId));
  if (!conflicted) return null;
  return (
    <div className="save-conflict" role="alert">
      <span>这张画布在别的页面改过了，这一页之后的改动都不会保存。刷新后再继续。</span>
      <button type="button" onClick={onReload}>刷新页面</button>
    </div>
  );
}
