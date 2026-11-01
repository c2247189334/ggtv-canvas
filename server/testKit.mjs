// 测试用小工具：建临时目录、起一个临时服务、发原始请求、等某个条件成立。只给 *.test.mjs 用。
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 建过的临时目录，进程退出时全删掉，别在系统临时文件夹里越攒越多。删不掉的照实报出来。
const made = [];
process.once('exit', () => {
  for (const dir of made) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch (err) {
      console.error(`临时目录没删掉：${dir}（${err.message}）`);
    }
  }
});

export function tempDir(prefix = 'canvas-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

export async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { port, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** 用 node:http 发请求（能自己设 Host 头，fetch 不行）。 */
export function call(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let json = null;
        try {
          json = JSON.parse(buffer.toString('utf8'));
        } catch {
          /* 不是 JSON */
        }
        resolve({ status: res.statusCode, headers: res.headers, buffer, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

export async function waitFor(check, { timeout = 3000, every = 10 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
  throw new Error('等太久了，条件一直没成立');
}
