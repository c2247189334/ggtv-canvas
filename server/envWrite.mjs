// 设置面板「填 Key」：把用户在页面上填的几项写进 .env.local（11-17 用户定，普通人不用自己开记事本）。
// 只认下面 4 个名字；空着的那项不动；别的配置原样保留；绝不回传值、不写日志。
import { existsSync, readFileSync } from 'node:fs';
import { keyFilled, readEnvAt, tosFilled } from './config.mjs';
import { writeTextAtomic } from './store/files.mjs';

export const KEY_FIELDS = Object.freeze({
  ARK_API_KEY: '火山方舟 API Key',
  TOS_ACCESS_KEY_ID: 'TOS Access Key ID',
  TOS_SECRET_ACCESS_KEY: 'TOS Secret Access Key',
  TOS_BUCKET: 'TOS 桶名'
});

const MAX_LENGTH = 512;
// 密钥和桶名只会是可见的英文字符；空格、引号、#、反斜杠多半是复制时带进来的，而且写进 .env.local 会被读歪。
const SAFE = /^[\x21-\x7e]+$/;
const RISKY = /[#"'`\\]/;

/** 检查页面交来的内容：只收这 4 项、都是字符串；空的去掉。不合格抛一句人话（不带值本身）。 */
export function checkKeyValues(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('要填的内容格式不对。');
  const values = {};
  for (const [name, raw] of Object.entries(body)) {
    if (!Object.hasOwn(KEY_FIELDS, name)) throw Error(`不认识「${name}」这一项，只能填火山 Key 和 TOS 三项。`);
    if (typeof raw !== 'string') throw Error(`「${KEY_FIELDS[name]}」要填一段文字。`);
    const value = raw.trim();
    if (!value) continue;
    if (value.length > MAX_LENGTH || !SAFE.test(value) || RISKY.test(value)) {
      throw Error(`「${KEY_FIELDS[name]}」里有空格、中文、引号或 # 这类字符，可能复制时多带了东西，检查一下再填。`);
    }
    values[name] = value;
  }
  if (!Object.keys(values).length) throw Error('什么都没填，没有保存。');
  return values;
}

const lineOf = name => new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=.*$`, 'gm');

/** 把 values 写进文本：已有这一行就整行换掉（重复的几行都换），没有就加在最后。 */
export function mergeEnvText(text, values) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let next = text;
  for (const [name, value] of Object.entries(values)) {
    const pattern = lineOf(name), line = `${name}=${value}`;
    if (pattern.test(next)) next = next.replace(lineOf(name), () => line);
    else next = `${next}${next && !next.endsWith('\n') ? eol : ''}${line}${eol}`;
  }
  return next;
}

/**
 * 写 .env.local：文件没有就照 .env.example 抄一份再填（其余提示文字留着，以后手改也方便）。
 * 写完立刻读回核对；读回来对不上就把原文件放回去再报错。只回「填没填」，不回值。
 */
export function saveKeys(file, body, { template } = {}) {
  const values = checkKeyValues(body);
  const existed = existsSync(file);
  const before = existed ? readFileSync(file, 'utf8') : (template && existsSync(template) ? readFileSync(template, 'utf8') : '');
  writeTextAtomic(file, mergeEnvText(before, values));
  const env = readEnvAt(file);
  if (Object.entries(values).some(([name, value]) => env[name] !== value)) {
    if (existed) writeTextAtomic(file, before);
    throw Error('写进 .env.local 后读回来对不上，已经放回原样。可以用记事本打开 .env.local 手动填。');
  }
  return { saved: Object.keys(values), keyReady: keyFilled(env), tosReady: tosFilled(env) };
}
