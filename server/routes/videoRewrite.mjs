import { keyFilled } from '../config.mjs';
import { HttpError, readJson, sendJson } from '../http.mjs';
import { REWRITE_MODEL, redactRewriteError } from '../rewrite.mjs';
import { analyze } from '../videoRewrite/analyze.mjs';
import { createModel, ESTIMATES } from '../videoRewrite/client.mjs';
import { fakeRound } from '../videoRewrite/fake.mjs';
import { fakeLook, lookPeople, personMaterials } from '../videoRewrite/lookPeople.mjs';
import { checkRules, targetDuration } from '../videoRewrite/rules.mjs';
import { sceneRatioNotes, writePrompt } from '../videoRewrite/writePrompt.mjs';
import { checkCardId, checkChangeSeconds, checkDuration, checkMaterials, checkPromptInput, checkUserText, nearestRatio } from '../videoRewrite/input.mjs';
import { removeRewrite, rewriteFolder } from '../videoRewrite/storage.mjs';

const checked = action => { try { return action(); } catch (error) { throw new HttpError(400, error.message); } };

export function videoRewriteRoutes(router, { dataRoot, media, sheets, promptImages, readEnv, fake, fakeDelayMs = 0, spend, fetch, logError }) {
  const busy = new Set();
  const ensureIdle = cardId => { if (busy.has(cardId)) throw new HttpError(409, '这条视频正在改写，做完再来。'); };
  const metadata = meta => ({ duration: meta.duration, targetDuration: targetDuration(meta.duration),
    ratio: nearestRatio(meta.width, meta.height), width: meta.width, height: meta.height, hasAudio: meta.hasAudio });
  const ensureKey = env => {
    if (!fake && !keyFilled(env)) throw new HttpError(400, '.env.local 里还没填 ARK_API_KEY，这次没发出去，没花钱。');
  };
  async function paid(res, cardId, env, action) {
    ensureIdle(cardId); busy.add(cardId);
    let yuan = 0, costUnknown = false;
    const usage = { input_tokens: 0, output_tokens: 0 };
    const ask = fake ? input => input.round === 'look' ? fakeLook(input) : fakeRound(input, { delayMs: fakeDelayMs })
      : createModel({ env, fetch, logError, onUnknown: () => { costUnknown = true; }, onCharge: row => {
      spend.add({ ...row, jobId: cardId });
      yuan += row.yuan; usage.input_tokens += row.usage.input_tokens; usage.output_tokens += row.usage.output_tokens;
    } });
    try {
      const result = await action(ask);
      sendJson(res, 200, { ...result, model: REWRITE_MODEL, yuan, usage, costUnknown });
    } catch (error) {
      sendJson(res, error instanceof HttpError ? error.status : 502,
        { error: redactRewriteError(error?.message ?? error, env), model: REWRITE_MODEL, yuan, usage, costUnknown });
    } finally { busy.delete(cardId); }
  }
  router.add('GET', '/api/video-rewrite/estimates', ({ res }) => sendJson(res, 200, ESTIMATES));
  router.add('POST', '/api/video-rewrite/analyze', async ({ req, res }) => {
    const body = await readJson(req);
    const cardId = checked(() => checkCardId(body?.cardId));
    ensureIdle(cardId);
    try {
      const userText = checked(() => checkUserText(body?.userText));
      const meta = checked(() => media.checkSource(body?.source));
      checked(() => checkDuration(meta.duration));
      const env = readEnv(); ensureKey(env);
      const ratio = nearestRatio(meta.width, meta.height);
      const folder = checked(() => rewriteFolder(dataRoot, cardId, true));
      return await paid(res, cardId, env, async ask => {
        const result = await analyze({ source: meta.path, folder, duration: meta.duration, width: meta.width, height: meta.height, ratio, userText }, { sheets, ask });
        return { plan: result.plan, cuts: result.cuts, cardId, ...metadata(meta) };
      });
    } finally { removeRewrite(dataRoot, cardId); }
  });
  // 提示词由代码按模板拼。10-30 功夫舞真成片后：连了要换的人物图就先看一次图答固定四项（要 Key、花钱、记账），没有就照旧免费马上出。
  router.add('POST', '/api/video-rewrite/prompt', async ({ req, res }) => {
    const body = await readJson(req), input = checked(() => checkPromptInput(body));
    // 背景图比例和视频对不上只进提醒、不拦（10-30 用户定）；页面的图片记录没存宽高，这里读文件头。
    const scene = input.materials.find(material => material.tag.startsWith('@图片') && material.purpose.startsWith('背景'));
    const finish = looks => {
      const result = checked(() => writePrompt(input, looks));
      const warnings = [...result.warnings, ...sceneRatioNotes(input.ratio, scene ? promptImages.sizeOf(scene.asset) : null)];
      return { cardId: input.cardId, ...result, warnings, issues: checkRules({ ...input, ...result }) };
    };
    const people = personMaterials(input);
    if (!people.length) return sendJson(res, 200, { ...finish({}), yuan: 0, costUnknown: false });
    ensureIdle(input.cardId);
    const env = readEnv(); ensureKey(env);
    return paid(res, input.cardId, env, async ask => {
      let images;
      try { images = await promptImages.prepare(people); } catch (error) { throw new HttpError(400, error.message); }
      return finish(await lookPeople({ materials: people, images }, { ask }));
    });
  });
  router.add('POST', '/api/video-rewrite/check', async ({ req, res }) => {
    const body = await readJson(req);
    checked(() => { checkCardId(body?.cardId); checkDuration(body?.duration); checkMaterials(body?.materials);
      if (typeof body?.videoPrompt !== 'string') throw Error('请填写要检查的视频提示词。'); });
    const seconds = checked(() => checkChangeSeconds(body?.changeSeconds, body.duration));
    sendJson(res, 200, { issues: checkRules({ ...body, changeSeconds: seconds }), yuan: 0 });
  });
}
