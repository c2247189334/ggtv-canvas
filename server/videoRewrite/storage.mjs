import { existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { videoRewriteRoot } from '../config.mjs';
import { checkCardId } from './input.mjs';

export function rewriteFolder(dataRoot, cardId, create = false) {
  checkCardId(cardId);
  const root = videoRewriteRoot(dataRoot), folder = join(root, cardId);
  for (const path of [root, folder]) if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) {
    throw Error('改写图片目录不是普通文件夹，请先检查本地文件。');
  }
  if (create) mkdirSync(folder, { recursive: true });
  return folder;
}
export function removeRewrite(dataRoot, cardId) {
  const folder = rewriteFolder(dataRoot, cardId);
  rmSync(folder, { recursive: true, force: true });
}
