import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutor } from '../depth/executor.mjs';
import { imageSize } from '../imageSize.mjs';

/** 只解析本地素材引用；全部检查、缩图完成后才允许发看图请求。 */
export function createPromptImages({ uploads, works, executor = createExecutor() }) {
  async function prepare(materials) {
    const pictures = materials.filter(row => row.tag.startsWith('@图片'));
    if (pictures.length > 12) throw Error('单次看图最多12张图片，请减少图片后再写词；这次没发出去，没花钱。');
    const sources = pictures.map(({ tag, asset }) => {
      try {
        const store = asset?.type === 'upload' ? uploads : asset?.type === 'work' ? works : null;
        const file = store?.path(asset?.id);
        if (!file || store.metadata(asset.id)?.kind !== 'image') throw Error('missing');
        return { tag, file };
      } catch {
        throw Error(`${tag}的图片读不到，请重新上传或重新选择这张图片；这次没发出去，没花钱。`);
      }
    });
    if (!sources.length) return [];
    const folder = mkdtempSync(join(tmpdir(), 'rewrite-pictures-'));
    try {
      const images = [];
      for (const [index, { tag, file }] of sources.entries()) {
        try {
          const output = join(folder, `${index}.jpg`);
          await executor.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file,
            '-vf', "scale=w='min(1024,iw)':h='min(1024,ih)':force_original_aspect_ratio=decrease",
            '-frames:v', '1', '-q:v', '2', output]);
          images.push(`data:image/jpeg;base64,${readFileSync(output).toString('base64')}`);
        } catch {
          throw Error(`${tag}的图片缩图失败，请换一张能正常打开的图片，并确认本机ffmpeg可用；这次没发出去，没花钱。`);
        }
      }
      return images;
    } finally { rmSync(folder, { recursive: true, force: true }); }
  }
  /** 读素材图宽高（PNG / JPEG 文件头），读不到给 null；背景图比例提醒用，不启动外部程序。 */
  function sizeOf(asset) {
    try {
      const store = asset?.type === 'upload' ? uploads : asset?.type === 'work' ? works : null;
      const file = store?.path(asset.id);
      return file ? imageSize(readFileSync(file)) : null;
    } catch { return null; }
  }
  return { prepare, sizeOf, stop: () => executor.stop() };
}
