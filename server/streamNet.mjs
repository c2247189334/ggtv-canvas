// 流式版的火山请求：回包边收边交给调用方，不等整段收完。
// 为什么：开深度思考时一轮要好几分钟，非流式连接上一直没数据，官方文档说「极易因超时导致任务失败」
// （10-25 真测：2.1 Pro 拆解第一轮等满 300 秒被掐断）。
// 路由（真实 DNS + 绑物理网卡）照用 net.mjs 的 route；net.mjs 按规矩不改，下面的请求参数和它的 fetch 保持一致。
import { request as httpsRequest } from 'node:https';
import { markUnsent, transport, watchSend } from './net.mjs';

const LIMIT = 64 * 1024 * 1024;

/** 把 node 回包变成边收边读的 Response：读的一方取消 = 关掉连接；连接中途出错 = 读的一方收到这个错。 */
export function streamResponse(res, req) {
  let size = 0, finished = false;
  const body = new ReadableStream({
    start(controller) {
      const fail = err => { if (finished) return; finished = true; controller.error(err); };
      res.on('data', chunk => {
        if (finished) return;
        size += chunk.length;
        if (size > LIMIT) { fail(Error('RESPONSE_TOO_LARGE')); req.destroy(); return; }
        controller.enqueue(new Uint8Array(chunk));
      });
      res.on('end', () => { if (!finished) { finished = true; controller.close(); } });
      res.on('error', fail);
      res.on('aborted', () => fail(Error('RESPONSE_INTERRUPTED')));
      req.on('error', fail);
    },
    cancel() { finished = true; req.destroy(); }
  });
  const headers = Object.fromEntries(Object.entries(res.headers).filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]));
  return new Response([204, 205, 304].includes(res.statusCode) ? null : body, { status: res.statusCode, headers });
}

export function streamTransport(c) {
  const { route } = transport(c);
  return async function fetch(input, options = {}) {
    let url, r, body;
    try {
      url = new URL(input);
      if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw Error('URL_NOT_ALLOWED');
      r = await route(url.hostname); body = options.body === undefined ? undefined : Buffer.from(options.body);
    } catch (err) { throw markUnsent(err); }
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = httpsRequest(url, { method: options.method ?? 'GET', agent: false, localAddress: r.localAddress,
          servername: url.hostname, lookup: (_h, o, cb) => o?.all ? cb(null, [{ address: r.address, family: 4 }]) : cb(null, r.address, 4),
          headers: { 'Accept-Encoding': 'identity', ...(options.headers ?? {}), ...(body ? { 'Content-Length': body.length } : {}) },
          signal: AbortSignal.timeout(options.timeout ?? 60000) }, res => resolve(streamResponse(res, req)));
      } catch (err) { return reject(markUnsent(err)); }
      // 官方文档：思考摘要的包间隔可能较长，还要防路由器 / 防火墙掐掉长时间没数据的连接 → 开 TCP 保活。
      req.on('socket', socket => socket.setKeepAlive(true, 30000));
      watchSend(req, reject); req.end(body);
    });
  };
}
