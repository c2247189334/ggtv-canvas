// 假火山与真客户端保持形状一致；只有内存任务与已存在的 MP4 fixture，不联网。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { estimateVideo } from './videoModels.mjs';
import { humanSeedanceError } from './seedance.mjs';

export function createFakeSeedance({ delayMs = 1500, now = () => Date.now() } = {}) {
  const tasks = new Map();
  let made = 0;
  const rejected = (code, rawMessage, blocked = []) => ({ ok: false, outcome: 'rejected', code, rawMessage, blocked,
    message: humanSeedanceError({ code, message: rawMessage, blocked }) });
  return {
    async uploadVideo({ buffer }) {
      return `https://fake-seedance.invalid/reference-${createHash('sha256').update(buffer).digest('hex')}.mp4`;
    },
    async submit(input) {
      const prompt = String(input.prompt ?? '');
      if (prompt.includes('假被拦')) return rejected('InputImageSensitiveContentDetected.PrivacyInformation', 'content[1] 被拦。', [1]);
      if (prompt.includes('假失败')) return rejected('InvalidParameter', '假火山：按提示词拒绝这单。');
      if (prompt.includes('假超时')) return { ok: false, outcome: 'uncertain', code: '', blocked: [],
        message: humanSeedanceError({ outcome: 'uncertain' }) };
      const taskId = `fake-video-${++made}`;
      tasks.set(taskId, { input, started: Number(now()), queries: 0 });
      return { ok: true, taskId };
    },
    async query(taskId) {
      const task = tasks.get(taskId);
      if (!task) throw Error('SEEDANCE_QUERY_FAILED');
      task.queries += 1;
      if (task.queries === 1) return { status: 'queued' };
      if (task.queries === 2 || Number(now()) - task.started < delayMs) return { status: 'running' };
      if (String(task.input.prompt).includes('假任务失败')) return { status: 'failed', error: { code: 'FakeGenerationFailed', message: '假火山：视频生成失败。' } };
      return { status: 'succeeded', content: { video_url: `https://fake-seedance.invalid/${taskId}.mp4` },
        usage: { completion_tokens: estimateVideo(task.input).tokens } };
    },
    async download() {
      return readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url));
    }
  };
}
