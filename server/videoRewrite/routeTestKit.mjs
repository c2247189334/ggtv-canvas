import { Readable, Writable } from 'node:stream';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../app.mjs';
import { tempDir } from '../testKit.mjs';
import { solidPng } from '../png.mjs';
import { createFakeArk } from '../fakeArk.mjs';

const fixture = readFileSync(new URL('../fixtures/audio-video.mp4', import.meta.url));
export const env = { ARK_API_KEY: 'test-rewrite-private', TOS_SECRET_ACCESS_KEY: 'test-rewrite-secret' };
export function setup({ fake = true, fakeDelayMs = 0, readEnv = () => env, fetch, sheets: overrides = {},
  logError = (label, error) => { throw Error(`${label}: ${error.message}`); } } = {}) {
  const root = tempDir(), mediaCalls = [], frameCalls = [];
  const touch = (folder, name) => { writeFileSync(join(folder, name), Buffer.from([255, 216, 255, 217])); return name; };
  const sheets = {
    timeline: async input => { mediaCalls.push(input); return [touch(input.folder, 'timeline-0.jpg')]; },
    frames: async (input, times) => { frameCalls.push(times); return times.map((_, i) => touch(input.folder, `frame-${i}.jpg`)); },
    cuts: async () => [], stop: () => {}, ...overrides
  };
  const app = createApp({ dataRoot: root, distDir: tempDir(), port: 5290, fake, fakeDelayMs, readEnv,
    generate: fake ? createFakeArk({ delayMs: 0 }) : undefined,
    logError, videoRewrite: { sheets, fetch } });
  const upload = duration => {
    const bytes = Buffer.from(fixture), start = bytes.indexOf(Buffer.from('mvhd')) + 4;
    bytes.writeUInt32BE(1000, start + 12); bytes.writeUInt32BE(Math.round(duration * 1000), start + 16);
    return { type: 'upload', id: app.stores.uploads.save(bytes).id };
  };
  const png = solidPng(64, 32, [90, 120, 150]);
  const picture = (type = 'upload') => ({ type, id: type === 'work' ? app.stores.works.add(png, {}).id : app.stores.uploads.save(png).id });
  const images = materials => materials.map(row => row.tag.startsWith('@图片') ? { ...row, asset: picture() } : row);
  async function call(method, path, body) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url: path, method, headers: { host: '127.0.0.1:5290', 'content-type': 'application/json' } });
    const chunks = [], res = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    let status, headers;
    res.writeHead = (value, fields) => { status = value; headers = fields; };
    await app.handler(req, res);
    const buffer = Buffer.concat(chunks);
    return { status, headers, buffer, json: headers?.['Content-Type']?.includes('json') ? JSON.parse(buffer.toString()) : null };
  }
  return { app, root, mediaCalls, frameCalls, upload, picture, images, call };
}
