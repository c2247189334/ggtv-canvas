// 10-25 用户定换 2.1 Pro（2.0 Pro 官方标即将下线）；单价照方舟模型价格页在线推理：输入 6、输出 30 元 / 百万 token。
import { transport } from './net.mjs';
import { seedreamConfig } from './seedream.mjs';
import { MAX_PROMPT } from './jobInput.mjs';
import { humanNetworkError } from './networkErrors.mjs';

export const REWRITE_MODEL = 'doubao-seed-2-1-pro-260915';
export const PRICE_PER_M = Object.freeze({ input: 6, output: 30 });
// 沿用旧 src/domain/rewritePrompt.ts 的规则；接口只收文字和参考数量，不发送素材文件。
const RULES = [
  '先定位，再说改动。用位置和衣着这类看得准的特征指出要改的是画面里的哪一个（例：画面右侧、穿黑色外套的那个男孩）。不许靠帽子底下的头发、看不清的图案这类猜出来的细节定位。',
  '要改的那一处必须写具体，具体到出图模型能照着画：换人要写年龄段、性别、发型、穿搭、朝向；换背景要写场景、光线、时间；换材质要写颜色和质感。',
  '用户没说清的部分，你给一个合理的常见选择，直接写进指令。绝对不许写「另一个类似的」「换一个差不多的」这种含糊说法 —— 出图模型没法执行，只会自己乱编一个。',
  '除了用户要改的那一处，不许新增任何东西：不加人物、物体、文字、logo、水印，也不改画面风格。',
  '不许把未连接的图当成来源。已连接但你没看到的图，只能按用户的描述和引用编号改写，不许猜测图里的内容。',
  '保留清单要单独写成一句，另起一句用「保持不动：」开头，别缩在替换指令的屁股后面 —— 缩在后面模型会读丢。清单里只许写用户没要求改的东西：他点名要改哪一样（比如他说要改光线、要改 logo、要改商品本身），那一样就绝对不许出现在保留清单里，否则一句话里自己跟自己打架。他没提到的（画面里其余的东西、相机角度、构图、光线、颜色）才写进去。'
];
const OUTPUT = '只输出这一句指令本身：不要引号、不要代码围栏、不要解释、不要前言后语。';

export function checkRewriteInput(input) {
  if (typeof input?.prompt !== 'string' || !input.prompt.trim()) throw Error('先写一句你想要什么，再点改写。');
  const prompt = input.prompt.trim();
  if (prompt.length > MAX_PROMPT) throw Error(`提示词太长了（${prompt.length} 字），最多 ${MAX_PROMPT} 字。`);
  if (input.kind !== 'image' && input.kind !== 'video') throw Error('改写类型只能是 image 或 video。');
  const refs = { images: 0, videos: 0, audios: 0 };
  if (input.refs !== undefined) {
    if (!input.refs || typeof input.refs !== 'object' || Array.isArray(input.refs)) throw Error('参考数量必须是图片、视频、音频的非负整数。');
    for (const key of Object.keys(refs)) {
      const value = input.refs[key] ?? 0;
      if (!Number.isSafeInteger(value) || value < 0 || value > 1000) throw Error('参考数量必须是 0 到 1000 的整数。');
      refs[key] = value;
    }
  }
  return { prompt, kind: input.kind, refs };
}

export function redactRewriteError(value, env = {}) {
  const secrets = Object.entries(env).filter(([name]) => /KEY|SECRET|TOKEN|PASSWORD/i.test(name))
    .map(([, secret]) => String(secret ?? '').trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  return secrets.reduce((text, secret) => text.replaceAll(secret, '***'), String(value ?? ''));
}

function instruction({ prompt, kind, refs }) {
  const video = kind === 'video';
  const task = `你的任务：把用户随手写的需求，整理成一句清楚、能直接交给${video ? '视频' : '出图'}模型的中文指令。`;
  const names = (label, count) => Array.from({ length: count }, (_, i) => `@${label}${i + 1}`).join('、');
  const connected = [refs.images ? `已连入 ${refs.images} 张参考图（${names('图片', refs.images)}）` : '',
    refs.videos ? `已连入 ${refs.videos} 段参考视频（${names('视频', refs.videos)}）` : '',
    refs.audios ? `已连入 ${refs.audios} 段参考音频（${names('音频', refs.audios)}）` : ''].filter(Boolean).join('；');
  const context = connected ? `【参考情况】${connected}。这里只提供文字，没有向你发送图片、视频或音频文件，不许猜测参考内容。`
    : video ? '【参考情况】这里只提供文字，没有向你发送图片、视频或音频文件，不许猜测参考内容。'
      : '【图片情况】用户没传图，这是从零生成一张新图。';
  const rules = video ? RULES.map(text => text.replaceAll('出图模型', '视频模型')) : [...RULES];
  rules.push(`用户写的 @图片N、@视频N、@音频N 编号必须原样保留，不改名、不重排、不增删引用。${video ? '把动作、镜头和节奏写清楚。' : ''}`);
  rules.push(OUTPUT);
  return [task, context, ['【怎么写】', ...rules.map((text, index) => `${index + 1}. ${text}`)].join('\n')].join('\n\n') + `\n\n---\n\n${prompt}`;
}

function cleanReply(text) {
  let out = String(text ?? '').trim();
  const fence = out.match(/^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i);
  if (fence) out = fence[1].trim();
  const quoted = out.match(/^["'“”「『]([\s\S]*)["'”」』]$/);
  if (quoted) out = quoted[1].trim();
  return out;
}

/** 只发一次。任何失败原话先脱敏，成功按上游实际 token 用量计费。 */
export function createRewrite({ env = {}, fetch: suppliedFetch, logError = () => {} } = {}) {
  const fetch = suppliedFetch ?? transport({ TOS_BUCKET: String(env.TOS_BUCKET ?? '').trim() }).fetch;
  return async input => {
    const checked = checkRewriteInput(input);
    const cfg = seedreamConfig(env);
    const body = { model: REWRITE_MODEL, thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: [{ type: 'text', text: instruction(checked) }] }] };
    try {
      let response, raw;
      try {
        response = await fetch(`${cfg.base}/chat/completions`, { method: 'POST',
          headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: 180000 });
        raw = Buffer.from(await response.arrayBuffer()).toString('utf8');
      } catch (error) {
        logError('豆包文字改写网络失败', Error(redactRewriteError(error?.stack ?? error?.message ?? error, env)));
        throw Error(humanNetworkError(error, { timeoutMinutes: 3 }));
      }
      let payload;
      try { payload = JSON.parse(raw); } catch {
        throw Error(response.status >= 200 && response.status < 300 ? '火山改写回话不是合法的 JSON。' : raw);
      }
      if (response.status < 200 || response.status >= 300) throw Error(payload?.error?.message || raw);
      const content = payload?.choices?.[0]?.message?.content;
      const text = typeof content === 'string' ? cleanReply(content) : '';
      if (!text) throw Error('改写没有返回内容，直接用原文也行。');
      const usage = { input_tokens: payload?.usage?.prompt_tokens, output_tokens: payload?.usage?.completion_tokens };
      if (Object.values(usage).some(n => !Number.isSafeInteger(n) || n < 0)) throw Error('火山没返回有效的改写用量，无法确认花费。');
      const yuan = (usage.input_tokens * PRICE_PER_M.input + usage.output_tokens * PRICE_PER_M.output) / 1e6;
      return { text: redactRewriteError(text, env), model: REWRITE_MODEL, usage, yuan };
    } catch (error) { throw Error(redactRewriteError(error?.message ?? error, env)); }
  };
}

export async function fakeRewrite(input) {
  const { prompt } = checkRewriteInput(input);
  if (prompt.includes('假失败')) throw Error('假改写：按提示词拒绝这单。');
  return { text: `（假改写）${prompt}`, model: REWRITE_MODEL, usage: { input_tokens: 0, output_tokens: 0 }, yuan: 0 };
}
