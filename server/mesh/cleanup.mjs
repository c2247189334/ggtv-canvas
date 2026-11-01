import { existsSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isId } from '../store/files.mjs';

/** 仅删除此单的普通文件；不递归、不跟随符号链接、不接受返回的任意路径。 */
export function cleanupComfyFiles(portable, jobId) {
  if (!portable) return;
  if (!isId(jobId)) throw Error('白模单的编号不对，未清理 ComfyUI 文件。');
  const root = resolve(portable, 'ComfyUI');
  if (!existsSync(root)) return;
  const realRoot = realpathSync(root), prefix = `mesh-${jobId}`;
  for (const part of ['input', join('output', 'video')]) {
    const folder = join(root, part);
    if (!existsSync(folder)) continue;
    const distance = relative(realRoot, realpathSync(folder));
    if (!distance || distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) {
      throw Error('ComfyUI 文件夹指向配置目录以外，未清理文件。');
    }
    for (const file of readdirSync(folder, { withFileTypes: true })) {
      if (file.isFile() && file.name.startsWith(prefix) && /^[._-]/.test(file.name.slice(prefix.length))) {
        rmSync(join(folder, file.name), { force: true });
      }
    }
  }
}
