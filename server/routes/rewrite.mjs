import { keyFilled } from '../config.mjs';
import { HttpError, readJson, sendJson } from '../http.mjs';
import { checkRewriteInput, redactRewriteError } from '../rewrite.mjs';

export function rewriteRoutes(router, { readEnv, fake, rewrite, spend }) {
  router.add('POST', '/api/rewrite', async ({ req, res }) => {
    const env = readEnv();
    if (!fake && !keyFilled(env)) throw new HttpError(400, '.env.local 里还没填 ARK_API_KEY，填好再改写（这次没发出去，没花钱）。');
    const body = await readJson(req);
    let input;
    try { input = checkRewriteInput(body); }
    catch (error) { throw new HttpError(400, error.message); }
    let result;
    try { result = await rewrite(input); }
    catch (error) { throw new HttpError(502, redactRewriteError(error?.message ?? error, env)); }
    spend.add({ yuan: result.yuan, model: result.model });
    sendJson(res, 200, result);
  });
}
