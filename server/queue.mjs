// 出图排队。四条防花错钱的规矩（旧项目 服务端/imageQueue.mjs 踩坑换来的，照搬，代码是重写的精简版）：
//   1. 先在硬盘上记一单，再发火山；
//   2. 同时最多 3 单（.env.local 的 IMAGE_CONCURRENCY 可改，夹在 1~6）；
//   3. 失败绝不自动重发 —— 超时有可能图其实已经出了、钱也扣了；
//   4. 小服务中途被关：正在发的那单标「结果不明」，不重发；还没轮到的（从没发出去过）照常排。
// 一单要几张就连发几次（火山一次只出一张）；每出一张立刻存进作品库、记一笔花费 —— 钱花了图不能丢。

export const DEFAULT_CONCURRENCY = 3;

/** 读并发数。填得离谱就夹回 1~6。 */
export function concurrencyOf(env) {
  const text = String(env?.IMAGE_CONCURRENCY ?? '').trim();
  if (!text) return DEFAULT_CONCURRENCY;
  const raw = Number(text);
  if (!Number.isFinite(raw)) return DEFAULT_CONCURRENCY;
  return Math.min(6, Math.max(1, Math.floor(raw)));
}

/** 接下来该启动哪几单：先来先跑，填满空位为止。runningIds 是「此刻真的在跑」的，比硬盘上的状态可信。 */
export function nextToStart(jobs, runningIds, limit) {
  const running = new Set(runningIds ?? []);
  const free = Math.max(0, (Number(limit) || 0) - running.size);
  if (!free) return [];
  return (jobs ?? [])
    .filter((job) => (!job?.kind || job.kind === 'image') && job?.status === 'queued' && !running.has(job.id))
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
    .slice(0, free)
    .map((job) => job.id);
}

/** 错误码翻成人话。每句都说清楚「花没花钱」。 */
export function humanError(code) {
  if (code === 'ARK_KEY_MISSING') return '.env.local 里没填 ARK_API_KEY，这单没发出去，没花钱。';
  if (code === 'EDIT_TIMEOUT') return '等了 5 分钟火山没回音。可能已经出图并扣费（只是没传回来），没有自动重发。';
  if (code === 'EDIT_UNREACHABLE') return '这台电脑连不上火山，检查一下网络。这单多半没发出去。';
  if (code === 'REF_MISSING') return '有一张参考图找不到了（可能被删了），这单没发出去，没花钱。';
  if (code === 'SERVER_RESTARTED') return '生成时小服务被关了，结果不明（可能已出图并扣费），没有自动重发。';
  return '出了意外，没出成。详情看黑窗口。';
}

export function createQueue({ jobs, works, uploads, spend, generate, concurrency = DEFAULT_CONCURRENCY, logError = () => {}, log = () => {} }) {
  const running = new Set();

  function submit(input) {
    const job = jobs.create(input);
    pump();
    return job;
  }

  /** 有空位就启动排在前面的。同步调用、可以随便多调。 */
  function pump() {
    let all;
    try {
      all = jobs.list();
    } catch (err) {
      logError('读任务列表失败', err);
      return;
    }
    for (const id of nextToStart(all, [...running], concurrency)) {
      running.add(id); // 必须在下一轮 nextToStart 之前占上位子
      run(id)
        .catch((err) => {
          logError(`出图任务 ${id.slice(0, 8)} 出意外`, err);
          finish(id, { status: 'failed', error: humanError('UNKNOWN'), errorCode: 'UNKNOWN' });
        })
        .finally(() => {
          running.delete(id);
          pump();
        });
    }
  }

  function finish(id, changes) {
    jobs.patch(id, { ...changes, finishedAt: new Date().toISOString() });
  }

  /** 读出参考图字节。有一张找不到就返回 null。 */
  function loadRefs(refs) {
    const images = [];
    for (const ref of refs ?? []) {
      const asset = ref.type === 'upload' ? uploads.read(ref.id) : works.read(ref.id);
      if (!asset) return null;
      images.push(asset);
    }
    return images;
  }

  /** 跑一单。这里是唯一真花钱的地方。 */
  async function run(id) {
    const job = jobs.patch(id, { status: 'running', startedAt: new Date().toISOString() });
    if (!job) return;
    const images = loadRefs(job.refs);
    if (!images) return finish(id, { status: 'failed', error: humanError('REF_MISSING'), errorCode: 'REF_MISSING' });

    const made = [];
    for (let index = 0; index < job.count; index += 1) {
      let result;
      try {
        result = await generate({ model: job.model, prompt: job.prompt, images, size: job.size });
      } catch (err) {
        const code = String(err?.message ?? '');
        return finish(id, made.length
          ? { status: 'succeeded', error: `出了 ${made.length}/${job.count} 张，后面的没出成：${humanError(code)}`, errorCode: code }
          : { status: 'failed', error: humanError(code), errorCode: code });
      }
      if (!result.ok) {
        const reason = `火山没接（${result.status}）：${result.message}`;
        return finish(id, made.length
          ? { status: 'succeeded', error: `出了 ${made.length}/${job.count} 张；第 ${index + 1} 张${reason}`, errorCode: 'REJECTED' }
          : { status: 'failed', error: reason, errorCode: 'REJECTED' });
      }
      const work = works.add(result.image, { jobId: id, canvasId: job.canvasId, prompt: job.prompt, model: job.model, yuan: job.priceYuan, refs: job.refs });
      spend.add({ yuan: job.priceYuan, model: job.model, jobId: id });
      made.push(work.id);
      jobs.patch(id, { works: made.slice() });
      log(`[出图] ${id.slice(0, 8)} 第 ${index + 1}/${job.count} 张出好`);
    }
    finish(id, { status: 'succeeded' });
  }

  /** 启动时收拾上次没跑完的：正在发的标「结果不明」，不重发。返回收拾了几单。 */
  function recover() {
    let fixed = 0;
    for (const job of jobs.list()) {
      if ((job.kind && job.kind !== 'image') || job.status !== 'running') continue;
      fixed += 1;
      const kept = job.works?.length ? `重启前已出好 ${job.works.length} 张，在作品库里。` : '';
      finish(job.id, { status: 'uncertain', error: humanError('SERVER_RESTARTED') + kept, errorCode: 'SERVER_RESTARTED' });
    }
    return fixed;
  }

  return { submit, pump, recover };
}
