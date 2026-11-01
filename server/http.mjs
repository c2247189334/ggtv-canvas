// 小服务的 HTTP 底座：路由表、收发 JSON、发文件、给打包好的页面、挡外站。
// 只用 Node 自带的 http，不加依赖。接口路径一律英文（中文进 URL 会被百分号编码，旧项目踩过）。
import { createReadStream, existsSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { extname, join, normalize, sep } from 'node:path';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** 没被路由自己接住的错误，页面上一律只看到这一句；细节（可能带本机路径）只进黑窗口和日志。 */
export const SERVER_ERROR_TEXT = '小服务出错了，详情看黑窗口或 日志/服务端.log。';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

export function sendJson(res, status, data) {
  const text = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

/** 发一个文件。download 给了就让浏览器下载成这个名字（只用英文名，中文名进响应头会报错）。 */
export async function sendFile(res, file, { download = null, req = null, range = req?.headers?.range } = {}) {
  const size = statSync(file).size;
  const headers = {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache'
  };
  if (download) headers['Content-Disposition'] = `attachment; filename="${download}"`;
  let start = 0;
  let end = size - 1;
  if (range !== undefined) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range));
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    } else start = NaN;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      res.writeHead(416, { ...headers, 'Content-Length': 0, 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    headers['Content-Length'] = end - start + 1;
  }
  res.writeHead(range === undefined ? 200 : 206, headers);
  if (size === 0) return res.end();
  await pipeline(createReadStream(file, { start, end }), res);
}

/** 把请求体整个读进内存，超过 limit 字节抛 413。 */
export async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, `内容太大了，最多 ${Math.round(limit / 1024 / 1024)}MB。`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** 每收一块就写磁盘，等待写完再收下一块；超限保留连接供调用方回413。 */
export async function readBodyToFile(req, file, limit, message) {
  const output = await open(file, 'wx');
  try {
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, message);
      await output.writeFile(chunk);
    }
    return size;
  } finally { await output.close(); }
}

/** 读 JSON 请求体。Content-Type 必须是 application/json —— 外站的表单 / 简单请求发不了这个类型。 */
export async function readJson(req, limit = 2 * 1024 * 1024) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, '请求格式不对（要 JSON）。');
  }
  const raw = await readBody(req, limit);
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, '请求内容不是合法的 JSON。');
  }
}

/** 把请求路径钉死在 root 里面，挡掉 ../ 穿越。 */
export function safeJoin(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = join(root, normalize(decoded).replace(/^([/\\])+/, ''));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

export function createRouter() {
  const routes = new Map();
  return {
    add(method, path, handler) {
      routes.set(`${method} ${path}`, handler);
    },
    find(method, path) {
      return routes.get(`${method} ${path}`) ?? null;
    },
    get size() {
      return routes.size;
    }
  };
}

/**
 * 挡外站：本机网页工具最怕别的网站偷偷往 127.0.0.1 发请求替你花钱。
 * Host 必须是本机名字（挡 DNS 重绑定）；带了 Origin 的写请求，Origin 也必须是本机这几个端口。
 */
export function requestAllowed(req, allowedPorts) {
  const host = String(req.headers.host ?? '');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return allowedPorts.some((port) => origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`);
}

function serveFrontend(res, distDir, pathname) {
  if (!existsSync(join(distDir, 'index.html'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>页面还没打包</h2><p>用 <code>一键启动.bat</code> 启动，或者先在项目文件夹跑一次 <code>npm run build</code>。</p>');
    return;
  }
  const target = safeJoin(distDir, pathname === '/' ? '/index.html' : pathname);
  const file = target && existsSync(target) && statSync(target).isFile() ? target : join(distDir, 'index.html');
  return sendFile(res, file);
}

export function createHandler({ router, distDir, allowedPorts, logError }) {
  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const key = `${req.method} ${url.pathname}`;
    try {
      if (!requestAllowed(req, allowedPorts)) return sendJson(res, 403, { error: '只接受本机页面发来的请求。' });
      const handler = router.find(req.method ?? 'GET', url.pathname);
      if (handler) return await handler({ req, res, query: url.searchParams });
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: '没有这个接口。' });
      return await serveFrontend(res, distDir, url.pathname);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      logError(key, err);
      sendJson(res, 500, { error: SERVER_ERROR_TEXT });
    }
  };
}
