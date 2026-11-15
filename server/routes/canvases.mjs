// 画布接口：清单、新建、读、整份存、删。
import { HttpError, readJson, sendJson } from '../http.mjs';
import { CanvasConflict } from '../store/canvases.mjs';

/** 一张画布的存档最多多大。卡片几百张也就几百 KB，给足余量。 */
const MAX_CANVAS_BYTES = 20 * 1024 * 1024;

/** 存档里出现的单号算「画布记下了」，之后不再当丢单找回（见 routes/jobs.mjs 的 /api/orphan-jobs）。标不上不影响存画布，下次存再标。 */
function claimJobs(jobs, doc) {
  for (const node of doc.nodes) for (const id of Array.isArray(node?.data?.jobs) ? node.data.jobs : []) {
    try { if (jobs.read(id)?.claimed === false) jobs.patch(id, { claimed: true }); }
    catch { /* 硬盘一时写不进，下次存再标 */ }
  }
}

export function canvasRoutes(router, { canvases, jobs, depthQueue }) {
  router.add('GET', '/api/canvases', async ({ res }) => sendJson(res, 200, canvases.list()));

  router.add('POST', '/api/canvases', async ({ req, res }) => {
    const body = await readJson(req);
    sendJson(res, 200, canvases.create(body?.name));
  });

  router.add('GET', '/api/canvas', async ({ res, query }) => {
    const doc = canvases.read(query.get('id'));
    if (!doc) throw new HttpError(404, '这张画布找不到了。');
    sendJson(res, 200, doc);
  });

  router.add('PUT', '/api/canvas', async ({ req, res, query }) => {
    let doc;
    try { doc = canvases.save(query.get('id'), await readJson(req, MAX_CANVAS_BYTES)); }
    catch (error) { if (error instanceof CanvasConflict) throw new HttpError(409, error.message); throw error; }
    if (!doc) throw new HttpError(404, '这张画布已经被删了，没存。');
    if (jobs) claimJobs(jobs, doc);
    sendJson(res, 200, { ok: true, updatedAt: doc.updatedAt, version: doc.version });
  });

  router.add('DELETE', '/api/canvas', async ({ res, query }) => {
    if (!canvases.remove(query.get('id'))) throw new HttpError(404, '这张画布找不到了。');
    depthQueue?.cancelCanvas(query.get('id'));
    sendJson(res, 200, { ok: true });
  });
}
