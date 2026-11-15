import { join } from 'node:path';
import { agentHealth, agentNeeded, createAgentCall } from '../agent.mjs';
import { videoRewriteRoot } from '../config.mjs';
import { HttpError, sendJson } from '../http.mjs';
import { redactRewriteError } from '../rewrite.mjs';
import { createClaudeAsk } from './claudeAsk.mjs';
import { fakeRound } from './fake.mjs';
import { fakeLook } from './lookPeople.mjs';

/** 两条工作流共用：本机 agent 检查、记账与同卡锁，重入不能清理另一请求的目录。拆解、看图、定稿都只走本机 agent（11-15 用户定，不再用豆包）。 */
export function createRewriteSession({ dataRoot, fake, fakeDelayMs = 0, spend, claude }) {
  const busy = new Set();
  const agentCall = env => claude ?? createAgentCall({ env, tmpRoot: join(videoRewriteRoot(dataRoot), 'claude') });
  const ensureIdle = cardId => { if (busy.has(cardId)) throw new HttpError(409, '这条视频正在改写，做完再来。'); };
  const ensureAgent = env => {
    const problem = fake ? null : agentNeeded(env);
    if (problem) throw new HttpError(400, problem);
  };
  const defaultFake = input => input.round === 'look' ? fakeLook(input) : fakeRound(input, { delayMs: fakeDelayMs });
  async function paid(res, cardId, env, action, fakeAsk = defaultFake) {
    ensureIdle(cardId); busy.add(cardId);
    const agent = fake ? null : agentHealth(env);
    let yuan = 0, model = agent ? agent.agentModel : 'fake';
    const usage = { input_tokens: 0, output_tokens: 0 };
    const onCharge = row => {
      spend.add({ ...row, jobId: cardId });
      model = row.model; yuan += row.yuan;
      usage.input_tokens += row.usage?.input_tokens ?? 0; usage.output_tokens += row.usage?.output_tokens ?? 0;
    };
    const ask = fake ? fakeAsk : createClaudeAsk({ call: agentCall(env), model: agent.agentModel, name: agent.agentName, onCharge });
    try { sendJson(res, 200, { ...await action(ask), model, yuan, usage }); }
    catch (error) {
      sendJson(res, error instanceof HttpError ? error.status : 502,
        { error: redactRewriteError(error?.message ?? error, env), model, yuan, usage });
    } finally { busy.delete(cardId); }
  }
  return { busy, agentCall, ensureIdle, ensureAgent, paid };
}
