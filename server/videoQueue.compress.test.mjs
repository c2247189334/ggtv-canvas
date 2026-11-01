import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createVideoQueue } from './videoQueue.mjs';
import { buildSeedanceBody } from './seedance.mjs';
import { checkVideoJobInput } from './videoJobInput.mjs';
import { createJobStore } from './store/jobs.mjs';
import { createSpendLog } from './store/spend.mjs';
import { createUploadStore } from './store/uploads.mjs';
import { createWorkStore } from './store/works.mjs';
import { createExecutor } from './depth/executor.mjs';
import { imageSize } from './imageSize.mjs';
import { wav } from './fixtures/wav.mjs';
import { tempDir, waitFor } from './testKit.mjs';

const model = 'doubao-seedance-2-0-mini-260615';
const input = refs => ({ canvasId: '11111111-1111-4111-8111-111111111111', cardId: 'v1', model,
  mode: 'reference', prompt: '@图像1 @图像2 @图像3 @音频1 @音频2', ratio: '16:9', resolution: '480p',
  duration: 5, audio: true, priceYuan: 1.23, refs });
const data = url => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

test('真实ffmpeg交单：PNG同尺寸白底JPG、WAV为192k MP3；JPG/WebP/MP3原样，顺序/估价/作品原件不变', async () => {
  const root = tempDir(), executor = createExecutor();
  const paths = ['source.png', 'source.jpg', 'source.webp', 'source.mp3'].map(name => join(root, name));
  try {
    await executor.run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=641x301', '-vf',
      'format=rgba,drawbox=x=0:y=0:w=100:h=100:color=black@0:t=fill:replace=1', '-frames:v', '1', '-compression_level', '0', paths[0]]);
    for (const path of paths.slice(1, 3)) await executor.run('ffmpeg', ['-v', 'error', '-i', paths[0], '-frames:v', '1', path]);
    await executor.run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=2', '-b:a', '192k', paths[3]]);
    const [png, jpg, webp, mp3] = paths.map(path => readFileSync(path));
    const stores = { jobs: createJobStore(root), works: createWorkStore(root), uploads: createUploadStore(root), spend: createSpendLog(root) };
    const picture = stores.works.add(png, {}), jpeg = stores.uploads.save(jpg), web = stores.uploads.save(webp);
    const audio = stores.works.addAudio(wav(2)), mp3Id = '33333333-3333-4333-8333-333333333333';
    const read = stores.works.read, metadata = stores.works.metadata;
    const mp3Asset = { kind: 'audio', contentType: 'audio/mpeg', duration: 2, bytes: mp3.length, buffer: mp3 };
    stores.works.read = id => id === mp3Id ? mp3Asset : read(id);
    stores.works.metadata = id => id === mp3Id ? mp3Asset : metadata(id);
    const refs = [{ type: 'work', id: audio.id }, { type: 'work', id: picture.id },
      { type: 'upload', id: jpeg.id }, { type: 'work', id: mp3Id }, { type: 'upload', id: web.id }];
    const checked = checkVideoJobInput(input(refs), ref => (ref.type === 'work' ? stores.works : stores.uploads).metadata(ref.id));
    assert.equal(checked.ok, true);
    let body, sent;
    const queue = createVideoQueue({ ...stores, client: {
      submit: async request => { sent = request; body = buildSeedanceBody(request); return { ok: true, taskId: 'compressed' }; },
      query: async () => ({ status: 'succeeded', content: { video_url: 'https://fake/video' } }),
      download: async () => readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url))
    } });
    const job = queue.submit(checked.job);
    await waitFor(() => ['succeeded', 'failed', 'uncertain'].includes(stores.jobs.read(job.id).status), { timeout: 10000 });
    assert.equal(stores.jobs.read(job.id).status, 'succeeded');
    assert.equal(body.content[1].image_url.url.split(',')[0], 'data:image/jpeg;base64');
    const converted = data(body.content[1].image_url.url);
    assert.deepEqual(imageSize(converted), { width: 641, height: 301 });
    assert.ok(converted.length < png.length);
    assert.deepEqual(data(body.content[2].image_url.url), jpg);
    assert.deepEqual(data(body.content[3].image_url.url), webp);
    assert.equal(body.content[4].audio_url.url.split(',')[0], 'data:audio/mpeg;base64');
    assert.ok(data(body.content[4].audio_url.url).length < wav(2).length);
    assert.deepEqual(data(body.content[5].audio_url.url), mp3);
    assert.equal(sent.audios[0].duration, 2);
    assert.equal(sent.priceYuan, checked.job.priceYuan);
    assert.equal(body.content[0].text, checked.job.prompt);
    assert.deepEqual(read(picture.id).buffer, png);
    assert.deepEqual(read(audio.id).buffer, wav(2));
    const encodedAudio = join(root, 'sent.mp3');
    writeFileSync(encodedAudio, data(body.content[4].audio_url.url));
    const probe = await executor.run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,bit_rate', '-of', 'json', encodedAudio]);
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.equal(stream.codec_name, 'mp3'); assert.equal(Number(stream.bit_rate), 192000);
    const output = join(root, 'sent.jpg');
    writeFileSync(output, converted);
    const pixel = join(root, 'white.rgb');
    await executor.run('ffmpeg', ['-v', 'error', '-i', output, '-vf', 'format=rgb24,crop=1:1:20:20', '-frames:v', '1', '-f', 'rawvideo', pixel]);
    assert.ok([...readFileSync(pixel)].every(channel => channel >= 250), '透明区域应铺白底');
  } finally { executor.stop(); }
});
