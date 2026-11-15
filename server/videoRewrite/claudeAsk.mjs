// 本机 agent 回答拆解和看图：图写进临时目录让它 Read，回话按 modelJson 的规则解析，花费记 0。
// 11-03 实测（档案 11-03）：同题同图 sonnet 9～22 秒；80 帧总览大图 Read 会缩到 2000 宽，结果没变。
import { parseModelJson } from './modelJson.mjs';

export const ASK_SYSTEM = '你是视频拆解员。用户会告诉你图片在当前目录里叫什么，先用 Read 工具把每一张都看完，再严格按用户的要求回答。'
  + '只输出一个 JSON 对象，不要别的文字、不要代码围栏。看不清、拿不准的写进 unsure，不要按常识猜。';

/** 拆解：前几张是总览大图、后几张是清楚大图（提问里写了「另附N张」）；看人物图：按顺序编号。 */
export function imageNames(round, count, text = '') {
  if (round === 'look') return Array.from({ length: count }, (_, i) => `人物图-${i + 1}.jpg`);
  if (round === 'product-look') return Array.from({ length: count }, (_, i) => `商品图-${i + 1}.jpg`);
  const big = Number((text.match(/另附(\d+)张/) ?? [])[1] ?? 0), sheets = Math.max(0, count - big);
  return Array.from({ length: count }, (_, i) => (i < sheets ? `总览大图-${i + 1}.jpg` : `清楚大图-${i - sheets + 1}.jpg`));
}

export function askPrompt(names, text) {
  const list = names.length ? `图片都在当前目录：${names.join('、')}（按编号顺序对应提问里的图）。先用 Read 逐张看完，再按下面要求回答。\n\n` : '';
  return `${list}${text}`;
}

/** ask({ round, text, images }) → 解析好的 JSON；每次调用记一行 0 元账。 */
export function createClaudeAsk({ call, model, name = 'Claude', onCharge = () => {} }) {
  return async ({ round, text, images = [] }) => {
    const names = imageNames(round, images.length, text);
    const files = names.map((name, i) => ({ name, buffer: Buffer.from(String(images[i]).split(',')[1] ?? '', 'base64') }));
    const reply = await call({ system: ASK_SYSTEM, prompt: askPrompt(names, text), files, model });
    await onCharge({ usage: reply.usage, model: reply.model || `claude-${model}`, yuan: 0 });
    try { return parseModelJson(reply.text); }
    catch { throw Error(`${name} 回话不是合法JSON：${reply.text}`); }
  };
}
