/** 只修格式：取完整外层对象、转义字符串里的真实控制字符；不补括号、不猜缺失内容。 */
export function parseModelJson(text) {
  try { return JSON.parse(text); }
  catch (strictError) {
    const start = text.indexOf('{');
    if (start < 0 || /[\[\]}]/.test(text.slice(0, start))) throw strictError;
    let depth = 0, quoted = false, escaped = false, fixed = '';
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        // 已有的转义原样保留；裸控制字符按JSON编码后，解析结果仍是真换行/回车/制表符。
        if (char.charCodeAt(0) < 32) {
          fixed += JSON.stringify(char).slice(1, -1);
          continue;
        }
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}') depth--;
      fixed += char;
      if (!quoted && depth === 0) {
        // 多个对象含义不明确，不擅自选择其中一个。
        if (/[{}\[\]]/.test(text.slice(i + 1))) throw strictError;
        return JSON.parse(fixed);
      }
    }
    throw strictError;
  }
}
