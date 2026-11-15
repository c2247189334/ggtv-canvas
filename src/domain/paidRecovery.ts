import type { CardNode, OrphanJob } from '@/types';

// 11-15 找回丢的付费单：小服务接了单、页面没收到单号（回话丢了 / 正好切走画布），卡片上没记，再点一次会重复花钱。
// 小服务按画布 + 卡片回「还没被画布记下」的图片单、视频单；这里只把单号接回卡片，之后照常轮询收结果，不重新交单。
export const LOST_REPLY = '这单其实已经交上去了（刚才回话没收到），已接回卡片，结果会照常显示在卡上，不用再点发送。';
type Find = (canvasId: string, cardIds: string[]) => Promise<OrphanJob[]>;

/** 小服务明确拒单（4xx）时这单根本没建，不用找丢单；去找反而可能把别的标签页刚交的单错接过来、吞掉真实报错。 */
export function serverRejected(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/** 一次设了好几条、中途回话丢了：后面的没发，要说清，别说「不用再点」。 */
export function lostReplyMessage(total: number, submitted: number): string {
  const left = total - submitted;
  return left > 0
    ? `这一条其实已经交上去了（刚才回话没收到），已接回卡片。这次设了 ${total} 条，交上 ${submitted} 条，后面 ${left} 条没发；还要的话把数量改成 ${left} 再点发送。`
    : LOST_REPLY;
}

/** 能交付费单的卡：图片 / 视频生成卡。 */
export function paidCardIds(nodes: readonly CardNode[]): string[] {
  return nodes.filter(({ data }) => data.kind !== 'audio' && data.source === 'generate').map(node => node.id);
}

/** 种类对得上、卡上还没有的单号才加；别的卡原样返回。 */
export function attachOrphanJobs(nodes: CardNode[], orphans: readonly OrphanJob[]): CardNode[] {
  return nodes.map(node => {
    const { data } = node;
    if (data.kind === 'audio' || data.source !== 'generate') return node;
    const ids = orphans.filter(job => job.cardId === node.id && job.kind === data.kind && !data.jobs.includes(job.id)).map(job => job.id);
    return ids.length ? { ...node, data: { ...data, jobs: [...data.jobs, ...ids] } } : node;
  });
}

/** 打开画布时查一次（一批最多 200 张卡，和小服务一致）。查不到不拦画布，下次打开再查。 */
export async function recoverPaidJobs(canvasId: string, nodes: CardNode[], find: Find): Promise<CardNode[]> {
  const ids = paidCardIds(nodes);
  let restored = nodes;
  for (let start = 0; start < ids.length; start += 200) {
    try { restored = attachOrphanJobs(restored, await find(canvasId, ids.slice(start, start + 200))); }
    catch { /* 小服务暂时查不到 */ }
  }
  return restored;
}

/** 交单报错后查一次这张卡：known 是页面已经记下的单号。查不到当没有（照旧报原来的错）。 */
export async function findLostJobs(canvasId: string, cardId: string, known: readonly string[], find: Find): Promise<OrphanJob[]> {
  try { return (await find(canvasId, [cardId])).filter(job => !known.includes(job.id)); }
  catch { return []; }
}
