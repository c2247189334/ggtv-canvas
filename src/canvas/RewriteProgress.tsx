import { formatSpent } from '@/domain/pricing';
import type { VideoCardData } from '@/types';

/** 原视频卡下方的一行改写状态：放在卡片外面，不盖住画面、不影响拖卡。跑的时候只转圈、不写已用时间（用户 10-25 定）。 */
export function RewriteProgress({ data, overlay = false }: { data: VideoCardData; overlay?: boolean }) {
  const status = data.rewriteStatus;
  if (data.rewriteBusy) return <div className={overlay ? 'card__busy' : 'card__rewrite-status'}>
    <span className="busy-label"><span className="busy-spinner" aria-hidden="true" />正在拆解…</span></div>;
  if (status?.status === 'failed') return <div className="card__rewrite-status card__rewrite-status--failed">{status.error}
    <div>已花 {formatSpent(status.yuan)}{status.costUnknown ? '；另有费用待确认' : ''}</div></div>;
  if (status) return <div className="card__rewrite-status">上次没做完，再点一次「视频改写」重来</div>;
  return null;
}
