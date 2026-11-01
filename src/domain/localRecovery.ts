import type { CardNode, LocalJobView } from '@/types';
import { settleDepth } from './localMedia';
export const LOCAL_RECOVERY_UNAVAILABLE = '暂时查不到本机任务记录，请刷新页面重试';

/** 只恢复读档时丢了交单回包的卡，不重新发单，也不碰已有结果或正在正常轮询的卡。 */
export function localRecoveryIds(nodes: readonly CardNode[]): string[] {
  return nodes.filter(({ data }) => ['depth', 'mesh'].includes(data.source) && data.startedAt && !data.depthJobId && !data.results.length
    && (!data.note || data.note === LOCAL_RECOVERY_UNAVAILABLE)).map(node => node.id);
}
export function restoreLocalJobs(nodes: CardNode[], jobs: readonly LocalJobView[] | null): CardNode[] {
  const pending = new Set(localRecoveryIds(nodes));
  return nodes.map(node => {
    if (!pending.has(node.id)) return node;
    if (jobs === null) return { ...node, data: { ...node.data, note: LOCAL_RECOVERY_UNAVAILABLE } };
    const job = jobs.find(job => job.cardId === node.id && job.kind === node.data.source);
    if (job) return { ...node, data: settleDepth({ ...node.data, depthJobId: job.id, note: null }, job) };
    const { startedAt: _started, depthJobId: _job, ...data } = node.data;
    return { ...node, data: { ...data, note: '上次没做完，可以再点一次' } };
  });
}

/** 查询上限与服务端一致；每批独立区分“确实没记录”和“暂时查不到”，不阻断有效画布。 */
export async function recoverLocalJobs(canvasId: string, nodes: CardNode[],
  find: (canvasId: string, cardIds: string[]) => Promise<LocalJobView[]>): Promise<CardNode[]> {
  const ids = localRecoveryIds(nodes);
  let restored = nodes;
  for (let start = 0; start < ids.length; start += 200) {
    const batch = ids.slice(start, start + 200), wanted = new Set(batch);
    let jobs: LocalJobView[] | null;
    try { jobs = await find(canvasId, batch); }
    catch { jobs = null; }
    const replacements = new Map(restoreLocalJobs(nodes.filter(node => wanted.has(node.id)), jobs).map(node => [node.id, node]));
    restored = restored.map(node => replacements.get(node.id) ?? node);
  }
  return restored;
}
