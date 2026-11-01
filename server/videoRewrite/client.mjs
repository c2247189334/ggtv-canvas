import { streamTransport } from '../streamNet.mjs';
import { seedreamConfig } from '../seedream.mjs';
import { PRICE_PER_M, REWRITE_MODEL, redactRewriteError } from '../rewrite.mjs';
import { parseModelJson } from './modelJson.mjs';
import { readChatStream } from './stream.mjs';
import { humanNetworkError } from '../networkErrors.mjs';

// 10-30 窄拆解 + 6 张清楚大帧实测 ¥0.14~0.18（15 秒，三条视频 6 次）；30 秒多一张总览图推测再多约 ¥0.03，往高报。
// 看人物图（关思考、一张图约 1280 token + 问话、回话两三百字）按官方单价推算约 ¥0.02，往高报；真跑后按实收改。
export const ESTIMATES = Object.freeze({ analyzeYuan: 0.2, lookYuan: 0.03 });
// 官方深度思考文档：超时推荐 30 分钟及以上。流式下连续 5 分钟一个字节都没来，就当连接断了。
const TOTAL_MS = 30 * 60000, IDLE_MS = 5 * 60000;
const ENDINGS = { length: '豆包回话太长被截断（finish_reason=length），这轮作废。',
  content_filter: '豆包回话被内容审核拦下（finish_reason=content_filter）。' };

/** 流式回包整理成和非流式一样的形状；出错时方舟回的是普通 JSON，照旧整段读。 */
async function readReply(response, idleMs, networkFailure) {
  if (!/text\/event-stream/i.test(response.headers.get('content-type') ?? '')) {
    let raw;
    try { raw = Buffer.from(await response.arrayBuffer()).toString('utf8'); }
    catch (error) { throw networkFailure(error); }
    try { return { raw, payload: JSON.parse(raw) }; }
    catch { throw Error(`豆包回话不是合法JSON：${raw}`); }
  }
  let reply;
  try { reply = await readChatStream(response, { idleMs }); }
  catch (error) {
    if (/^豆包/.test(error?.message ?? '')) throw error;
    throw networkFailure(error);
  }
  return { raw: reply.content, streamed: true, finish: reply.finish,
    payload: { usage: reply.usage, error: reply.error, choices: [{ message: { content: reply.content } }] } };
}

/** 每轮一次请求；usage到手先记账，之后的JSON/结构校验失败也不会丢账。 */
export function createModel({ env = {}, fetch: suppliedFetch, onCharge = () => {}, onUnknown = () => {}, idleMs = IDLE_MS,
  logError = () => {} } = {}) {
  const fetch = suppliedFetch ?? streamTransport({ TOS_BUCKET: String(env.TOS_BUCKET ?? '').trim() });
  const networkFailure = error => {
    logError('豆包看图网络失败', Error(redactRewriteError(error?.stack ?? error?.message ?? error, env)));
    return Object.assign(Error(humanNetworkError(error, { timeoutMinutes: TOTAL_MS / 60000 })),
      error?.notSent === true ? { notSent: true } : {});
  };
  // detail：图片清晰度（拆解大图用 xhigh）；effort：思考档位（reasoning_effort）。不给就用模型默认。think: false 关思考（看人物图这种简单问题）。
  return async ({ text, images = [], detail, effort, think = true }) => {
    let sent = false, usageKnown = false;
    try {
      const cfg = seedreamConfig(env);
      if (images.length > 12) throw Error('单次看图最多12张，请减少需要核对的内容。');
      // 看图认东西要准（2.0 Pro 关思考两次把吊扇叶认错），视频改写开深度思考；「帮我改写」仍关。
      const body = { model: REWRITE_MODEL, thinking: { type: think ? 'enabled' : 'disabled' }, ...(effort ? { reasoning_effort: effort } : {}),
        stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content: [
          { type: 'text', text }, ...images.map(url => ({ type: 'image_url', image_url: { url, ...(detail ? { detail } : {}) } }))
        ] }] };
      sent = true;
      let response;
      try {
        response = await fetch(`${cfg.base}/chat/completions`, { method: 'POST', timeout: TOTAL_MS,
          headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch (error) { throw networkFailure(error); }
      const { raw, payload, streamed, finish } = await readReply(response, idleMs, networkFailure);
      const usage = { input_tokens: payload?.usage?.prompt_tokens, output_tokens: payload?.usage?.completion_tokens };
      usageKnown = Object.values(usage).every(n => Number.isSafeInteger(n) && n >= 0);
      if (usageKnown) await onCharge({ usage, model: REWRITE_MODEL,
        yuan: (usage.input_tokens * PRICE_PER_M.input + usage.output_tokens * PRICE_PER_M.output) / 1e6 });
      if (response.status < 200 || response.status >= 300) throw Error(payload?.error?.message || raw);
      if (payload?.error) throw Error(payload.error.message || JSON.stringify(payload.error));
      if (streamed && finish !== 'stop') throw Error(ENDINGS[finish]
        ?? (finish ? `豆包回话没有正常结束（finish_reason=${finish}）。` : '豆包回话中途断了，没有正常结束。'));
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw Error('豆包没有返回内容。');
      if (!usageKnown) throw Error(`豆包没返回有效token用量，无法确认这轮花费。原话：${content}`);
      const clean = redactRewriteError(content, env).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      try { return parseModelJson(clean); }
      catch { throw Error(`豆包回话不是合法JSON：${content}`); }
    } catch (error) {
      if (sent && !usageKnown && error?.notSent !== true) onUnknown();
      const message = error?.name === 'AbortError' ? `豆包 ${TOTAL_MS / 60000} 分钟还没答完，已停止等待。` : error?.message ?? error;
      throw Error(redactRewriteError(message, env));
    }
  };
}
