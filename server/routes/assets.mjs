// 媒体接口：上传和读取图片/视频（可下载）；「我上传的」清单和删除；作品清单、读取作品（可下载）、删除作品。
import { HttpError, sendFile, sendJson } from '../http.mjs';
import { extname } from 'node:path';
import { uploadIdsIn } from '../cleanup.mjs';

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
export const MAX_VIDEO_UPLOAD_BYTES = 1610612736;
export const MAX_VIDEO_UPLOAD_SECONDS = 900;
const VIDEO_UPLOAD_MESSAGE = '请上传小于 1.5G 且时长在 15 分钟以内的视频。';

export function assetRoutes(router, { uploads, uploadRecords, works, canvases }, { maxVideoBytes = MAX_VIDEO_UPLOAD_BYTES, maxVideoSeconds = MAX_VIDEO_UPLOAD_SECONDS } = {}) {
  // 只收媒体 Content-Type：外站的「简单请求」发不了这些类型。
  router.add('POST', '/api/uploads', async ({ req, res }) => {
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim();
    const video = /^video\/(mp4|quicktime)$/.test(type);
    if (!video && !/^image\/(png|jpeg|webp)$/.test(type)) {
      throw new HttpError(415, '只收 PNG、JPG、WebP 图片和 MP4、MOV 视频。');
    }
    let saved;
    try {
      saved = await uploads.saveStream(req, {
        limit: video ? maxVideoBytes : MAX_UPLOAD_BYTES,
        message: video ? VIDEO_UPLOAD_MESSAGE : '图片最大 30MB。',
        validate(meta) {
          if (meta.kind === 'image' && meta.bytes > MAX_UPLOAD_BYTES) throw new HttpError(413, '图片最大 30MB。');
          if (meta.kind === 'video' && (meta.bytes > maxVideoBytes || meta.duration > maxVideoSeconds)) throw new HttpError(413, VIDEO_UPLOAD_MESSAGE);
        }
      });
    } catch (error) {
      if (error instanceof HttpError && error.status === 413) {
        res.shouldKeepAlive = false;
        res.setHeader('Connection', 'close');
      }
      throw error;
    }
    if (!saved) throw new HttpError(415, '文件无法识别，只收 PNG、JPG、WebP 图片和有视频轨及时长的 MP4、MOV 视频。');
    sendJson(res, 200, remember(saved, req.headers['x-upload-name']));
  });

  /** 记进「我上传的」：内容和清单里某条一样、文件也还在，就删掉刚收的、回原来那条的编号。下面同步执行，两单不会同时认成新的。 */
  function remember({ sha256, bytes, ...saved }, name) {
    const { id: savedId, ...meta } = saved;
    let same = uploadRecords.findByHash(sha256);
    if (same && !uploads.path(same.id)) { uploadRecords.remove(same.id); same = null; }
    if (same && same.id !== savedId) {
      uploads.remove(savedId);
      uploadRecords.touch(same.id);
      const { name: _name, sha256: _hash, bytes: _bytes, createdAt, uploadedAt, ...again } = same;
      return again;
    }
    try { uploadRecords.add(savedId, { name, sha256, bytes, ...meta }); }
    catch (error) { uploads.remove(savedId); throw new HttpError(500, error.message); }
    return saved;
  }

  router.add('GET', '/api/uploads/list', async ({ res }) => {
    const records = uploadRecords.list();
    if (!records) throw new HttpError(500, '「我上传的」清单读不出来，请检查 数据/上传记录.json。');
    const usedBy = new Map();
    for (const { id } of canvases.list()) {
      const doc = canvases.read(id);
      for (const upload of doc ? uploadIdsIn(doc.nodes ?? []) : []) usedBy.set(upload, [...(usedBy.get(upload) ?? []), id]);
    }
    const items = records.filter(record => uploads.path(record.id))
      .map(({ sha256, ...record }) => ({ ...record, canvases: usedBy.get(record.id) ?? [] }));
    sendJson(res, 200, { items, bytes: items.reduce((sum, item) => sum + (item.bytes ?? 0), 0) });
  });

  router.add('DELETE', '/api/uploads', async ({ res, query }) => {
    const id = query.get('id');
    if (!uploadRecords.remove(id)) throw new HttpError(404, '这个素材已经不在了。');
    uploads.remove(id);
    sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/api/uploads/file', async ({ req, res, query }) => {
    const id = query.get('id');
    const file = uploads.path(id);
    if (!file) throw new HttpError(404, '这张图找不到了。');
    return sendFile(res, file, { req, download: query.get('download') === '1' ? `upload-${id.slice(0, 8)}${extname(file)}` : null });
  });

  router.add('GET', '/api/works', async ({ res }) => sendJson(res, 200, works.list()));

  router.add('GET', '/api/works/file', async ({ req, res, query }) => {
    const id = query.get('id');
    const file = works.path(id);
    if (!file) throw new HttpError(404, '作品已删除。');
    return sendFile(res, file, { req, download: query.get('download') === '1' ? `work-${id.slice(0, 8)}${extname(file)}` : null });
  });

  router.add('DELETE', '/api/works', async ({ res, query }) => {
    if (!works.remove(query.get('id'))) throw new HttpError(404, '作品已经不在了。');
    sendJson(res, 200, { ok: true });
  });
}
