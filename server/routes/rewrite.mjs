import { agentNeeded } from '../agent.mjs';
import { HttpError, readJson, sendJson } from '../http.mjs';
import { checkRewriteInput, redactRewriteError } from '../rewrite.mjs';

export function rewriteRoutes(router, { readEnv, fake, rewrite, spend, needAgent = agentNeeded }) {
  router.add('POST', '/api/rewrite', async ({ req, res }) => {
    const env = readEnv();
    const problem = fake ? null : needAgent(env);
    if (problem) throw new HttpError(400, problem);
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
