import type { CanvasDoc, CanvasSave } from '@/types';
type SaveOptions = { keepalive?: boolean; silent?: boolean };
type Deps = { initial: CanvasDoc; version: number;
  save: (doc: CanvasSave, keepalive?: boolean) => Promise<{ version: number }>; notify: (message: string) => void };
const content = ({ version: _version, createdAt: _created, updatedAt: _updated, ...doc }: CanvasDoc) => JSON.stringify(doc);
export const CANVAS_CONFLICT = '这张画布在别的标签页改过了，刷新页面后再继续改';

/** 单标签只保留一个在途保存；后续改动排队并使用上次成功版本，409后连离开保存也停下。 */
export function createCanvasSaver({ initial, version, save, notify }: Deps) {
  let latest = initial, saved = content(initial), blocked = false;
  let running: Promise<void> | null = null, pending: SaveOptions | null = null;
  const flush = async () => {
    while (pending && !blocked) {
      const options = pending; pending = null;
      const snapshot = latest, text = content(snapshot);
      if (text === saved) continue;
      try {
        const result = await save({ ...snapshot, baseVersion: version }, options.keepalive);
        version = result.version; saved = text;
      } catch (error) {
        pending = null;
        if ((error as { status?: number }).status === 409) { blocked = true; notify(CANVAS_CONFLICT); }
        else if (!options.silent) notify(`画布没存上：${(error as Error).message}`);
      }
    }
  };
  return {
    get blocked() { return blocked; },
    update(doc: CanvasDoc) { latest = doc; },
    save(options: SaveOptions = {}) {
      if (blocked) return Promise.resolve();
      if (!running && content(latest) === saved) return Promise.resolve();
      pending = pending ? { keepalive: pending.keepalive || options.keepalive, silent: pending.silent && options.silent } : options;
      if (!running) running = flush().finally(() => { running = null; });
      return running;
    }
  };
}
