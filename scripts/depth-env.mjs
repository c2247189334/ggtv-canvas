import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export function updateDepthEnv(root, values, log = () => {}) {
  const file = join(root, '.env.local'), template = join(root, '.env.example');
  if (!existsSync(file) && !existsSync(template)) throw Error('缺少 .env.example 模板，无法补深度配置。');
  const original = readFileSync(existsSync(file) ? file : template, 'utf8');
  let text = original.replace(/^\uFEFF/, '');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const current = parseEnv(text);
  for (const key of ['DEPTH_PYTHON', 'DEPTH_MODEL_DIR']) {
    const value = values[key];
    if (value === undefined) continue;
    if (/[\r\n\u0000#'"]/.test(value)) throw Error(`${key} 的路径含不支持的字符，请换一个安装目录。`);
    const existing = current[key]?.trim();
    if (existing && !existing.startsWith('请')) {
      if (existing !== value) log(`${key} 已有配置，没改；要用新装的，把它改成 ${key}=${value}`);
      continue;
    }
    const line = new RegExp(`^(?:export[ \\t]+)?${key}[ \\t]*=[^\\r\\n]*`, 'gm');
    if (line.test(text)) text = text.replace(line, () => `${key}=${value}`);
    else text += `${text && !text.endsWith('\n') ? newline : ''}${key}=${value}${newline}`;
    log(`已补 ${key}。`);
  }
  if (!existsSync(file) || text !== original) writeFileSync(file, text, 'utf8');
}
