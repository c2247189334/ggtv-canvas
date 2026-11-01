// 本地显卡只有一个位置；先落盘，失败不重跑。
/** 10-31 用户：生成中的深度 / 白模要能停（删卡也会停）；停了花费照样是 0。 */
export const STOPPED_TEXT = '已停止，没有存进作品库，花费 0。';

export function createDepthQueue({ jobs, media }) {
  let running = false, stopped = false, gpuUnsafe = false, current = null;
  const finish = (id, change) => jobs.patch(id, { ...change, phase: null, finishedAt: new Date().toISOString() });
  const halted = id => finish(id, { status: 'failed', error: STOPPED_TEXT, errorCode: 'CANCELED', yuan: 0 });
  function pump() {
    if (running || stopped || gpuUnsafe) return;
    const job = jobs.list().find(j => ['depth', 'mesh'].includes(j.kind) && j.status === 'queued');
    if (!job) return;
    running = true;
    const controller = new AbortController(); current = { id: job.id, controller };
    jobs.patch(job.id, { status: 'running', phase: 'processing', startedAt: new Date().toISOString() });
    Promise.resolve().then(() => media[job.kind](job, { signal: controller.signal })).then(work => {
      finish(job.id, { status: 'succeeded', works: [work.id], yuan: 0 });
    }).catch(error => {
      if (error.gpuUnsafe) gpuUnsafe = true;
      if (controller.signal.aborted && !error.gpuUnsafe) halted(job.id);
      else finish(job.id, { status: 'failed', error: String(error.message), errorCode: job.kind === 'mesh' ? 'MESH_FAILED' : 'DEPTH_FAILED', yuan: 0 });
    }).finally(() => { running = false; current = null; pump(); });
  }
  function submit(input) {
    if (gpuUnsafe) throw Error('无法确认ComfyUI已停止，请先确认停止并重启小服务');
    const job = jobs.create({ ...input, kind: input.kind === 'mesh' ? 'mesh' : 'depth', count: 1 });
    pump(); return job;
  }
  /** 排队的直接撤（'stopped'）；在跑的发停止信号（'stopping'），算完收尾后标已停止；已结束或找不到返回 null。 */
  function cancel(id) {
    if (current?.id === id) { current.controller.abort(); return 'stopping'; }
    const job = jobs.list().find(j => j.id === id && ['depth', 'mesh'].includes(j.kind));
    if (job?.status !== 'queued') return null;
    halted(id); return 'stopped';
  }
  function recover() {
    let count = 0;
    for (const job of jobs.list()) if (['depth', 'mesh'].includes(job.kind) && job.status === 'running') {
      count++; finish(job.id, { status: 'failed', errorCode: 'SERVER_RESTARTED',
        error: '小服务中途关了，没算完，可以再点一次' });
    }
    return count;
  }
  return { submit, pump, cancel, recover, stop: () => { stopped = true; media.stop(); } };
}
