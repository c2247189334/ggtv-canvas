// 视频单独占最多三个位置；只有 submit 会花钱，每单最多调用一次。
import { parseMp4 } from './mp4.mjs';
import { videoPrice } from './videoModels.mjs';
import { humanSeedanceError } from './seedance.mjs';
import { tosMissingText } from './config.mjs';
import { compressVideoReferences } from './videoReferences.mjs';
import { addSoundtrack } from './soundtrack.mjs';

const UNCERTAIN = '可能已建任务，没有自动重发，去火山控制台视频任务列表看一眼。';
const DAY = 24 * 60 * 60 * 1000;
const QUERY_WARNING = '暂时查不到进度，请检查网络；服务会继续查询，不会重新提交。任务可能已经生成，可去火山控制台核对。';
const terminal = new Set(['failed', 'expired', 'cancelled', 'canceled']);
const missingTos = new Set(['TOS_ACCESS_KEY_ID_MISSING', 'TOS_SECRET_ACCESS_KEY_MISSING', 'TOS_BUCKET_MISSING']);
// 准备参考素材失败时按原因说话（都发生在交单之前，没花钱）。只认这张表里的码，别的错误原文不上页面。
const PREPARE_ERRORS = {
  TOS_UPLOAD_TIMEOUT: '参考视频上传太慢超时，这单没发出去。可以把参考视频截短或压小再发。',
  TOS_UPLOAD_FAILED: 'TOS 没收下参考视频，这单没发出去。检查右上角「设置」里填的 TOS 两个密钥和桶名（填错了重新填，不用重启），桶要在北京区，电脑时间要准。',
  TOS_REFERENCE_NOT_READABLE: '参考视频传上 TOS 后读不回来，这单没发出去。检查 TOS 密钥有没有读权限、桶名对不对（桶要在北京区）。',
  TOS_REFERENCE_HASH_MISMATCH: '参考视频传上 TOS 后内容对不上，这单没发出去。再发一次试试。',
  TOS_VIDEO_SIZE_INVALID: '参考视频是空的或超过 200MB，这单没发出去。截短或压小再发。',
  TOS_TRANSFER_FAILED: '参考视频没传到 TOS（多半是网络问题），这单没发出去。检查网络后再发。',
  REF_MISSING: '有一份参考素材找不到了（可能被删了），这单没发出去。',
};
const TOO_LARGE = '参考素材加起来太大（请求超过 64MB），这单没发出去。减少参考，或换小一点的图和声音再发。';
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
  // 火山给的任务号先记在内存里：落盘那一下失败也不丢。
  const taskIds = new Map();
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
      let stuck = false;
      const release = () => { running.delete(job.id); pump(); };
      run(job.id).catch(() => {
        // 不记录任意客户端异常原文：它可能包含请求头、Key或预签名URL。
        logError(`视频任务 ${job.id.slice(0, 8)} 出意外`, new Error('VIDEO_QUEUE_ERROR'));
        // 连收尾都读写不了硬盘（盘满、文件被占）：先占着位子等一轮再放。马上放的话这单还是「排队中」，
        // 会在同一拍里被无限重挑，整个小服务卡死。
        try {
          const saved = jobs.read(job.id);
          const taskId = saved?.taskId ?? taskIds.get(job.id);
          if (taskId) return void resume(job.id, taskId);
          const uncertain = Boolean(saved?.submitStartedAt);
          finish(job.id, { status: uncertain ? 'uncertain' : 'failed', errorCode: 'VIDEO_QUEUE_ERROR',
            error: uncertain ? UNCERTAIN : '准备参考素材时出错，这单没发出去。' });
        } catch {
          stuck = true;
          logError(`视频任务 ${job.id.slice(0, 8)} 的状态写不进硬盘，等一轮再试`, new Error('VIDEO_JOB_WRITE_FAILED'));
        }
      }).finally(() => (stuck ? void sleep(pollMs).then(release) : release()));
    }
  }

  /** 有任务号的单出了意外（多半是硬盘一时写不进）：钱已花、片还能取，等一轮排回去接着查；不标终态，也不重发。 */
  async function resume(id, taskId) {
    for (;;) {
      await sleep(pollMs);
      try {
        if (jobs.patch(id, { status: 'queued', phase: 'waiting', taskId })) pump();
        return;
      } catch { logError(`视频任务 ${id.slice(0, 8)} 还写不进硬盘，稍后再试`, new Error('VIDEO_JOB_WRITE_FAILED')); }
    }
  }

  /** 有配声来源就配回原声；失败不抛、不重下，照存无声成片并把原因写给页面（钱已花）。 */
  async function mixSoundtrack(job, buffer) {
    if (!job.soundtrack) return { buffer };
    const file = (job.soundtrack.type === 'upload' ? uploads : works).path(job.soundtrack.id);
    if (!file) return { buffer, notice: '成片已存，但找不到原视频（可能被删了），没配上原声，这条没有声音。' };
    try {
      const mixed = await soundtrack(buffer, file);
      if (!parseMp4(mixed)) throw new Error('SOUNDTRACK_OUTPUT_INVALID');
      return { buffer: mixed };
    }
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
        const raw = err?.code ?? err?.message;
        const code = missingTos.has(raw) || Object.hasOwn(PREPARE_ERRORS, raw) ? raw : 'REF_PREPARE_FAILED';
        const error = missingTos.has(code)
          ? tosMissingText(code.slice(0, -8))
          : PREPARE_ERRORS[code] ?? '参考素材读取或上传失败，这单没发出去。';
        // 只记错误码：原文可能带预签名地址。
        logError(`视频任务 ${id.slice(0, 8)} 准备参考素材失败`, new Error(code));
        return finish(id, { status: 'failed', errorCode: code, error });
      }
      // 此写入失败就不能调用submit。即使发出后断线，也绝不自动重发。
      jobs.patch(id, { phase: 'submitting', submitStartedAt: timestamp() });
      let result;
      try { result = await client.submit(prepared.request); }
      catch (err) {
        const tooLarge = Boolean(err?.notSent) && String(err?.message ?? '').startsWith('SEEDANCE_BODY_TOO_LARGE');
        result = { ok: false, outcome: err?.notSent ? 'notSent' : 'uncertain', code: tooLarge ? 'SEEDANCE_BODY_TOO_LARGE' : 'SUBMIT_ERROR',
          ...(tooLarge ? { message: TOO_LARGE } : {}) };
      }
      if (!result.ok) {
        const blocked = (result.blocked ?? []).map(i => prepared.order[i - 1]).filter(Boolean);
        const uncertain = !['rejected', 'notSent'].includes(result.outcome);
        const error = uncertain ? UNCERTAIN : blocked.length
          ? humanSeedanceError({ code: result.code, message: result.rawMessage, blocked, outcome: result.outcome })
          : /没发出去|没建任务/.test(result.message ?? '') ? result.message
            : `${result.message || '火山没收下这单。'}这单没建任务。`;
        return finish(id, { status: uncertain ? 'uncertain' : 'failed', errorCode: result.code, error, blocked });
      }
      // 拿到合法任务号立即落盘，之后任何重启都只能query。落盘失败就先带着内存里的任务号接着查，等片时每轮顺手补写。
      taskIds.set(id, result.taskId);
      const waiting = { phase: 'waiting', taskId: result.taskId };
      try { job = jobs.patch(id, waiting) ?? { ...job, ...waiting }; }
      catch {
        logError(`视频任务 ${id.slice(0, 8)} 的任务号 ${result.taskId} 没写进硬盘，先记在内存里接着查`, new Error('VIDEO_TASK_ID_NOT_SAVED'));
        job = { ...job, ...waiting };
      }
    }
    await waitForResult(job);
  }

  async function waitForResult(initial) {
    let job = initial, queryFailureSince = null;
    // 等片期间的进度写盘：写不进不算事（下一轮再写），每次顺手带上任务号。
    const save = changes => {
      try { return jobs.patch(job.id, { ...changes, taskId: job.taskId }) ?? { ...job, ...changes }; }
      catch {
        logError(`视频任务 ${job.id.slice(0, 8)} 进度没写进硬盘，下一轮再写`, new Error('VIDEO_JOB_WRITE_FAILED'));
        return { ...job, ...changes };
      }
    };
    for (;;) {
      const expired = () => job.completedAt && now().getTime() - new Date(job.completedAt).getTime() >= DAY;
      // 出好了火山就计费：片没拿到也要记账，写明金额和任务号，方便去火山控制台找（11-15）。
      const failExpired = () => {
        const yuan = job.yuan ?? job.priceYuan, known = typeof yuan === 'number' && Number.isFinite(yuan);
        const costEstimated = job.costEstimated ?? true;
        if (known && !spend.has(job.id)) spend.add({ yuan, model: job.model, jobId: job.id });
        return finish(job.id, { status: 'failed', errorCode: 'VIDEO_DOWNLOAD_EXPIRED', ...(known ? { yuan, costEstimated } : {}),
          error: `视频出好了，但 24 小时都没下载下来，链接已过期。${known ? `这单火山已生成成功、会计费（${costEstimated ? '约 ' : ''}¥${yuan.toFixed(2)}，已记进花费）；` : ''}`
            + `任务号 ${job.taskId}，可去火山控制台视频任务列表看。` });
      };
      if (expired()) return failExpired();
      let task;
      try { task = await client.query(job.taskId); }
      catch {
        logError(`视频任务 ${job.id.slice(0, 8)} 查询失败，下次再查`, new Error('VIDEO_QUERY_FAILED'));
        queryFailureSince ??= now().getTime();
        if (now().getTime() - queryFailureSince >= queryWarningAfterMs && job.warning !== QUERY_WARNING) {
          job = save({ warning: QUERY_WARNING });
        }
        await sleep(pollMs);
        continue;
      }
      queryFailureSince = null;
      if (job.warning) job = save({ warning: null });
      if (terminal.has(task.status)) {
        const reason = task.error?.message ?? '火山没给原因';
        return finish(job.id, { status: 'failed', errorCode: task.error?.code ?? task.status,
          error: `火山生成失败（${task.error?.code ?? task.status}）：${reason}${reason.endsWith('。') ? '' : '。'}` });
      }
      if (task.status === 'succeeded') {
        const completedAt = job.completedAt ?? completedTime(task, timestamp());
        const tokens = task.usage?.completion_tokens;
        const costEstimated = typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0;
        const withVideo = job.refs?.some(ref => ref.kind === 'video') ?? false;
        const yuan = costEstimated ? job.priceYuan : tokens * videoPrice(job.model, job.resolution, withVideo) / 1e6;
        // 实收跟完成时间一起先存下：之后一直下不下来、过期了也有账可记。
        job = save({ phase: 'downloading', completedAt, yuan, costEstimated });
        if (expired()) return failExpired();
        // 上一轮可能已经把片存进作品库、只差收尾（收尾写盘失败后重来）：认回那一份，不重下成两份、不记两次账。
        let work = works.list().find(item => item.jobId === job.id), notice;
        if (!work) {
          let buffer;
          try {
            buffer = await client.download(task.content?.video_url);
            if (!parseMp4(buffer)) throw new Error('VIDEO_INVALID');
          } catch {
            logError(`视频任务 ${job.id.slice(0, 8)} 下片失败，下次再下`, new Error('VIDEO_DOWNLOAD_FAILED'));
            await sleep(pollMs);
            continue;
          }
          const mixed = await mixSoundtrack(job, buffer);
          work = works.addVideo(mixed.buffer, { ...job, jobId: job.id, taskId: job.taskId, yuan });
          notice = mixed.notice;
        }
        if (!spend.has(job.id)) spend.add({ yuan, model: job.model, jobId: job.id });
        finish(job.id, { status: 'succeeded', works: [work.id], yuan, costEstimated, ...(notice ? { error: notice } : {}) });
        log(`[视频] ${job.id.slice(0, 8)} 出好`);
        return;
      }
      save({ phase: 'waiting' });
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
