// 「我上传的」清单：<数据>/上传记录.json（不放进 上传/ 文件夹，那里只放素材文件）。只记从电脑传的图片和视频（截图、片段、改写对照图不进）。
// 清单里有的素材长期保留，用户自己删；同一份内容（sha256 一样）只记一条。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isId, readJsonSafe, writeJsonAtomic } from './files.mjs';

export const MAX_UPLOAD_NAME = 200;

/** 页面带来的原文件名：只留文件名本身（去掉路径），去首尾空白，最长 200 字；空的叫「未命名」。 */
export function cleanUploadName(raw) {
  let text = String(raw ?? '');
  try { text = decodeURIComponent(text); } catch { /* 不是合法编码就按原样用 */ }
  const name = text.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_UPLOAD_NAME);
  return name || '未命名';
}

export function createUploadRecords(dataRoot, { now = () => new Date() } = {}) {
  const file = join(dataRoot, '上传记录.json');

  /** 读清单。没有文件 = 空清单；读坏了返回 null（调用方据此不删、不写）。 */
  function load() {
    if (!existsSync(file)) return [];
    const doc = readJsonSafe(file);
    return Array.isArray(doc?.items) ? doc.items.filter(item => isId(item?.id)) : null;
  }

  function loadForWrite() {
    const items = load();
    if (!items) throw Error('「我上传的」清单读不出来，这次没记上，请检查 数据/上传记录.json。');
    return items;
  }

  const save = (items) => writeJsonAtomic(file, { items });

  /** 按最近一次上传倒序。读坏了返回 null。 */
  function list() {
    const items = load();
    return items && [...items].sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  }

  function ids() {
    const items = load();
    return items && items.map(item => item.id);
  }

  function findByHash(sha256) {
    return load()?.find(item => item.sha256 === sha256) ?? null;
  }

  /** 新记一条；meta 是上传素材的类型、字节数、时长等。 */
  function add(id, { name, sha256, ...meta }) {
    const items = loadForWrite();
    const time = now().toISOString();
    const record = { id, name: cleanUploadName(name), sha256, ...meta, createdAt: time, uploadedAt: time };
    save([...items.filter(item => item.id !== id), record]);
    return record;
  }

  /** 同一份内容又传了一次：只挪到最前面（更新最近一次上传时间）。 */
  function touch(id) {
    const items = loadForWrite();
    const time = now().toISOString();
    let found = null;
    save(items.map(item => item.id === id ? (found = { ...item, uploadedAt: time }) : item));
    return found;
  }

  /** 删掉这一条。不在清单里返回 false。 */
  function remove(id) {
    const items = loadForWrite();
    if (!items.some(item => item.id === id)) return false;
    save(items.filter(item => item.id !== id));
    return true;
  }

  return { list, ids, findByHash, add, touch, remove };
}
