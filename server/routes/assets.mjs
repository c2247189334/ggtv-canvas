// 媒体接口：上传和读取图片/视频（可下载）；作品清单、读取作品（可下载）、删除作品。
import { HttpError, sendFile, sendJson } from '../http.mjs';
import { extname } from 'node:path';

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
export const MAX_VIDEO_UPLOAD_BYTES = 1610612736;
export const MAX_VIDEO_UPLOAD_SECONDS = 900;
const VIDEO_UPLOAD_MESSAGE = '请上传小于 1.5G 且时长在 15 分钟以内的视频。';

export function assetRoutes(router, { uploads, works }, { maxVideoBytes = MAX_VIDEO_UPLOAD_BYTES, maxVideoSeconds = MAX_VIDEO_UPLOAD_SECONDS } = {}) {
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
    sendJson(res, 200, saved);
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
