// 出图任务：一单一个文件 <数据>/任务/<编号>.json。先落盘再发火山，刷新 / 关浏览器都不丢。
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isId, newId, readJsonSafe, writeJsonAtomic } from './files.mjs';

export function createJobStore(dataRoot, { now = () => new Date() } = {}) {
  const dir = join(dataRoot, '任务');
  const file = (id) => join(dir, `${id}.json`);

  function read(id) {
    return isId(id) ? readJsonSafe(file(id)) : null;
  }

  function create(input) {
    const job = {
      ...input,
      id: newId(),
      createdAt: now().toISOString(),
      status: 'queued',
      startedAt: null,
      finishedAt: null,
      works: [],
      error: null,
      errorCode: null
    };
    writeJsonAtomic(file(job.id), job);
    return job;
  }

  /** 改几个字段写回去。单子不在了返回 null。 */
  function patch(id, changes) {
    const job = read(id);
    if (!job) return null;
    const next = { ...job, ...changes };
    writeJsonAtomic(file(id), next);
    return next;
  }

  /** 先来的在前。单子是几百条的量级，每次重扫足够快。 */
  function list() {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json') && isId(name.slice(0, -5)))
      .map((name) => read(name.slice(0, -5)))
      .filter(Boolean)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  return { create, read, patch, list };
}
