// 图层分离排队（kind: 'layers'）。规矩和出图排队一样（queue.mjs 开头四条）：先落盘再发、失败不重发、重启标结果不明。
// 火山一单回一张底图 + 若干透明图层；全部存进作品库（作品带 layer 标记，作品库网格不显示），单子上记下各层的作品编号和位置。
// 图层重绘（kind: 'layer-redraw'）也排在这里：一个图层 + 一句话出一张透明图层，存成新作品，单子上记下 from → work。
import { humanError } from './queue.mjs';
import { LAYER_MODEL } from './layerSplit.mjs';

const CONCURRENCY = 2;
const KINDS = new Set(['layers', 'layer-redraw']);

function failure(code) {
  if (code === 'REF_MISSING') return '原图找不到了（可能被删了），这单没发出去。';
  return humanError(code);
}

export function createLayerQueue({ jobs, works, uploads, spend, split, redraw, retryMs = 5000, logError = () => {}, log = () => {} }) {
  const running = new Set();

  function submit(input, kind = 'layers') {
    const job = jobs.create({ ...input, kind, count: 1, model: LAYER_MODEL });
    pump();
    return job;
  }

  function pump() {
    let all;
    try { all = jobs.list(); } catch (err) { logError('读任务列表失败', err); return; }
    const free = CONCURRENCY - running.size;
    const next = all.filter(job => KINDS.has(job.kind) && job.status === 'queued' && !running.has(job.id)).slice(0, Math.max(0, free));
    for (const job of next) {
      running.add(job.id);
      let stuck = false;
      const release = () => { running.delete(job.id); pump(); };
      run(job.id)
        .catch(err => {
          logError(`图层分离 ${job.id.slice(0, 8)} 出意外`, err);
          // 和出图排队（queue.mjs）一样：连「失败」都写不进硬盘（盘满、文件被占）时先占着位子、隔一会儿再放。
          // 马上放的话这单还是「排队中」，会在同一拍里被无限重挑，整个小服务卡死。
          try { finish(job.id, { status: 'failed', error: failure('UNKNOWN'), errorCode: 'UNKNOWN' }); }
          catch (writeError) { stuck = true; logError('图层分离的状态写不进硬盘，过一会儿再试', writeError); }
        })
        .finally(() => (stuck ? void setTimeout(release, retryMs).unref?.() : release()));
    }
  }

  function finish(id, changes) {
    jobs.patch(id, { ...changes, finishedAt: new Date().toISOString() });
  }

  function charge(job, count) {
    if (count > 0) spend.add({ yuan: Math.round(count * job.priceYuan * 100) / 100, model: job.model, jobId: job.id });
  }

  /** 唯一真花钱的地方。 */
  async function run(id) {
    const job = jobs.patch(id, { status: 'running', startedAt: new Date().toISOString() });
    if (!job) return;
    if (job.kind === 'layer-redraw') return runRedraw(job);
    const image = job.source?.type === 'upload' ? uploads.read(job.source.id) : works.read(job.source?.id);
    if (!image || image.kind !== 'image') return finish(id, { status: 'failed', error: failure('REF_MISSING'), errorCode: 'REF_MISSING' });
    let result;
    try {
      result = await split({ image, prompt: job.prompt });
    } catch (err) {
      const code = String(err?.message ?? '');
      return finish(id, { status: code === 'EDIT_INTERRUPTED' || code === 'EDIT_TIMEOUT' ? 'uncertain' : 'failed',
        error: failure(code), errorCode: code });
    }
    if (!result.ok) {
      charge(job, result.charged ?? 0);
      return finish(id, { status: 'failed', error: result.status ? `火山没接（${result.status}）：${result.message}` : result.message,
        errorCode: result.charged ? 'DOWNLOAD_FAILED' : 'REJECTED', yuan: Math.round((result.charged ?? 0) * job.priceYuan * 100) / 100 });
    }
    charge(job, result.count);
    const meta = { jobId: id, canvasId: job.canvasId, prompt: job.prompt, model: job.model, yuan: job.priceYuan, refs: [job.source] };
    const base = works.add(result.base.buffer, { ...meta, layer: { role: 'base', of: job.source } });
    const items = result.layers.map(layer => ({ work: works.add(layer.buffer, { ...meta, layer: { role: 'layer', of: job.source, name: layer.name, box: layer.box } }).id,
      name: layer.name, box: layer.box }));
    log(`[图层分离] ${id.slice(0, 8)} 拆出 ${items.length} 层`);
    finish(id, { status: 'succeeded', yuan: Math.round(result.count * job.priceYuan * 100) / 100, works: [base.id, ...items.map(item => item.work)],
      layers: { base: base.id, width: result.base.width, height: result.base.height, items } });
  }

  /** 图层重绘：只出一张，成功记一张的钱；失败不重发。 */
  async function runRedraw(job) {
    const image = works.read(job.from);
    if (!image || image.kind !== 'image') return finish(job.id, { status: 'failed', error: '原图层找不到了（可能被删了），这单没发出去。', errorCode: 'REF_MISSING' });
    let result;
    try {
      result = await redraw({ prompt: job.prompt, images: [image], size: job.size });
    } catch (err) {
      const code = String(err?.message ?? '');
      return finish(job.id, { status: code === 'EDIT_INTERRUPTED' || code === 'EDIT_TIMEOUT' ? 'uncertain' : 'failed',
        error: humanError(code), errorCode: code });
    }
    if (!result.ok) return finish(job.id, { status: 'failed', error: `火山没接（${result.status}）：${result.message}`, errorCode: 'REJECTED' });
    const work = works.add(result.image, { jobId: job.id, canvasId: job.canvasId, prompt: job.prompt, model: job.model, yuan: job.priceYuan,
      refs: [{ type: 'work', id: job.from }], layer: { role: 'layer', of: job.layerOf, name: job.name, redrawOf: job.from } });
    charge(job, 1);
    log(`[图层重绘] ${job.id.slice(0, 8)} 出好`);
    finish(job.id, { status: 'succeeded', yuan: job.priceYuan, works: [work.id], redraw: { from: job.from, work: work.id } });
  }

  /** 启动时：正在发的标「结果不明」，不重发。 */
  function recover() {
    let fixed = 0;
    for (const job of jobs.list()) {
      if (!KINDS.has(job.kind) || job.status !== 'running') continue;
      fixed += 1;
      finish(job.id, { status: 'uncertain', error: humanError('SERVER_RESTARTED'), errorCode: 'SERVER_RESTARTED' });
    }
    return fixed;
  }

  return { submit, pump, recover };
}
