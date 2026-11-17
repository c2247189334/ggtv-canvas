// 出图接口：交单、查进度；还有设置面板用的 health（Key 填没填、今天花了多少）。
import { agentHealth, agentSettings } from '../agent.mjs';
import { depthHealth, keyFilled, keyMissingText, meshHealth, tosFilled } from '../config.mjs';
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
    ...(job.kind === 'layers' ? { layers: job.layers ?? null, errorCode: job.errorCode ?? null, source: job.origin ?? job.source } : {}),
    ...(job.kind === 'layer-redraw' ? { redraw: job.redraw ?? null, errorCode: job.errorCode ?? null } : {}),
    ...(workMeta ? { workMeta } : {}), ...(['depth', 'mesh'].includes(job.kind) ? { errorCode: job.errorCode,
      source: job.source, resolution: job.resolution } : {}) };
}

const FINISHED = new Set(['succeeded', 'failed', 'uncertain']);
const missing = (id) => ({ id, kind: 'image', status: 'missing', phase: null, blocked: [], createdAt: '', count: 0, works: [], error: '这单的记录找不到了。' });

export function jobRoutes(router, { jobs, queue, uploads, works, spend, readEnv, fake }) {
  router.add('POST', '/api/jobs', async ({ req, res }) => {
    if (!fake && !keyFilled(readEnv())) {
      throw new HttpError(400, keyMissingText());
    }
    const body = await readJson(req);
    const checked = checkJobInput(body, (ref) => ref.type === 'upload' ? uploads.metadata(ref.id) : works.metadata(ref.id));
    if (!checked.ok) throw new HttpError(400, checked.reason);
    sendJson(res, 200, { id: queue.submit({ ...checked.job, claimed: false }).id });
  });

  // 11-15 找回丢单：小服务接了单、页面没收到单号（回话丢了 / 正好切走画布），卡片上没记，再点一次会重复花钱。
  // 交单时标 claimed: false；画布存档里出现这个单号（routes/canvases.mjs），或页面查到它的终态（上面 GET /api/jobs），才改成 true。
  // 这里只回还没记下的图片单、视频单。
  // 老单子没有这个标记，不算。
  router.add('GET', '/api/orphan-jobs', async ({ res, query }) => {
    const canvasId = query.get('canvasId');
    const cardIds = String(query.get('cardIds') ?? '').split(',').filter(Boolean).slice(0, 200);
    if (!isId(canvasId) || cardIds.some(id => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new HttpError(400, '画布或卡片编号不对。');
    const wanted = new Set(cardIds);
    sendJson(res, 200, jobs.list().filter(job => job.claimed === false && job.canvasId === canvasId && wanted.has(job.cardId)
      && ['image', 'video'].includes(job.kind ?? 'image')).map(job => ({ id: job.id, cardId: job.cardId, kind: job.kind ?? 'image' })));
  });

  router.add('GET', '/api/jobs', async ({ res, query }) => {
    const ids = String(query.get('ids') ?? '').split(',').filter(Boolean).slice(0, 200);
    sendJson(res, 200, ids.map((id) => {
      const job = jobs.read(id);
      if (!job) return missing(id);
      // 页面只查自己卡片上的单号：查到终态就是结果交到卡片了，算画布记下了（跑完的单号收走后不会再进存档）。标不上下次查再标。
      if (job.claimed === false && FINISHED.has(job.status)) { try { jobs.patch(id, { claimed: true }); } catch { /* 硬盘一时写不进 */ } }
      return jobView(job, works);
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
    const env = readEnv(), local = agentHealth(env);
    // 本机 agent（拆解 / 看图 / 定稿提示词）用谁、好没好见 agent.mjs；假模式按就绪，页面按钮走假结果。
    sendJson(res, 200, { ok: true, fake, keyReady: keyFilled(env), tosReady: tosFilled(env), ...depthHealth(env), ...await meshHealth(env, { fake }),
      ...local, ...agentSettings(env), agentReady: fake || local.agentReady, agentProblem: fake ? null : local.agentProblem, todayYuan: spend.totalOn(new Date()), uncertainToday });
  });
}
