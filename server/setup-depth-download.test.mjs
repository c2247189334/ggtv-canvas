import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './testKit.mjs';

const body = Buffer.from('verified bytes');
const resource = { urls: ['https://huggingface.co/example', 'https://hf-mirror.com/example'],
  bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };

test('下载：已校验文件跳过；错误大小和错误哈希重新下载；curl使用续传/重试/代理', async () => {
  const { download } = await import('../scripts/depth-download.mjs');
  for (const existing of [body, Buffer.from('x'), Buffer.alloc(body.length)]) {
    const file = join(tempDir(), 'weight.pth'), calls = [];
    writeFileSync(file, existing);
    await download(resource, file, { env: { HTTPS_PROXY: 'http://proxy.invalid:1234' }, exec: async (cmd, args, options) => {
      calls.push(args); assert.equal(cmd, 'curl.exe'); assert.ok(args.includes('--retry'));
      assert.equal(args[args.indexOf('-C') + 1], '-');
      assert.equal(options.env.https_proxy, 'http://proxy.invalid:1234');
      writeFileSync(args[args.indexOf('-o') + 1], body);
    }});
    assert.equal(calls.length, existing.equals(body) ? 0 : 1);
    assert.deepEqual(readFileSync(file), body);
  }
});

test('下载：HF失败自动切镜像；两个源失败给人话且保留part便于续传', async () => {
  const { download } = await import('../scripts/depth-download.mjs');
  const file = join(tempDir(), 'weight.pth'), urls = [];
  await download(resource, file, { exec: async (cmd, args) => {
    urls.push(args.at(-1));
    if (urls.length === 1) { writeFileSync(`${file}.part`, 'partial'); throw Error('network'); }
    assert.equal(readFileSync(`${file}.part`, 'utf8'), 'partial'); writeFileSync(`${file}.part`, body);
  }});
  assert.deepEqual(urls, resource.urls); assert.equal(existsSync(`${file}.part`), false);
  const broken = join(tempDir(), 'broken');
  await assert.rejects(download({ ...resource, urls: ['https://github.com/file'] }, broken, {
    exec: async () => { writeFileSync(`${broken}.part`, 'partial'); throw Error('proxy-secret'); }
  }), /连不上 GitHub，请开代理或设置 HTTPS_PROXY 后重新双击/);
  assert.equal(existsSync(`${broken}.part`), true); assert.equal(existsSync(broken), false);
});

test('下载：校验不对重下，续传不支持重下；持续错误不能冒充成功', async () => {
  const { download } = await import('../scripts/depth-download.mjs');
  for (const kind of ['size', 'hash', 'range']) {
    const file = join(tempDir(), 'download'), calls = [];
    await download(resource, file, { exec: async (cmd, args) => {
      calls.push(args);
      if (calls.length === 1) {
        if (kind === 'range') throw Object.assign(Error('range'), { code: 33 });
        writeFileSync(`${file}.part`, kind === 'hash' ? Buffer.alloc(body.length) : 'x');
      } else { assert.equal(existsSync(`${file}.part`), false); writeFileSync(`${file}.part`, body); }
    }});
    assert.equal(calls.length, 2); assert.deepEqual(readFileSync(file), body);
  }
  const file = join(tempDir(), 'bad');
  await assert.rejects(download(resource, file, { exec: async () => writeFileSync(`${file}.part`, 'bad') }), /校验失败/);
  assert.equal(existsSync(file), false);
});
