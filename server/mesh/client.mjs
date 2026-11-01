import { stoppedError } from '../depth/executor.mjs';
export const DEFAULT_COMFYUI_URL = 'http://127.0.0.1:8188';
export const MESH_WAIT_MS = 30 * 60 * 1000;
export const CANCEL_WAIT_MS = 30 * 1000;
export const MODEL_FILES = [
  ['checkpoints', 'sam3.1_multiplex_fp16.safetensors'],
  ['detection', 'sam_3d_body_dinov3_bf16.safetensors'],
  ['diffusion_models', 'rt_detr_v4-x-hgnet_fp32.safetensors'],
  ['geometry_estimation', 'moge_2_vitl_normal_fp16.safetensors'],
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function comfyUrl(value = DEFAULT_COMFYUI_URL) {
  let url;
  try { url = new URL(value || DEFAULT_COMFYUI_URL); }
  catch { throw Error('COMFYUI_URL 只允许 HTTP 本机地址 127.0.0.1 / localhost / [::1]。'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw Error('COMFYUI_URL 只允许 HTTP 本机地址 127.0.0.1 / localhost / [::1]。');
  }
  return url;
}

/** SaveVideo 的 history 字段未由本机源码确认；按文件描述符递归容错，只选视频。 */
export function historyVideo(outputs) {
  function find(value) {
    if (!value || typeof value !== 'object') return null;
    if (typeof value.filename === 'string' && /\.(mp4|webm|mov|mkv)$/i.test(value.filename)) {
      return { filename: value.filename, subfolder: value.subfolder ?? '', type: value.type ?? 'output' };
    }
    for (const nested of Object.values(value)) { const result = find(nested); if (result) return result; }
    return null;
  }
  const output = find(outputs?.['21s']);
  if (!output) throw Error('ComfyUI 已完成，但没有找到白模视频输出。');
  return output;
}

export function createComfyClient({ url, fetch: request = globalThis.fetch, sleep = pause, now = Date.now,
  timeoutMs = MESH_WAIT_MS, requestTimeoutMs = 15000, cancelTimeoutMs = CANCEL_WAIT_MS } = {}) {
  const base = comfyUrl(url);
  async function send(path, { method = 'GET', body, binary = false, timeout = requestTimeoutMs } = {}) {
    let response;
    try {
      response = await request(new URL(path, base), { method, redirect: 'error', signal: AbortSignal.timeout(timeout),
        ...(body instanceof FormData ? { body } : body === undefined ? {} :
          { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    } catch (error) { throw Error(`${error.name === 'TimeoutError' ? 'ComfyUI 请求超时' : '连不上 ComfyUI'}：${error.message}`); }
    if (binary && response.ok) return Buffer.from(await response.arrayBuffer());
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { throw Object.assign(Error(`ComfyUI 返回内容不是 JSON：${raw.slice(-2048)}`), { httpStatus: response.status }); }
    if (!response.ok || data.node_errors && Object.keys(data.node_errors).length) {
      throw Object.assign(Error(`ComfyUI ${path === '/prompt' ? '交工作流' : '请求'}失败（${response.status}）：${JSON.stringify(data)}`),
        { httpStatus: response.status, nodeRejected: Boolean(data.node_errors && Object.keys(data.node_errors).length) });
    }
    return data;
  }
  async function check() {
    let nodes;
    try { nodes = await send('/object_info/SAM3DBody_Render'); }
    catch (error) {
      if (error.httpStatus === 404) throw Error('这个地址上的 ComfyUI 没有白模节点，请检查端口。');
      throw error;
    }
    if (!nodes?.SAM3DBody_Render) throw Error('这个地址上的 ComfyUI 没有白模节点，请检查端口。');
    for (const [folder, name] of MODEL_FILES) {
      const models = await send(`/models/${folder}`);
      if (!Array.isArray(models) || !models.includes(name)) throw Error(`白模缺少模型：${folder}/${name}`);
    }
  }
  async function upload(buffer, name) {
    const body = new FormData(); body.set('image', new Blob([buffer], { type: 'video/mp4' }), name);
    body.set('overwrite', 'true'); body.set('type', 'input');
    const saved = await send('/upload/image', { method: 'POST', body });
    if (typeof saved.name !== 'string' || !saved.name) throw Error('ComfyUI 上传没有返回文件名。');
    return saved.subfolder ? `${saved.subfolder}/${saved.name}` : saved.name;
  }
  async function submit(prompt, clientId) {
    try {
      const result = await send('/prompt', { method: 'POST', body: { prompt, client_id: clientId } });
      if (typeof result.prompt_id !== 'string' || !result.prompt_id) throw Error('ComfyUI 交工作流没有返回单号。');
      return result.prompt_id;
    } catch (error) {
      // 已明确拒收可以释放本机队列；响应不明时没有 prompt_id，不能全局中断用户的其他活。
      if (error.nodeRejected || error.httpStatus >= 400 && error.httpStatus < 500) throw error;
      throw Object.assign(Error(`${error.message}\n无法确认 ComfyUI 是否接单，本机显卡队列已暂停；确认停止后请重启小服务。`), { gpuUnsafe: true });
    }
  }
  const historyPath = id => `/history/${encodeURIComponent(id)}`;
  const terminal = result => result?.status?.completed || ['success', 'error'].includes(result?.status?.status_str) ||
    (result?.status?.messages ?? []).some(message => ['execution_error', 'execution_interrupted'].includes(message[0]));
  async function interruptAndConfirm(id) {
    const notes = [];
    try { await send('/interrupt', { method: 'POST', body: {} }); }
    catch (error) { notes.push(error.message); }
    const end = now() + cancelTimeoutMs;
    while (now() < end) {
      try {
        const history = await send(historyPath(id), { timeout: Math.max(1, Math.min(requestTimeoutMs, end - now())) });
        if (terminal(history[id])) return;
      } catch (error) { notes.push(error.message); break; }
      await sleep(Math.min(2000, Math.max(0, end - now())));
    }
    throw Object.assign(Error(`无法确认 ComfyUI 已停止，本机显卡队列已暂停；确认停止后请重启小服务。${notes.length ? `\n${notes.join('\n')}` : ''}`), { gpuUnsafe: true });
  }
  /** signal：用户点停止时中断 ComfyUI、确认停下再报已停止；确认不了照旧暂停显卡队列。 */
  async function wait(id, { signal } = {}) {
    const end = now() + timeoutMs;
    let finished = false;
    try {
      while (now() < end) {
        if (signal?.aborted) { await interruptAndConfirm(id); finished = true; throw stoppedError(); }
        const history = await send(historyPath(id), { timeout: Math.max(1, Math.min(requestTimeoutMs, end - now())) });
        const result = history[id], messages = result?.status?.messages ?? [];
        finished = Boolean(terminal(result));
        if (result?.status?.status_str === 'error' || messages.some(message => ['execution_error', 'execution_interrupted'].includes(message[0]))) {
          throw Error(`ComfyUI 执行失败：${JSON.stringify(messages)}`);
        }
        if (finished) return historyVideo(result.outputs);
        await sleep(Math.min(2000, Math.max(0, end - now())));
      }
      throw Error('白模计算等待超时，没有自动重跑。');
    } catch (error) {
      const reason = now() >= end && !error.message.includes('白模计算等待超时')
        ? Error(`白模计算等待超时，没有自动重跑。\n${error.message}`) : error;
      if (!finished) {
        try { await interruptAndConfirm(id); }
        catch (cancel) { throw Object.assign(Error(`${reason.message}\n${cancel.message}`), { gpuUnsafe: true }); }
      }
      throw reason;
    }
  }
  return { base, send, check, upload, submit, wait,
    stats: () => send('/system_stats', { timeout: 2000 }),
    interruptAndConfirm,
    download: output => send(`/view?${new URLSearchParams(output)}`, { binary: true }),
    free: () => send('/free', { method: 'POST', body: { unload_models: true, free_memory: true } }),
  };
}
