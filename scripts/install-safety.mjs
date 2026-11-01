import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

// 在下载/安装之前检查实际树，拒绝 Windows junction 和符号链接把写入引到项目外。
// allowWithin：放行它下面、且指向它里面的链接（uv 自己在 runtime/python 建的版本 junction，11-01 真装踩到）；它本身是链接照样拒绝。
export function assertNoLinks(path, { allowWithin } = {}) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    if (allowWithin && path !== allowWithin && pointsInside(path, allowWithin)) return;
    throw Error('安装/打包目录含链接，请改用项目内的普通目录后重试。');
  }
  if (stat.isDirectory()) for (const name of readdirSync(path)) assertNoLinks(join(path, name), { allowWithin });
}

function pointsInside(link, base) {
  let target;
  try { target = relative(realpathSync(base), realpathSync(link)); } catch { return false; }
  return Boolean(target) && !target.startsWith('..') && !isAbsolute(target);
}

export function assertArchive(entries, verbose, expectedRoot) {
  const files = entries.split(/\r?\n/).filter(Boolean);
  if (!files.length) throw Error('VDA 压缩包为空或无法列出文件。');
  for (const file of files) {
    const normalized = file.replaceAll('\\', '/'), parts = normalized.split('/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || parts.includes('..') || parts[0] !== expectedRoot) {
      throw Error('VDA 压缩包路径不符合固定版本结构，拒绝解压。');
    }
  }
  if (!verbose.trim() || verbose.split(/\r?\n/).filter(Boolean).some(line => !/^[-d]/.test(line))) {
    throw Error('VDA 压缩包含链接或特殊文件，拒绝解压。');
  }
}
