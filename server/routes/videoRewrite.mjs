import { HttpError, readJson, sendJson } from '../http.mjs';
import { analyze } from '../videoRewrite/analyze.mjs';
import { createFinalizer } from '../videoRewrite/finalPrompt.mjs';
import { lookPeople, personMaterials } from '../videoRewrite/lookPeople.mjs';
import { createRewriteSession } from '../videoRewrite/session.mjs';
import { checkRules, targetDuration } from '../videoRewrite/rules.mjs';
import { sceneRatioNotes, writePrompt } from '../videoRewrite/writePrompt.mjs';
import { checkCardId, checkChangeSeconds, checkDuration, checkMaterials, checkPromptInput, checkUserText, nearestRatio } from '../videoRewrite/input.mjs';
import { removeRewrite, rewriteFolder } from '../videoRewrite/storage.mjs';
import { checkLineTexts } from '../videoRewrite/lines.mjs';

const checked = action => { try { return action(); } catch (error) { throw new HttpError(400, error.message); } };

export function videoRewriteRoutes(router, options) {
  const { dataRoot, media, sheets, promptImages, readEnv, fake } = options;
  const { ensureIdle, agentCall, ensureAgent, paid } = options.session ?? createRewriteSession(options);
  const finalize = createFinalizer({ dataRoot, promptImages, media, sheets, fake, agentCall });
  const metadata = meta => ({ duration: meta.duration, targetDuration: targetDuration(meta.duration),
    ratio: nearestRatio(meta.width, meta.height), width: meta.width, height: meta.height, hasAudio: meta.hasAudio });
  router.add('POST', '/api/video-rewrite/analyze', async ({ req, res }) => {
    const body = await readJson(req);
    const cardId = checked(() => checkCardId(body?.cardId));
    ensureIdle(cardId);
    try {
      const userText = checked(() => checkUserText(body?.userText));
      const meta = checked(() => media.checkSource(body?.source));
      checked(() => checkDuration(meta.duration));
      const env = readEnv(); ensureAgent(env);
      const ratio = nearestRatio(meta.width, meta.height);
      const folder = checked(() => rewriteFolder(dataRoot, cardId, true));
      return await paid(res, cardId, env, async ask => {
        const result = await analyze({ source: meta.path, folder, duration: meta.duration, width: meta.width, height: meta.height, ratio, userText,
          ...(body.talking === true ? { talking: true } : {}) }, { sheets, ask });
        return { plan: result.plan, cuts: result.cuts, cardId, ...metadata(meta), backgroundFrames: result.backgroundFrames };
      });
    } finally { removeRewrite(dataRoot, cardId); }
  });
  // 底稿由代码按模板拼。10-30 功夫舞真成片后：连了要换的人物图就先让本机 agent 看一次图答固定四项。
  // 11-08 用户定：再由本机 agent 看图定稿，过不了规则就退回底稿。11-15 起本机 agent 是必需的（不再用豆包）。
  router.add('POST', '/api/video-rewrite/prompt', async ({ req, res }) => {
    const body = await readJson(req), input = checked(() => checkPromptInput(body));
    // 背景图比例和视频对不上只进提醒、不拦（10-30 用户定）；页面的图片记录没存宽高，这里读文件头。
    const scene = input.materials.find(material => material.tag.startsWith('@图片') && material.purpose.startsWith('背景'));
    const draftOf = looks => {
      const result = checked(() => writePrompt(input, looks));
      return { ...result, warnings: [...result.warnings, ...sceneRatioNotes(input.ratio, scene ? promptImages.sizeOf(scene.asset) : null)] };
    };
    const finish = async (looks, env) => {
      const draft = draftOf(looks);
      const result = await finalize({ kind: 'person', input, draft, rules: prompt => checkRules({ ...input, ...draft, videoPrompt: prompt }),
        source: body.source ?? null, settings: body.settings, env });
      return { cardId: input.cardId, ...result };
    };
    const people = personMaterials(input), env = readEnv();
    if (!people.length && fake) return sendJson(res, 200, { ...await finish({}, env), yuan: 0 });
    ensureIdle(input.cardId); ensureAgent(env);
    return paid(res, input.cardId, env, async ask => {
      if (!people.length) return finish({}, env);
      let images;
      try { images = await promptImages.prepare(people); } catch (error) { throw new HttpError(400, error.message); }
      return finish(await lookPeople({ materials: people, images }, { ask }), env);
    });
  });
  router.add('POST', '/api/video-rewrite/check', async ({ req, res }) => {
    const body = await readJson(req);
    checked(() => { checkCardId(body?.cardId); checkDuration(body?.duration); checkMaterials(body?.materials);
      if (typeof body?.videoPrompt !== 'string') throw Error('请填写要检查的视频提示词。'); });
    const seconds = checked(() => checkChangeSeconds(body?.changeSeconds, body.duration)), lines = checked(() => checkLineTexts(body.lines));
    sendJson(res, 200, { issues: checkRules({ ...body, changeSeconds: seconds, lines }), yuan: 0 });
  });
}
