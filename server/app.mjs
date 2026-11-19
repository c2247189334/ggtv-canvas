// 把各块拼起来：硬盘存储 + 出图排队 + 接口。start.mjs 和集成测试都从这里拿。
import { createHandler, createRouter } from './http.mjs';
import { createQueue, DEFAULT_CONCURRENCY } from './queue.mjs';
import { createVideoQueue } from './videoQueue.mjs';
import { createDepthQueue } from './depth/queue.mjs';
import { createLocalMedia } from './depth/local.mjs';
import { localMediaRoutes } from './routes/localMedia.mjs';
import { rewriteRoutes } from './routes/rewrite.mjs';
import { agentHealth } from './agent.mjs';
import { createRewrite, fakeRewrite } from './rewrite.mjs';
import { videoRewriteRoutes } from './routes/videoRewrite.mjs';
import { productRemakeRoutes } from './routes/productRemake.mjs';
import { createRewriteSession } from './videoRewrite/session.mjs';
import { createSheets } from './videoRewrite/sheets.mjs';
import { createPromptImages } from './videoRewrite/promptImages.mjs';
import { assetRoutes } from './routes/assets.mjs';
import { canvasRoutes } from './routes/canvases.mjs';
import { jobRoutes } from './routes/jobs.mjs';
import { videoJobRoutes } from './routes/videoJobs.mjs';
import { createCanvasStore } from './store/canvases.mjs';
import { createJobStore } from './store/jobs.mjs';
import { createSpendLog } from './store/spend.mjs';
import { createUploadStore } from './store/uploads.mjs';
import { createUploadRecords } from './store/uploadRecords.mjs';
import { createWorkStore } from './store/works.mjs';
import { createCharacterStore } from './store/characters.mjs';
import { characterRoutes } from './routes/characters.mjs';
import { createLayerQueue } from './layerQueue.mjs';
import { layerJobRoutes } from './routes/layerJobs.mjs';
import { settingsRoutes } from './routes/settings.mjs';
import { createFakeLayers, createFakeRedraw } from './fakeLayers.mjs';

/** npm run dev 时页面所在的端口（vite.config.ts 里写的），它发来的写请求也放行。 */
export const DEV_PORT = 5280;

export function createApp({ dataRoot, distDir, port, fake, readEnv, envFile, envTemplate, checkKey, openLogin, generate, videoClient, uploadVideo, splitLayers, redrawLayer,
  videoPollMs = 10000, fakeDelayMs = 0, logError, log, concurrency = DEFAULT_CONCURRENCY, executor, rewrite, videoRewrite = {} }) {
  const stores = {
    canvases: createCanvasStore(dataRoot),
    uploads: createUploadStore(dataRoot),
    uploadRecords: createUploadRecords(dataRoot),
    works: createWorkStore(dataRoot),
    characters: createCharacterStore(dataRoot),
    jobs: createJobStore(dataRoot),
    spend: createSpendLog(dataRoot)
  };
  const queue = createQueue({ ...stores, generate, concurrency, logError, log });
  const videoQueue = createVideoQueue({ ...stores, client: videoClient, uploadVideo,
    pollMs: videoPollMs, logError, log });
  const media = createLocalMedia({ ...stores, dataRoot, readEnv, fake, executor, logError });
  const depthQueue = createDepthQueue({ ...stores, media });
  // 没注入时：假模式用假图层分离；真模式由 start.mjs 注入真的（测试里不注入又不是假模式，交单会在这里报错，不会花钱）。
  const layerQueue = createLayerQueue({ ...stores, logError, log,
    split: splitLayers ?? (fake ? createFakeLayers({ delayMs: fakeDelayMs }) : async () => { throw new Error('UNKNOWN'); }),
    redraw: redrawLayer ?? (fake ? createFakeRedraw({ delayMs: fakeDelayMs }) : async () => { throw new Error('UNKNOWN'); }) });
  const router = createRouter();
  canvasRoutes(router, { ...stores, depthQueue });
  assetRoutes(router, stores);
  jobRoutes(router, { ...stores, queue, readEnv, fake });
  characterRoutes(router, { ...stores, queue, readEnv, fake });
  videoJobRoutes(router, { ...stores, videoQueue, readEnv, fake });
  layerJobRoutes(router, { ...stores, layerQueue, readEnv, fake });
  settingsRoutes(router, { envFile, envTemplate, readEnv, checkKey: fake ? undefined : checkKey, openLogin: fake ? undefined : openLogin, logError });
  localMediaRoutes(router, { media, depthQueue });
  const sheets = videoRewrite.sheets ?? createSheets({ executor });
  const promptImages = videoRewrite.promptImages ?? createPromptImages({ ...stores, executor });
  const rewriteOptions = { dataRoot, media, sheets, promptImages, readEnv, fake, fakeDelayMs, spend: stores.spend, logError,
    claude: videoRewrite.claude };
  rewriteOptions.session = createRewriteSession(rewriteOptions);
  videoRewriteRoutes(router, rewriteOptions);
  productRemakeRoutes(router, rewriteOptions);
  const agentRewrite = input => {
    const env = readEnv();
    return createRewrite({ call: rewriteOptions.session.agentCall(env), model: agentHealth(env).agentModel })(input);
  };
  rewriteRoutes(router, { readEnv, fake, spend: stores.spend, rewrite: rewrite ?? (fake ? fakeRewrite : agentRewrite) });
  const handler = createHandler({ router, distDir, allowedPorts: [port, DEV_PORT], logError });
  return { handler, queue, videoQueue, depthQueue, layerQueue, stores, stopVideoRewrite: () => { sheets.stop(); promptImages.stop(); } };
}
