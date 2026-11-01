// 视频单独占最多三个位置；只有 submit 会花钱，每单最多调用一次。
import { parseMp4 } from './mp4.mjs';
import { videoPrice } from './videoModels.mjs';
import { humanSeedanceError } from './seedance.mjs';
import { compressVideoReferences } from './videoReferences.mjs';
import { addSoundtrack } from './soundtrack.mjs';

const UNCERTAIN = '可能已建任务并扣费，没有自动重发，去火山控制台视频任务列表看一眼。';
const DAY = 24 * 60 * 60 * 1000;
const QUERY_WARNING = '暂时查不到进度，请检查网络；服务会继续查询，不会重新提交。任务可能已经生成并扣费，可去火山控制台核对。';
const terminal = new Set(['failed', 'expired', 'cancelled', 'canceled']);
const missingTos = new Set(['TOS_ACCESS_KEY_ID_MISSING', 'TOS_SECRET_ACCESS_KEY_MISSING', 'TOS_BUCKET_MISSING']);
function completedTime(task, fallback) {
  const value = task.finished_at ?? task.completed_at ?? task.updated_at;
  const milliseconds = typeof value === 'number' ? value * 1000 : Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds).toISOString() : fallback;
}

export function createVideoQueue({ jobs, works, uploads, spend, client, uploadVideo = client?.uploadVideo,
  compressReferences = compressVideoReferences, soundtrack = addSoundtrack,
  concurrency = 3, pollMs = 10000, queryWarningAfterMs = 60000, now = () => new Date(),
  sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)), logError = () => {}, log = () => {} }) {
  const running = new Set();
  const limit = Math.min(3, Math.max(1, Math.floor(Number(concurrency) || 3)));
  const timestamp = () => now().toISOString();
  const finish = (id, changes) => jobs.patch(id, { ...changes, phase: null, warning: null, finishedAt: timestamp() });

  function submit(input) {
    const job = jobs.create({ ...input, kind: 'video' });
    pump();
    return job;
  }

  function pump() {
    const available = jobs.list().filter(job => job.kind === 'video' && job.status === 'queued' && !running.has(job.id));
    for (const job of available.slice(0, Math.max(0, limit - running.size))) {
      running.add(job.id);
      run(job.id).catch(() => {
        // 不记录任意客户端异常原文：它可能包含请求头、Key或预签名URL。
        logError(`视频任务 ${job.id.slice(0, 8)} 出意外`, new Error('VIDEO_QUEUE_ERROR'));
        const saved = jobs.read(job.id);
        const uncertain = Boolean(saved?.submitStartedAt);
        finish(job.id, { status: uncertain ? 'uncertain' : 'failed', errorCode: 'VIDEO_QUEUE_ERROR',
          error: uncertain ? UNCERTAIN : '准备参考素材时出错，这单没发出去，没花钱。' });
      }).finally(() => { running.delete(job.id); pump(); });
    }
  }

  /** 有配声来源就配回原声；失败不抛、不重下，照存无声成片并把原因写给页面（钱已花）。 */
  async function mixSoundtrack(job, buffer) {
    if (!job.soundtrack) return { buffer };
    const file = (job.soundtrack.type === 'upload' ? uploads : works).path(job.soundtrack.id);
    if (!file) return { buffer, notice: '成片已存，但找不到原视频（可能被删了），没配上原声，这条没有声音。' };
    try { return { buffer: await soundtrack(buffer, file) }; }
    catch (error) {
      logError(`视频任务 ${job.id.slice(0, 8)} 配回原声失败`, error);
      return { buffer, notice: '成片已存，但配回原声失败（详情见日志），这条没有声音。' };
    }
  }

  async function prepare(job) {
    const images = [], videos = [], audios = [], order = [], videoOrder = [], audioOrder = [];
    let refVideoSeconds = 0;
    for (const [index, ref] of (job.refs ?? []).entries()) {
      const store = ref.type === 'upload' ? uploads : works;
      if (ref.asset && ref.kind === 'image') {
        if (!store.path(ref.id)) throw new Error('REF_MISSING');
        images.push({ asset: ref.asset });
        order.push(index + 1);
        continue;
      }
      const asset = store.read(ref.id);
      if (!asset) throw new Error('REF_MISSING');
      if (asset.kind === 'video') {
        if (!uploadVideo) throw new Error('TOS_MISSING');
        videos.push({ url: await uploadVideo(asset) });
        refVideoSeconds += asset.duration;
        videoOrder.push(index + 1);
      } else if (asset.kind === 'audio') {
        audios.push(asset);
        audioOrder.push(index + 1);
      } else {
        images.push({ ...asset, ...(ref.asset ? { asset: ref.asset } : {}) });
        order.push(index + 1);
      }
    }
    const request = await compressReferences({ ...job, images, videos, audios, refVideoSeconds });
    return { request, order: [...order, ...videoOrder, ...audioOrder] };
  }

  async function run(id) {
    let job = jobs.patch(id, { status: 'running', startedAt: timestamp() });
    if (!job) return;
    if (!job.taskId) {
      if (job.submitStartedAt) return finish(id, { status: 'uncertain', error: UNCERTAIN });
      jobs.patch(id, { phase: 'uploading' });
      let prepared;
      try { prepared = await prepare(job); }
      catch (err) {
        const code = missingTos.has(err?.code) || err?.code === 'TOS_UPLOAD_TIMEOUT' ? err.code : 'REF_PREPARE_FAILED';
        const error = missingTos.has(code)
          ? `.env.local 里没填 ${code.slice(0, -8)}（存参考视频要用），这单没发出去，没花钱。`
          : code === 'TOS_UPLOAD_TIMEOUT' ? '参考视频上传太慢超时，这单没发出去，没花钱。可以把参考视频截短或压小再发。'
            : '参考素材读取或上传失败，这单没发出去，没花钱。';
        return finish(id, { status: 'failed', errorCode: code, error });
      }
      // 此写入失败就不能调用submit。即使发出后断线，也绝不自动重发。
      jobs.patch(id, { phase: 'submitting', submitStartedAt: timestamp() });
      let result;
      try { result = await client.submit(prepared.request); }
      catch (err) { result = { ok: false, outcome: err?.notSent ? 'notSent' : 'uncertain', code: 'SUBMIT_ERROR' }; }
      if (!result.ok) {
        const blocked = (result.blocked ?? []).map(i => prepared.order[i - 1]).filter(Boolean);
        const uncertain = !['rejected', 'notSent'].includes(result.outcome);
        const error = uncertain ? UNCERTAIN : blocked.length
          ? humanSeedanceError({ code: result.code, message: result.rawMessage, blocked, outcome: result.outcome })
          : /没扣钱|没花钱/.test(result.message ?? '') ? result.message
            : `${result.message || '火山没收下这单。'}这单没建任务，没扣钱。`;
        return finish(id, { status: uncertain ? 'uncertain' : 'failed', errorCode: result.code, error, blocked });
      }
      // 拿到合法任务号立即落盘，之后任何重启都只能query。
      job = jobs.patch(id, { phase: 'waiting', taskId: result.taskId });
    }
    await waitForResult(job);
  }

  async function waitForResult(initial) {
    let job = initial, queryFailureSince = null;
    for (;;) {
      const expired = () => job.completedAt && now().getTime() - new Date(job.completedAt).getTime() >= DAY;
      const failExpired = () => finish(job.id, { status: 'failed', errorCode: 'VIDEO_DOWNLOAD_EXPIRED',
        error: '视频出好了（已扣费），但 24 小时都没下载下来，链接已过期。' });
      if (expired()) return failExpired();
      let task;
      try { task = await client.query(job.taskId); }
      catch {
        logError(`视频任务 ${job.id.slice(0, 8)} 查询失败，下次再查`, new Error('VIDEO_QUERY_FAILED'));
        queryFailureSince ??= now().getTime();
        if (now().getTime() - queryFailureSince >= queryWarningAfterMs && job.warning !== QUERY_WARNING) {
          job = jobs.patch(job.id, { warning: QUERY_WARNING });
        }
        await sleep(pollMs);
        continue;
      }
      queryFailureSince = null;
      if (job.warning) job = jobs.patch(job.id, { warning: null });
      if (terminal.has(task.status)) {
        const reason = task.error?.message ?? '火山没给原因';
        return finish(job.id, { status: 'failed', errorCode: task.error?.code ?? task.status,
          error: `火山生成失败（${task.error?.code ?? task.status}）：${reason}${reason.endsWith('。') ? '' : '。'}按火山规则失败不收费。` });
      }
      if (task.status === 'succeeded') {
        const completedAt = job.completedAt ?? completedTime(task, timestamp());
        job = jobs.patch(job.id, { phase: 'downloading', completedAt });
        if (expired()) return failExpired();
        let buffer;
        try {
          buffer = await client.download(task.content?.video_url);
          if (!parseMp4(buffer)) throw new Error('VIDEO_INVALID');
        } catch {
          logError(`视频任务 ${job.id.slice(0, 8)} 下片失败，下次再下`, new Error('VIDEO_DOWNLOAD_FAILED'));
          await sleep(pollMs);
          continue;
        }
        const tokens = task.usage?.completion_tokens;
        const costEstimated = typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0;
        const withVideo = job.refs?.some(ref => ref.kind === 'video') ?? false;
        const yuan = costEstimated ? job.priceYuan : tokens * videoPrice(job.model, job.resolution, withVideo) / 1e6;
        const mixed = await mixSoundtrack(job, buffer);
        const work = works.addVideo(mixed.buffer, { ...job, jobId: job.id, taskId: job.taskId, yuan });
        spend.add({ yuan, model: job.model, jobId: job.id });
        finish(job.id, { status: 'succeeded', works: [work.id], yuan, costEstimated, ...(mixed.notice ? { error: mixed.notice } : {}) });
        log(`[视频] ${job.id.slice(0, 8)} 出好`);
        return;
      }
      jobs.patch(job.id, { phase: 'waiting' });
      await sleep(pollMs);
    }
  }

  function recover() {
    let fixed = 0;
    for (const job of jobs.list()) {
      if (job.kind !== 'video' || !['running', 'queued'].includes(job.status)) continue;
      if (job.status === 'queued' && !job.taskId && !job.submitStartedAt) continue;
      fixed++;
      if (job.taskId) jobs.patch(job.id, { status: 'queued', phase: 'waiting' });
      else if (job.submitStartedAt) finish(job.id, { status: 'uncertain', error: UNCERTAIN, errorCode: 'SERVER_RESTARTED' });
      else jobs.patch(job.id, { status: 'queued', phase: null });
    }
    return fixed;
  }
  return { submit, pump, recover };
}
