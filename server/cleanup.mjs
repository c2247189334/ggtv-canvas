// 收拾硬盘：传的图片和视频不进作品库；按画布、未完成单子的引用保留素材。
// 小服务每次启动时跑一次（这时页面还没连上，不会删掉刚传、还没来得及存进画布的图）。
import { isId } from './store/files.mjs';
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { videoRewriteRoot } from './config.mjs';

export function pruneRewrites({ dataRoot }) {
  const root = videoRewriteRoot(dataRoot);
  if (!existsSync(root)) return { removed: 0, skipped: false };
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return { removed: 0, skipped: true };
  const resolvedRoot = realpathSync(root);
  let removed = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const folder = join(root, entry.name), info = lstatSync(folder);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      const within = relative(resolvedRoot, realpathSync(folder));
      if (!within || isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) continue;
      rmSync(folder, { recursive: true, force: true });
      removed++;
    }
  }
  return { removed, skipped: false };
}

/** 从任意 JSON 里找出所有 { type: 'upload', id } 的编号。 */
export function uploadIdsIn(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) uploadIdsIn(item, found);
  } else if (value && typeof value === 'object') {
    if (value.type === 'upload' && isId(value.id)) found.add(value.id);
    for (const item of Object.values(value)) uploadIdsIn(item, found);
  }
  return found;
}

/**
 * 真删掉没人用的上传素材：哪张画布都没用、也没有排队中 / 生成中的单子要用。
 * 有画布存档读不出来时一张都不删（skipped: true），宁可留着。
 */
export function pruneUploads({ canvases, uploads, jobs, works }) {
  uploads.pruneParts();
  const docs = canvases.docs();
  if (docs === null) return { removed: 0, skipped: true };
  const used = uploadIdsIn(docs);
  for (const job of jobs.list()) {
    if (job.status === 'queued' || job.status === 'running') {
      uploadIdsIn(job.refs, used); uploadIdsIn(job.source, used);
    }
  }
  for (const work of works?.list() ?? []) {
    if (work.kind === 'audio' || work.depth || work.mesh) uploadIdsIn(work.source, used);
  }
  let removed = 0;
  for (const id of uploads.ids()) {
    if (!used.has(id) && uploads.remove(id)) removed += 1;
  }
  return { removed, skipped: false };
}
