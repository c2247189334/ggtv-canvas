// 出图接口：交单、查进度；还有设置面板用的 health（Key 填没填、今天花了多少）。
import { depthHealth, keyFilled, meshHealth, tosFilled } from '../config.mjs';
import { HttpError, readJson, sendJson } from '../http.mjs';
import { checkJobInput } from '../jobInput.mjs';
import { dayKey } from '../store/spend.mjs';
import { isId } from '../store/files.mjs';

/** 页面拿到的单子形状。 */
export function jobView(job, works) {
  const workMeta = ['video', 'depth', 'mesh'].includes(job.kind) ? (job.works ?? []).flatMap(id => {
    const meta = works?.metadata(id);
    return meta?.kind === 'video' ? [{ id, duration: meta.duration, width: meta.width, height: meta.height,
      hasAudio: meta.hasAudio, fps: meta.fps }] : [];
  }) : undefined;
  return { id: job.id, kind: job.kind ?? 'image', status: job.status, phase: job.phase ?? null,
    blocked: job.blocked ?? [], createdAt: job.createdAt, count: job.count ?? 1, works: job.works ?? [], error: job.error ?? null,
    ...(job.kind === 'video' ? { warning: job.warning ?? null } : {}),
    ...(workMeta ? { workMeta } : {}), ...(['depth', 'mesh'].includes(job.kind) ? { errorCode: job.errorCode,
      source: job.source, resolution: job.resolution } : {}) };
}

const missing = (id) => ({ id, kind: 'image', status: 'missing', phase: null, blocked: [], createdAt: '', count: 0, works: [], error: '这单的记录找不到了。' });

export function jobRoutes(router, { jobs, queue, uploads, works, spend, readEnv, fake }) {
  router.add('POST', '/api/jobs', async ({ req, res }) => {
    if (!fake && !keyFilled(readEnv())) {
      throw new HttpError(400, '.env.local 里还没填 ARK_API_KEY，填好再发（这单没发出去，没花钱）。');
    }
    const body = await readJson(req);
    const checked = checkJobInput(body, (ref) => ref.type === 'upload' ? uploads.metadata(ref.id) : works.metadata(ref.id));
    if (!checked.ok) throw new HttpError(400, checked.reason);
    sendJson(res, 200, { id: queue.submit(checked.job).id });
  });

  router.add('GET', '/api/jobs', async ({ res, query }) => {
    const ids = String(query.get('ids') ?? '').split(',').filter(Boolean).slice(0, 200);
    sendJson(res, 200, ids.map((id) => {
      const job = jobs.read(id);
      return job ? jobView(job, works) : missing(id);
    }));
  });

  router.add('GET', '/api/local-jobs', async ({ res, query }) => {
    const canvasId = query.get('canvasId');
    const cardIds = String(query.get('cardIds') ?? '').split(',').filter(Boolean).slice(0, 200);
    if (!isId(canvasId) || cardIds.some(id => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new HttpError(400, '画布或卡片编号不对。');
    const wanted = new Set(cardIds), latest = new Map();
    for (const job of jobs.list()) if (job.canvasId === canvasId && wanted.has(job.cardId) && ['depth', 'mesh'].includes(job.kind)) {
      latest.set(job.cardId, job);
    }
    sendJson(res, 200, [...latest.values()].map(job => ({ ...jobView(job, works), cardId: job.cardId })));
  });

  router.add('GET', '/api/health', async ({ res }) => {
    const today = dayKey(new Date());
    const uncertainToday = jobs.list().filter((job) => job.status === 'uncertain' && dayKey(new Date(job.createdAt)) === today).length;
    const env = readEnv();
    sendJson(res, 200, { ok: true, fake, keyReady: keyFilled(env), tosReady: tosFilled(env), ...depthHealth(env), ...await meshHealth(env, { fake }),
      todayYuan: spend.totalOn(new Date()), uncertainToday });
  });
}
