import { HttpError, readJson, sendJson } from '../http.mjs';
import { createRewriteSession } from '../videoRewrite/session.mjs';
import { checkCardId, checkDuration, checkUserText, nearestRatio } from '../videoRewrite/input.mjs';
import { removeRewrite, rewriteFolder } from '../videoRewrite/storage.mjs';
import { createFinalizer } from '../videoRewrite/finalPrompt.mjs';
import { sceneRatioNotes } from '../videoRewrite/writePrompt.mjs';
import { analyzeProduct } from '../productRemake/analyze.mjs';
import { checkProductMaterials, checkProductPlan, checkProductPromptInput } from '../productRemake/input.mjs';
import { lookProducts, productMaterials } from '../productRemake/lookProducts.mjs';
import { writeProductPrompt } from '../productRemake/writePrompt.mjs';
import { checkProductRules } from '../productRemake/rules.mjs';
import { fakeProductAsk } from '../productRemake/fake.mjs';

const checked = action => { try { return action(); } catch (error) { throw new HttpError(400, error.message); } };

export function productRemakeRoutes(router, options) {
  const { dataRoot, media, sheets, promptImages, readEnv, fake, fakeDelayMs = 0 } = options;
  const { ensureIdle, ensureAgent, paid, agentCall } = options.session ?? createRewriteSession(options);
  const finalize = createFinalizer({ dataRoot, promptImages, media, sheets, fake, agentCall });
  const fakeAsk = input => fakeProductAsk(input, { delayMs: input.round === 'analyze' ? fakeDelayMs : 0 });
  router.add('POST', '/api/product-remake/analyze', async ({ req, res }) => {
    const body = await readJson(req), cardId = checked(() => checkCardId(body?.cardId));
    ensureIdle(cardId);
    try {
      const userText = checked(() => checkUserText(body.userText)), meta = checked(() => media.checkSource(body.source));
      checked(() => checkDuration(meta.duration));
      const env = readEnv(); ensureAgent(env);
      const folder = checked(() => rewriteFolder(dataRoot, cardId, true)), ratio = nearestRatio(meta.width, meta.height);
      return await paid(res, cardId, env, async ask => {
        const result = await analyzeProduct({ source: meta.path, folder, duration: meta.duration, ratio, userText,
          width: meta.width, height: meta.height }, { sheets, ask });
        return { cardId, ...result, duration: meta.duration, targetDuration: Math.ceil(meta.duration), ratio,
          width: meta.width, height: meta.height, hasAudio: meta.hasAudio };
      }, fakeAsk);
    } finally { removeRewrite(dataRoot, cardId); }
  });
  router.add('POST', '/api/product-remake/prompt', async ({ req, res }) => {
    const body = await readJson(req), input = checked(() => checkProductPromptInput(body));
    ensureIdle(input.cardId);
    const env = readEnv(); ensureAgent(env);
    return paid(res, input.cardId, env, async ask => {
      const products = productMaterials(input.materials);
      let images;
      try { images = await promptImages.prepare(products); } catch (error) { throw new HttpError(400, error.message); }
      const looks = await lookProducts({ products: input.plan.products, materials: products, images }, { ask });
      const result = writeProductPrompt(input, looks);
      const scene = input.materials.find(row => row.role === 'background');
      const draft = { ...result, warnings: [...result.warnings, ...sceneRatioNotes(input.ratio, scene ? promptImages.sizeOf(scene.asset) : null)] };
      // 11-08 用户定：本机 agent 再看图定稿（合并原来的「让 Claude 看一遍」）；@视频1 就是原片，不另给原片。
      return { cardId: input.cardId, ...await finalize({ kind: 'product', input, draft, env,
        rules: prompt => checkProductRules({ ...input, ...draft, videoPrompt: prompt }), settings: body.settings }) };
    }, fakeAsk);
  });
  router.add('POST', '/api/product-remake/check', async ({ req, res }) => {
    const body = await readJson(req);
    checked(() => { checkCardId(body?.cardId); checkDuration(body?.duration); if (body.plan !== undefined) checkProductPlan(body.plan);
      if (typeof body?.videoPrompt !== 'string') throw Error('请填写要检查的视频提示词。'); });
    const materials = checked(() => checkProductMaterials(body.materials));
    sendJson(res, 200, { issues: checkProductRules({ ...body, materials }), yuan: 0 });
  });
}
