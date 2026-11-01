import { HttpError, readJson, sendJson } from '../http.mjs';
import { isId } from '../store/files.mjs';
import { depthGeometry, frameStart } from '../depth/local.mjs';
import { clipRange } from '../depth/videoClip.mjs';

function input(body) {
  if (body?.canvasId !== undefined && !isId(body.canvasId)) throw new HttpError(400, '画布编号不对。');
  if (body?.cardId !== undefined && (typeof body.cardId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.cardId))) throw new HttpError(400, '卡片编号不对。');
  return { source: body?.source ? { type: body.source.type, id: body.source.id } : null,
    ...(body?.canvasId ? { canvasId: body.canvasId } : {}), ...(body?.cardId ? { cardId: body.cardId } : {}) };
}

export function localMediaRoutes(router, { media, depthQueue }) {
  function submit(job) {
    try { return depthQueue.submit(job); }
    catch (error) { throw new HttpError(503, error.message); }
  }
  router.add('POST', '/api/video-clips', async ({ req, res }) => {
    const body = await readJson(req), clean = input(body);
    try { clipRange(media.checkSource(clean.source), body?.start, body?.end); }
    catch (error) { throw new HttpError(400, error.message); }
    try { sendJson(res, 200, await media.clip({ ...clean, start: body.start, end: body.end })); }
    catch (error) { throw new HttpError(500, error.message); }
  });
  router.add('POST', '/api/depth-jobs', async ({ req, res }) => {
    const body = await readJson(req), clean = input(body);
    try {
      const meta = media.checkSource(clean.source, { maxSeconds: 30 });
      depthGeometry(meta, body.resolution);
    } catch (error) { throw new HttpError(400, error.message); }
    sendJson(res, 200, { id: submit({ ...clean, resolution: body.resolution }).id });
  });
  router.add('POST', '/api/mesh-jobs', async ({ req, res }) => {
    const body = await readJson(req), clean = input(body);
    if (body?.resolution !== undefined) throw new HttpError(400, '白模固定为 480P，不接受清晰度参数。');
    try { depthGeometry(media.checkSource(clean.source, { maxSeconds: 30 }), '480p'); }
    catch (error) { throw new HttpError(400, error.message); }
    sendJson(res, 200, { id: submit({ ...clean, kind: 'mesh', resolution: '480p' }).id });
  });
  // 10-31 用户：深度 / 白模生成中要能停（删卡也走这里）；排队的直接撤，在跑的中断后标已停止。
  router.add('POST', '/api/local-jobs/stop', async ({ req, res }) => {
    const body = await readJson(req);
    if (!isId(body?.id)) throw new HttpError(400, '单号不对。');
    const status = depthQueue.cancel(body.id);
    if (!status) throw new HttpError(404, '这单已经结束或找不到，不用停。');
    sendJson(res, 200, { status });
  });
  router.add('POST', '/api/audio-extractions', async ({ req, res }) => {
    const clean = input(await readJson(req));
    try {
      const meta = media.checkSource(clean.source);
      if (!meta.hasAudio) throw Error('这段视频没有声音');
    } catch (error) { throw new HttpError(400, error.message); }
    try { sendJson(res, 200, await media.extract(clean)); }
    catch (error) { throw new HttpError(500, error.message); }
  });
  router.add('POST', '/api/frame-extractions', async ({ req, res }) => {
    const body = await readJson(req), clean = input(body);
    try { frameStart(media.checkSource(clean.source), body?.second); } catch (error) { throw new HttpError(400, error.message); }
    try { sendJson(res, 200, await media.frame({ ...clean, second: body.second })); }
    catch (error) { throw new HttpError(500, error.message); }
  });
}
