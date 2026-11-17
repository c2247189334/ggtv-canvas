// 图层分离交单（11-16 用户定，设计见 docs/specs/2026-11-16-图层分离换标-design.md）。查进度走 GET /api/jobs（jobView 带 layers）。
import { keyFilled, keyMissingText } from '../config.mjs';
import { HttpError, readJson, sendJson } from '../http.mjs';
import { checkLayerInput, checkRedrawInput } from '../layerInput.mjs';

export function layerJobRoutes(router, { uploads, works, layerQueue, readEnv, fake }) {
  router.add('POST', '/api/layer-jobs', async ({ req, res }) => {
    if (!fake && !keyFilled(readEnv())) throw new HttpError(400, keyMissingText());
    const body = await readJson(req);
    const checked = checkLayerInput(body, ref => ref.type === 'upload' ? uploads.read(ref.id) : works.read(ref.id));
    if (!checked.ok) throw new HttpError(400, checked.reason);
    sendJson(res, 200, { id: layerQueue.submit(checked.job).id });
  });

  // 图层重绘：只认作品里带图层标记的透明 PNG（layer 标记在作品记录里，从作品清单取）。
  router.add('POST', '/api/layer-redraws', async ({ req, res }) => {
    if (!fake && !keyFilled(readEnv())) throw new HttpError(400, keyMissingText());
    const body = await readJson(req);
    const checked = checkRedrawInput(body, id => {
      const image = works.read(id);
      return image ? { ...image, layer: works.list().find(work => work.id === id)?.layer } : null;
    });
    if (!checked.ok) throw new HttpError(400, checked.reason);
    sendJson(res, 200, { id: layerQueue.submit(checked.job, 'layer-redraw').id });
  });
}
