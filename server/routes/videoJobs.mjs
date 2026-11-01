// 视频交单：只在本地检查通过后入队，拒绝时不会调用火山。
import { keyFilled, tosFilled } from '../config.mjs';
import { HttpError, readJson, sendJson } from '../http.mjs';
import { checkVideoJobInput } from '../videoJobInput.mjs';

export function videoJobRoutes(router, { videoQueue, uploads, works, readEnv, fake }) {
  router.add('POST', '/api/video-jobs', async ({ req, res }) => {
    const env = readEnv();
    if (!fake && !keyFilled(env)) {
      throw new HttpError(400, '.env.local 里还没填 ARK_API_KEY，填好再发（这单没发出去，没花钱）。');
    }
    const checked = checkVideoJobInput(await readJson(req), ref => {
      const store = ref.type === 'upload' ? uploads : works;
      return store.metadata(ref.id);
    });
    if (!checked.ok) throw new HttpError(400, checked.reason);
    if (!fake && checked.job.refs.some(ref => ref.kind === 'video') && !tosFilled(env)) {
      throw new HttpError(400, '.env.local 里没填完整 TOS_ACCESS_KEY_ID、TOS_SECRET_ACCESS_KEY、TOS_BUCKET（存参考视频要用），这单没发出去，没花钱。');
    }
    sendJson(res, 200, { id: videoQueue.submit(checked.job).id });
  });
}
