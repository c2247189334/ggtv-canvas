// 本地显卡只有一个位置：深度、白模按交单先后一次只跑一单；先落盘，失败不重跑。
/** 10-31 用户：生成中的深度 / 白模要能停（删卡也会停）；停了花费照样是 0。 */
export const STOPPED_TEXT = '已停止，没有存进作品库。';

const FAILED_CODES = { depth: 'DEPTH_FAILED', mesh: 'MESH_FAILED' };
const isGpuJob = job => Object.hasOwn(FAILED_CODES, job?.kind ?? '');

export function createDepthQueue({ jobs, media }) {
  let running = false, stopped = false, gpuUnsafe = false, current = null;
  const canceledCanvases = new Set();
  const queued = () => jobs.list().filter(job => isGpuJob(job) && job.status === 'queued').sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt)) || (a.queueSequence ?? 0) - (b.queueSequence ?? 0));
  const finish = (id, change) => jobs.patch(id, { ...change, phase: null, finishedAt: new Date().toISOString() });
  const halted = id => finish(id, { status: 'failed', error: STOPPED_TEXT, errorCode: 'CANCELED', yuan: 0 });
  function pump() {
    if (running || stopped || gpuUnsafe) return;
    const job = queued()[0];
    if (!job) return;
    running = true;
    const controller = new AbortController(); current = { id: job.id, controller };
    jobs.patch(job.id, { status: 'running', phase: 'processing', startedAt: new Date().toISOString() });
    Promise.resolve().then(() => media[job.kind](job, { signal: controller.signal })).then(work => {
      finish(job.id, { status: 'succeeded', works: [work.id], yuan: 0 });
    }).catch(error => {
      if (error.gpuUnsafe) gpuUnsafe = true;
      if (controller.signal.aborted && !error.gpuUnsafe) halted(job.id);
      else finish(job.id, { status: 'failed', error: String(error.message), errorCode: FAILED_CODES[job.kind], yuan: 0 });
    }).finally(() => { running = false; current = null; pump(); });
  }
  function submit(input) {
    if (canceledCanvases.has(input.canvasId)) throw Error('这张画布已经删除，不能交单');
    if (gpuUnsafe) throw Error('无法确认ComfyUI已停止，请先确认停止并重启小服务');
    const queueSequence = Math.max(0, ...jobs.list().map(job => job.queueSequence ?? 0)) + 1;
    const job = jobs.create({ ...input, kind: input.kind === 'mesh' ? 'mesh' : 'depth', count: 1, queueSequence });
    pump(); return job;
  }
  /** 排队的直接撤（'stopped'）；在跑的发停止信号（'stopping'），算完收尾后标已停止；已结束或找不到返回 null。 */
  function cancel(id) {
    if (current?.id === id) { current.controller.abort(); return 'stopping'; }
    const job = jobs.read(id);
    if (!isGpuJob(job) || job.status !== 'queued') return null;
    halted(id); return 'stopped';
  }
  /** 删画布时：这张画布排着的撤掉、在跑的停掉，之后迟到的交单也拒收。 */
  function cancelCanvas(canvasId) {
    canceledCanvases.add(canvasId);
    for (const job of jobs.list()) if (isGpuJob(job) && job.canvasId === canvasId && ['queued', 'running'].includes(job.status)) cancel(job.id);
  }
  function recover() {
    let count = 0;
    for (const job of jobs.list()) if (isGpuJob(job) && job.status === 'running') {
      count++; finish(job.id, { status: 'failed', errorCode: 'SERVER_RESTARTED',
        error: '小服务中途关了，没算完，可以再点一次' });
    }
    return count;
  }
  return { submit, pump, cancel, recover, queued, cancelCanvas, stop: () => { stopped = true; media.stop(); } };
}
