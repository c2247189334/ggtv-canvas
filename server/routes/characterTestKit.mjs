import { Readable, Writable } from 'node:stream';
import { join } from 'node:path';
import { createApp } from '../app.mjs';
import { createFakeArk } from '../fakeArk.mjs';
import { tempDir } from '../testKit.mjs';

export function characterSetup(options = {}) {
  const root = options.dataRoot ?? tempDir('characters-route-'), errors = [];
  const app = createApp({ dataRoot: root, distDir: join(root, 'empty-page'), port: 5398, fake: true,
    readEnv: () => ({}), generate: createFakeArk({ delayMs: 20 }), log: () => {},
    logError: (tag, error) => errors.push({ tag, error }), ...options });
  const call = async (method, url, body) => {
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
      method, url, headers: { host: '127.0.0.1:5398', 'content-type': 'application/json' }
    });
    const chunks = []; let status;
    const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.writeHead = value => { status = value; };
    await app.handler(req, res);
    return { status, json: JSON.parse(Buffer.concat(chunks).toString()) };
  };
  return { root, app, call, errors };
}
