// Seedance 只发一次建任务；查询与下载是只读操作，由排队决定何时重试。
import { seedreamConfig } from './seedream.mjs';
import { transport } from './net.mjs';

const MAX_BODY = 64 * 1024 * 1024;
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value);

export function buildSeedanceBody({ model, prompt, mode, images = [], videos = [], audios = [], ratio, resolution, duration, audio = true, taskType }) {
  if (taskType !== undefined && taskType !== 'reference') throw Object.assign(Error('任务类型只接受 reference。'), { notSent: true });
  if (taskType !== undefined && model !== 'doubao-seedance-2-5-260628') throw Object.assign(Error('任务类型只对 Seedance 2.5 有效。'), { notSent: true });
  if (videos.some(({ url }) => typeof url !== 'string' || !/^(https?:\/\/|asset:\/\/)/.test(url))) {
    throw Object.assign(Error('SEEDANCE_VIDEO_URL_INVALID：这单没发出去，没花钱。'), { notSent: true });
  }
  return {
    model, content: [
      { type: 'text', text: prompt },
      ...images.map((image) => ({ type: 'image_url', image_url: { url: image.asset ? `asset://${image.asset}` :
        `data:${String(image.contentType ?? 'image/png').toLowerCase()};base64,${Buffer.from(image.buffer ?? []).toString('base64')}` },
      role: mode === 'first_frame' ? 'first_frame' : 'reference_image' })),
      ...videos.map(({ url }) => ({ type: 'video_url', video_url: { url }, role: 'reference_video' })),
      ...audios.map(({ contentType, buffer }) => ({ type: 'audio_url', audio_url: {
        url: `data:${contentType};base64,${Buffer.from(buffer ?? []).toString('base64')}` }, role: 'reference_audio' }))
    ], ratio, resolution, duration, generate_audio: audio, watermark: false,
    ...(taskType === undefined ? {} : { omni_reference_task_type: taskType })
  };
}

export function humanSeedanceError({ code = '', message = '', blocked = [], outcome = 'rejected' }) {
  if (outcome === 'notSent') return '这单没发出去，没花钱。';
  if (outcome === 'uncertain') return '可能已建任务并扣费，没有自动重发，去火山控制台视频任务列表看一眼。';
  const refs = blocked.length ? `${blocked.map((n) => `参考 ${n}`).join('、')} 被火山拦下：` : '';
  let reason = message || '火山明确不收这单。';
  if (code.includes('PrivacyInformation')) reason = '疑似含真人（火山不收真人照片 / 真人视频，可改用真人素材编号）。';
  // 除 PrivacyInformation 外的 Input*SensitiveContentDetected* 尚未经真实火山实测。
  else if (/^Input.*SensitiveContentDetected/.test(code)) reason = '内容没过火山审核。';
  return `${refs}${reason} 火山没建任务，没扣钱。`;
}

/** 环境只留闭包里；任何上游错误文本和查询字段都先脱敏再交给排队。 */
// 建任务的请求体带 base64 图和声音（10-26 真测 8MB），本机上传约 45KB/秒，60 秒传不完会被掐成「结果不明」，所以单给 10 分钟。
export function createSeedance({ env = {}, fetch: suppliedFetch, timeout = 60000, submitTimeout = 600000 } = {}) {
  const secrets = ['ARK_API_KEY', 'TOS_ACCESS_KEY_ID', 'TOS_SECRET_ACCESS_KEY'].map((name) => String(env[name] ?? '').trim()).filter(Boolean);
  const clean = (value) => secrets.reduce((text, secret) => text.replaceAll(secret, '***'), String(value ?? ''));
  const safeTime = (value) => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' ? clean(value) : undefined;
  const fetch = suppliedFetch ?? transport({ TOS_BUCKET: String(env.TOS_BUCKET ?? '').trim() }).fetch;
  const result = (outcome, code = '', rawMessage = '', blocked = []) => ({ ok: false, outcome, code, rawMessage, blocked,
    message: humanSeedanceError({ code, message: rawMessage, blocked, outcome }) });
  async function json(response) {
    const raw = Buffer.from(await response.arrayBuffer()).toString('utf8');
    try { return JSON.parse(raw); } catch { return { error: { message: raw } }; }
  }
  return {
    async submit(input) {
      let cfg;
      try { cfg = seedreamConfig(env); } catch { return result('notSent', 'ARK_KEY_MISSING'); }
      const body = Buffer.from(JSON.stringify(buildSeedanceBody(input)));
      if (body.length > MAX_BODY) throw Object.assign(Error('SEEDANCE_BODY_TOO_LARGE：这单没发出去，没花钱。'), { notSent: true });
      let response;
      try {
        response = await fetch(`${cfg.base}/contents/generations/tasks`, { method: 'POST',
          headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' }, body, timeout: submitTimeout });
      } catch (error) { return result(error?.notSent ? 'notSent' : 'uncertain'); }
      let payload;
      try { payload = await json(response); } catch {
        return result(response.status >= 400 && response.status < 500 ? 'rejected' : 'uncertain');
      }
      if (response.status >= 200 && response.status < 300 && validId(payload?.id) && clean(payload.id) === payload.id) {
        return { ok: true, taskId: payload.id };
      }
      const code = clean(payload?.error?.code);
      const rawMessage = clean(payload?.error?.message);
      const blocked = [...new Set([...rawMessage.matchAll(/content\[(\d+)\]/g)].map((match) => Number(match[1])).filter((n) => n > 0))];
      return result(response.status >= 400 && response.status < 500 ? 'rejected' : 'uncertain', code, rawMessage, blocked);
    },
    async query(taskId) {
      try {
        if (!validId(taskId)) throw Error();
        const cfg = seedreamConfig(env);
        const response = await fetch(`${cfg.base}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${cfg.key}` }, timeout
        });
        if (response.status < 200 || response.status >= 300) throw Error();
        const payload = await json(response);
        return { status: clean(payload.status), content: { video_url: clean(payload.content?.video_url) },
          usage: { completion_tokens: typeof payload.usage?.completion_tokens === 'number' && Number.isFinite(payload.usage.completion_tokens) ? payload.usage.completion_tokens : undefined },
          error: { code: clean(payload.error?.code), message: clean(payload.error?.message) },
          updated_at: safeTime(payload.updated_at), created_at: safeTime(payload.created_at),
          finished_at: safeTime(payload.finished_at), completed_at: safeTime(payload.completed_at) };
      } catch { throw Error('SEEDANCE_QUERY_FAILED'); }
    },
    async download(url) {
      let bytes;
      try {
        const response = await fetch(url, { timeout });
        if (response.status < 200 || response.status >= 300) throw Error();
        bytes = Buffer.from(await response.arrayBuffer());
      } catch { throw Error('SEEDANCE_DOWNLOAD_FAILED'); }
      if (bytes.length < 8 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') throw Error('SEEDANCE_DOWNLOAD_INVALID');
      return bytes;
    }
  };
}
