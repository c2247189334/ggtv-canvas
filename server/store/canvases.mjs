// 画布：一张一个文件 <数据>/画布/<编号>.json。整份存整份读。
// 保存必须带读档时的版本，避免两个标签页静默覆盖。
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isId, newId, readJsonSafe, writeJsonAtomic } from './files.mjs';

export const MAX_NAME = 40;
export class CanvasConflict extends Error {
  constructor() { super('这张画布在别的标签页改过了，刷新页面后再继续改'); }
}

/** 名字：去首尾空白、截到 40 字；空的叫「未命名画布」。 */
export function cleanName(raw) {
  const name = String(raw ?? '').trim().slice(0, MAX_NAME);
  return name || '未命名画布';
}

export function createCanvasStore(dataRoot, { now = () => new Date() } = {}) {
  const dir = join(dataRoot, '画布');
  const file = (id) => join(dir, `${id}.json`);

  function read(id) {
    const doc = isId(id) ? readJsonSafe(file(id)) : null;
    return doc ? { ...doc, version: Number.isSafeInteger(doc.version) && doc.version >= 0 ? doc.version : 0 } : null;
  }

  function list() {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json') && isId(name.slice(0, -5)))
      .map((name) => read(name.slice(0, -5)))
      .filter(Boolean)
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  /** 所有画布的完整存档（收拾没人用的传的图时用）。有一份读坏了就返回 null，调用方据此一张都不删。 */
  function docs() {
    if (!existsSync(dir)) return [];
    const all = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json') || !isId(name.slice(0, -5))) continue;
      const doc = read(name.slice(0, -5));
      if (!doc) return null;
      all.push(doc);
    }
    return all;
  }

  function create(name) {
    const time = now().toISOString();
    const doc = { id: newId(), name: cleanName(name), createdAt: time, updatedAt: time, version: 0, nodes: [], edges: [] };
    writeJsonAtomic(file(doc.id), doc);
    return doc;
  }

  /** 存整份。画布不存在（比如刚被删了）返回 null，不会凭空建出来。卡片内容由页面负责，这里只管外形。 */
  function save(id, body) {
    const old = read(id);
    if (!old) return null;
    if (!Number.isSafeInteger(body?.baseVersion) || body.baseVersion !== old.version) throw new CanvasConflict();
    const doc = {
      id,
      version: old.version + 1,
      name: cleanName(body?.name),
      createdAt: old.createdAt,
      updatedAt: now().toISOString(),
      nodes: Array.isArray(body?.nodes) ? body.nodes : [],
      edges: Array.isArray(body?.edges) ? body.edges : []
    };
    writeJsonAtomic(file(id), doc);
    return doc;
  }

  function remove(id) {
    if (!read(id)) return false;
    rmSync(file(id), { force: true });
    return true;
  }

  return { list, docs, create, read, save, remove };
}
