// 人物只保存图片引用，图片文件仍由上传素材与作品库管理。
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isId, newId, readJsonSafe, writeJsonAtomic } from './files.mjs';

function isCharacter(value, id) {
  return value && value.id === id && typeof value.name === 'string' && typeof value.description === 'string'
    && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string'
    && ['ready', 'generating', 'failed'].includes(value.status) && Array.isArray(value.images)
    && value.images.every(image => image && ['work', 'upload'].includes(image.ref?.type)
      && isId(image.ref.id) && typeof image.label === 'string');
}

export function createCharacterStore(dataRoot, { now = () => new Date() } = {}) {
  const dir = join(dataRoot, '人物');
  const file = id => join(dir, id, 'character.json');
  const ids = () => existsSync(dir) ? readdirSync(dir).filter(isId) : [];

  function read(id) {
    if (!isId(id)) return null;
    const value = readJsonSafe(file(id));
    return isCharacter(value, id) ? value : null;
  }

  function create(input) {
    const time = now().toISOString();
    const character = { ...input, id: newId(), createdAt: time, updatedAt: time };
    writeJsonAtomic(file(character.id), character);
    return character;
  }

  function patch(id, changes) {
    const old = read(id);
    if (!old) return null;
    const character = { ...old, ...changes, id, createdAt: old.createdAt, updatedAt: now().toISOString() };
    writeJsonAtomic(file(id), character);
    return character;
  }

  function list() {
    return ids().map(read).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** 有坏档时停止上传清理，保留可能被它引用的原图。 */
  function docs() {
    const all = ids().map(read);
    return all.some(value => value === null) ? null : all;
  }

  function remove(id) {
    if (!isId(id) || !existsSync(file(id))) return false;
    rmSync(join(dir, id), { recursive: true, force: true });
    return true;
  }

  return { create, read, patch, list, docs, remove };
}
