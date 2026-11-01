// 把各块拼起来：硬盘存储 + 出图排队 + 接口。start.mjs 和集成测试都从这里拿。
import { createHandler, createRouter } from './http.mjs';
import { createQueue, DEFAULT_CONCURRENCY } from './queue.mjs';
import { createVideoQueue } from './videoQueue.mjs';
import { createDepthQueue } from './depth/queue.mjs';
import { createLocalMedia } from './depth/local.mjs';
import { localMediaRoutes } from './routes/localMedia.mjs';
import { rewriteRoutes } from './routes/rewrite.mjs';
import { createRewrite, fakeRewrite } from './rewrite.mjs';
import { videoRewriteRoutes } from './routes/videoRewrite.mjs';
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
import { createWorkStore } from './store/works.mjs';

/** npm run dev 时页面所在的端口（vite.config.ts 里写的），它发来的写请求也放行。 */
export const DEV_PORT = 5280;

export function createApp({ dataRoot, distDir, port, fake, readEnv, generate, videoClient, uploadVideo,
  videoPollMs = 10000, fakeDelayMs = 0, logError, log, concurrency = DEFAULT_CONCURRENCY, executor, rewrite, videoRewrite = {} }) {
  const stores = {
    canvases: createCanvasStore(dataRoot),
    uploads: createUploadStore(dataRoot),
    works: createWorkStore(dataRoot),
    jobs: createJobStore(dataRoot),
    spend: createSpendLog(dataRoot)
  };
  const queue = createQueue({ ...stores, generate, concurrency, logError, log });
  const videoQueue = createVideoQueue({ ...stores, client: videoClient, uploadVideo,
    pollMs: videoPollMs, logError, log });
  const media = createLocalMedia({ ...stores, dataRoot, readEnv, fake, executor, logError });
  const depthQueue = createDepthQueue({ ...stores, media });
  const router = createRouter();
  canvasRoutes(router, stores);
  assetRoutes(router, stores);
  jobRoutes(router, { ...stores, queue, readEnv, fake });
  videoJobRoutes(router, { ...stores, videoQueue, readEnv, fake });
  localMediaRoutes(router, { media, depthQueue });
  const sheets = videoRewrite.sheets ?? createSheets({ executor });
  const promptImages = videoRewrite.promptImages ?? createPromptImages({ ...stores, executor });
  videoRewriteRoutes(router, { dataRoot, media, sheets, promptImages, readEnv, fake, fakeDelayMs, spend: stores.spend, fetch: videoRewrite.fetch, logError });
  rewriteRoutes(router, { readEnv, fake, spend: stores.spend, rewrite: rewrite ?? (fake ? fakeRewrite :
    input => createRewrite({ env: readEnv(), logError })(input)) });
  const handler = createHandler({ router, distDir, allowedPorts: [port, DEV_PORT], logError });
  return { handler, queue, videoQueue, depthQueue, stores, stopVideoRewrite: () => { sheets.stop(); promptImages.stop(); } };
}
