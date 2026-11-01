import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createPromptImages } from './promptImages.mjs';
import { createUploadStore } from '../store/uploads.mjs';
import { createWorkStore } from '../store/works.mjs';
import { solidPng } from '../png.mjs';
import { tempDir } from '../testKit.mjs';
import { createExecutor } from '../depth/executor.mjs';

test('上传和作品图按素材顺序读真实文件，真ffmpeg缩至长边1024且清理临时图', async () => {
  const root = tempDir(), uploads = createUploadStore(root), works = createWorkStore(root);
  const png = solidPng(2048, 1024, [100, 120, 140]), upload = uploads.save(png), work = works.add(png, {});
  const runs = [], real = createExecutor();
  const images = createPromptImages({ uploads, works, executor: { run: async (command, args) => {
    runs.push(args); return real.run(command, args);
  }, stop: () => real.stop() } });
  const result = await images.prepare([{ tag: '@图片8', asset: { type: 'work', id: work.id } },
    { tag: '@视频1' }, { tag: '@图片2', asset: { type: 'upload', id: upload.id } }]);
  assert.equal(result.length, 2);
  assert.ok(result.every(url => url.startsWith('data:image/jpeg;base64,')));
  assert.ok(runs[0].includes(works.path(work.id))); assert.ok(runs[1].includes(uploads.path(upload.id)));
  const jpeg = Buffer.from(result[0].split(',')[1], 'base64');
  const marker = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(marker >= 0); assert.equal(jpeg.readUInt16BE(marker + 5), 512); assert.equal(jpeg.readUInt16BE(marker + 7), 1024);
  assert.ok(runs.every(args => !existsSync(args.at(-1))), '中间缩略图已删除');
  assert.deepEqual(readFileSync(uploads.path(upload.id)), png, '不改原图');
});

test('缺失、视频冒充图片、缩图失败和过多图片均在模型请求前给出没花钱的人话', async () => {
  const uploads = createUploadStore(tempDir()), works = createWorkStore(tempDir());
  const video = uploads.save(readFileSync(new URL('../fixtures/audio-video.mp4', import.meta.url)));
  const image = uploads.save(solidPng(10, 10, [100, 120, 140])); let calls = 0;
  const images = createPromptImages({ uploads, works, executor: { run: async () => { calls++; throw Error('解码失败'); }, stop() {} } });
  const material = asset => ({ tag: '@图片1', asset });
  for (const asset of [undefined, { type: 'upload', id: '00000000-0000-0000-0000-000000000000' },
    { type: 'work', id: image.id }, { type: 'upload', id: video.id }]) {
    await assert.rejects(images.prepare([material(asset)]), /@图片1.*没花钱/);
  }
  assert.equal(calls, 0);
  await assert.rejects(images.prepare(Array.from({ length: 13 }, (_, i) => ({ tag: `@图片${i + 1}`, asset: { type: 'upload', id: image.id } }))), /最多12.*没花钱/);
  assert.equal(calls, 0);
  await assert.rejects(images.prepare([material({ type: 'upload', id: image.id })]), /@图片1.*缩图.*没花钱/);
  assert.equal(calls, 1);
});
