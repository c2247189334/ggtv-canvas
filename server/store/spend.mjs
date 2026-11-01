// 花费流水：每出成一张记一行 <数据>/花费.jsonl。只加不改 —— 删作品不影响「今天花了多少」。
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 本地时间的 年-月-日。 */
export function dayKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function createSpendLog(dataRoot) {
  const file = join(dataRoot, '花费.jsonl');

  function add({ yuan, model, jobId, at = new Date() }) {
    mkdirSync(dataRoot, { recursive: true });
    appendFileSync(file, JSON.stringify({ at: at.toISOString(), yuan, model, jobId }) + '\n', 'utf8');
  }

  /** 某一天（默认今天）一共花了多少，保留两位小数。 */
  function totalOn(date = new Date()) {
    if (!existsSync(file)) return 0;
    const key = dayKey(date);
    let sum = 0;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (dayKey(new Date(row.at)) === key) sum += Number(row.yuan) || 0;
      } catch {
        /* 坏行跳过 */
      }
    }
    return Math.round(sum * 100) / 100;
  }

  return { add, totalOn };
}
