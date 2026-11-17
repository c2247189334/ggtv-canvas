// 视频交单：只在本地检查通过后入队，拒绝时不会调用火山。
import { keyFilled, keyMissingText, tosFilled, tosMissingText } from '../config.mjs';
import { HttpError, readJson, sendJson } from '../http.mjs';
import { checkVideoJobInput } from '../videoJobInput.mjs';

export function videoJobRoutes(router, { videoQueue, uploads, works, readEnv, fake }) {
  router.add('POST', '/api/video-jobs', async ({ req, res }) => {
    const env = readEnv();
    if (!fake && !keyFilled(env)) {
      throw new HttpError(400, keyMissingText());
    }
    const checked = checkVideoJobInput(await readJson(req), ref => {
      const store = ref.type === 'upload' ? uploads : works;
      return store.metadata(ref.id);
    });
    if (!checked.ok) throw new HttpError(400, checked.reason);
    if (!fake && checked.job.refs.some(ref => ref.kind === 'video') && !tosFilled(env)) {
      throw new HttpError(400, tosMissingText());
    }
    // claimed：画布存档里还没记下这个单号（见 routes/jobs.mjs 的 /api/orphan-jobs）。
    sendJson(res, 200, { id: videoQueue.submit({ ...checked.job, claimed: false }).id });
  });
}
