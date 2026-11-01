// 出错时同时写到黑窗口和 日志/服务端.log。黑窗口关了就什么都没了，文件里的才能事后查。
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createLogger(logDir) {
  return function logError(tag, err) {
    const detail = err && err.stack ? err.stack : String(err);
    console.error('[出错]', tag, err && err.message ? err.message : err);
    try {
      mkdirSync(logDir, { recursive: true });
      const time = new Date().toLocaleString('zh-CN', { hour12: false });
      appendFileSync(join(logDir, '服务端.log'), `[${time}] ${tag}\n${detail}\n\n`);
    } catch {
      /* 日志写不进去也不能把服务拖死 */
    }
  };
}
