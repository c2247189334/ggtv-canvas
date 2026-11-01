import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMeshMedia, MESH_MAX_FPS, meshSize } from './local.mjs';
import { createExecutor } from '../depth/executor.mjs';
import { depthGeometry } from '../depth/local.mjs';
import { createUploadStore } from '../store/uploads.mjs';
import { createWorkStore } from '../store/works.mjs';
import { newId } from '../store/files.mjs';
import { parseMp4 } from '../mp4.mjs';
import { tempDir } from '../testKit.mjs';

const video = readFileSync(new URL('../fixtures/audio-video.mp4', import.meta.url));
const result = readFileSync(new URL('../fixtures/depth-video.mp4', import.meta.url));
const wrong = readFileSync(new URL('../fixtures/fake-video.mp4', import.meta.url));
// 白模成品最多 25fps：假执行器写出的「输出」也要是 25fps，用真 ffmpeg 现做一份（2 秒、864×480）。
const output25Path = join(tempDir(), 'mesh-25.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-i', fileURLToPath(new URL('../fixtures/depth-video.mp4', import.meta.url)), '-vf', 'fps=25',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output25Path]);
const output25 = readFileSync(output25Path);
const json = data => new Response(JSON.stringify(data));
function setup(extra = {}) {
  const dataRoot = tempDir(), uploads = createUploadStore(dataRoot), works = createWorkStore(dataRoot);
  const source = { type: 'upload', id: uploads.save(video).id }, calls = [];
  const executor = { run: async (command, args) => { calls.push([command, args]); writeFileSync(args.at(-1), output25); }, stop: () => calls.push('stop') };
  const media = createMeshMedia({ dataRoot, uploads, works, geometry: depthGeometry, executor,
    fake: true, ...extra });
  return { dataRoot, uploads, works, source, calls, media, executor, job: { id: newId(), source } };
}
// 10-31 用户定：白模帧率最多 25。真 ComfyUI 50fps（330 帧）要 1221 秒，压到 25fps（165 帧）220 秒，去辫子那条真出也是 25fps。
test('白模帧率最多25：高于25压到25，24~25保持，尺寸不变', () => {
  assert.equal(MESH_MAX_FPS, 25);
  assert.deepEqual(meshSize({ width: 480, height: 854, fps: 50 }), { width: 480, height: 854, fps: 25 });
  assert.equal(meshSize({ width: 480, height: 854, fps: 30 }).fps, 25);
  assert.equal(meshSize({ width: 480, height: 854, fps: 24 }).fps, 24);
  assert.equal(meshSize({ width: 480, height: 854, fps: 25 }).fps, 25);
});
test('假白模只用ffmpeg灰度反色、固定480P尺寸帧率与无声音，存作品标记和0费用', async () => {
  const s = setup({ fetch: () => assert.fail('假模式不得连接ComfyUI') });
  const work = await s.media.mesh(s.job), args = s.calls[0][1];
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0][0], 'ffmpeg');
  assert.ok(args.includes('format=gray,negate,scale=864:480,fps=25,setsar=1'));
  for (const value of ['-an', 'libx264', 'yuv420p', '+faststart']) assert.ok(args.includes(value));
  assert.equal(work.mesh, true); assert.equal(work.model, 'SAM-3D-Body'); assert.equal(work.yuan, 0);
  assert.deepEqual(work.source, s.source); assert.ok(work.elapsedSeconds >= 0);
  assert.deepEqual(readdirSync(join(s.dataRoot, 'processing')), []);
});
test('真实流程按预缩、上传、交单、查询、取回、转格式、存作品、free、清理依次执行', async () => {
  const order = [], portable = tempDir(), id = newId(), prefix = `mesh-${id}`;
  const input = join(portable, 'ComfyUI', 'input'), output = join(portable, 'ComfyUI', 'output', 'video');
  mkdirSync(input, { recursive: true }); mkdirSync(output, { recursive: true });
  const ownInput = join(input, `${prefix}.mp4`), ownOutput = join(output, `${prefix}_00001_.mp4`);
  writeFileSync(ownInput, 'own'); writeFileSync(ownOutput, 'own');
  writeFileSync(join(input, 'other.mp4'), 'user'); writeFileSync(join(output, `${prefix}other.mp4`), 'user');
  const s = setup({ fake: false, readEnv: () => ({ COMFYUI_DIR: portable }),
    comfyProcess: { ensure: async () => order.push('ready'), stop: () => {} },
    fetch: async (url, options) => {
      const path = new URL(url).pathname;
      if (path.includes('object_info')) return json({ SAM3DBody_Render: {} });
      if (path.startsWith('/models/')) {
        const names = { checkpoints: 'sam3.1_multiplex_fp16.safetensors', detection: 'sam_3d_body_dinov3_bf16.safetensors',
          diffusion_models: 'rt_detr_v4-x-hgnet_fp32.safetensors', geometry_estimation: 'moge_2_vitl_normal_fp16.safetensors' };
        return json([names[path.split('/').at(-1)]]);
      }
      order.push(path);
      if (path === '/upload/image') { assert.equal(options.body.get('image').name, `${prefix}.mp4`); return json({ name: `${prefix}.mp4` }); }
      if (path === '/prompt') { const request = JSON.parse(options.body); assert.equal(request.prompt['21s'].inputs.filename_prefix, `video/${prefix}`); return json({ prompt_id: id }); }
      if (path.startsWith('/history/')) return json({ [id]: { status: { completed: true }, outputs: { '21s': { videos: [{ filename: `${prefix}_00001_.mp4`, subfolder: 'video', type: 'output' }] } } } });
      if (path === '/view') return new Response(result);
      if (path === '/free') { assert.equal(existsSync(ownInput), true); assert.equal(existsSync(ownOutput), true); return json({}); }
      assert.fail(path);
    }, executor: { run: async (_command, args) => {
      order.push(order.includes('/view') ? 'convert' : 'prepare');
      assert.ok(args.includes('scale=864:480,fps=25,setsar=1')); assert.ok(args.includes('-an'));
      for (const value of ['libx264', 'yuv420p', '+faststart']) assert.ok(args.includes(value));
      writeFileSync(args.at(-1), output25);
    }, stop: () => {} } });
  const addVideo = s.works.addVideo;
  s.works.addVideo = (...args) => { order.push('store'); return addVideo(...args); };
  await s.media.mesh({ id, source: s.source });
  assert.deepEqual(order, ['ready', 'prepare', '/upload/image', '/prompt', `/history/${id}`, '/view', 'convert', 'store', '/free']);
  assert.equal(existsSync(ownInput), false); assert.equal(existsSync(ownOutput), false);
  assert.equal(existsSync(join(input, 'other.mp4')), true); assert.equal(existsSync(join(output, `${prefix}other.mp4`)), true);
});
test('执行或ComfyUI失败仍free和删本单文件，人话上卡、原文进日志，作品不落盘', async () => {
  const id = newId(), portable = tempDir(), dir = join(portable, 'ComfyUI', 'input');
  mkdirSync(dir, { recursive: true }); const own = join(dir, `mesh-${id}.mp4`); writeFileSync(own, 'copy');
  const order = [], logs = [];
  const s = setup({ fake: false, readEnv: () => ({ COMFYUI_DIR: portable }), logError: (tag, error) => logs.push([tag, error.message]),
    comfyProcess: { ensure: async () => {}, stop: () => {} },
    clientFactory: () => ({ check: async () => {}, upload: async () => { throw Error('ComfyUI 上传失败：disk full'); },
      free: async () => { order.push('free'); assert.equal(existsSync(own), true); } }) });
  await assert.rejects(s.media.mesh({ id, source: s.source }), error => {
    assert.match(error.message, /^本地处理失败，没有自动重跑，花费 0。\n.*上传.*磁盘.*。$/);
    assert.doesNotMatch(error.message, /disk full/); return true;
  });
  assert.ok(logs.some(([, raw]) => raw.includes('disk full')));
  assert.deepEqual(order, ['free']); assert.equal(existsSync(own), false); assert.equal(s.works.list().length, 0);
  assert.deepEqual(readdirSync(join(s.dataRoot, 'processing')), []);
});
test('输出尺寸、帧率或时长不对都不存作品；坏来源或单号不执行', async () => {
  const outputs = [wrong, Buffer.from(output25), Buffer.from(output25)];
  const mvhd = outputs[1].indexOf(Buffer.from('mvhd')) + 4;
  outputs[1].writeUInt32BE(5 * outputs[1].readUInt32BE(mvhd + 12), mvhd + 16);
  const mdhd = outputs[2].indexOf(Buffer.from('mdhd')) + 4;
  outputs[2].writeUInt32BE(outputs[2].readUInt32BE(mdhd + 12) * 2, mdhd + 12);
  for (const bytes of outputs) {
    const s = setup({ executor: { run: async (_cmd, args) => writeFileSync(args.at(-1), bytes), stop: () => {} } });
    await assert.rejects(s.media.mesh(s.job), /输出视频.*不对/); assert.equal(s.works.list().length, 0);
  }
  const s = setup();
  await assert.rejects(s.media.mesh({ id: '../../escape', source: s.source }), /单.*编号/);
  await assert.rejects(s.media.mesh({ id: newId(), source: { type: 'upload', id: 'bad' } }), /来源.*编号/);
  assert.equal(s.calls.length, 0);
});
test('真实ffmpeg同时覆盖假白模和真流程预缩再转码，宽高帧率时长与预期一致', async () => {
  const executor = createExecutor();
  try {
    for (const fake of [true, false]) {
      const s = setup({ executor, fake, comfyProcess: { ensure: async () => {}, stop: () => {} },
        clientFactory: () => ({ check: async () => {}, upload: async bytes => {
          const prepared = parseMp4(bytes); assert.equal(prepared.hasAudio, false);
          assert.equal(prepared.width, 864); assert.equal(prepared.height, 480); assert.equal(prepared.fps, 25); return 'prepared.mp4';
        }, submit: async () => 'prompt', wait: async () => ({}), download: async () => result, free: async () => {} }) });
      const work = await s.media.mesh(s.job), parsed = parseMp4(readFileSync(s.works.path(work.id)));
      assert.equal(work.mesh, true); assert.equal(parsed.width, 864); assert.equal(parsed.height, 480);
      assert.equal(parsed.fps, 25); assert.equal(parsed.duration, 2); assert.equal(parsed.hasAudio, false);
    }
  } finally { executor.stop(); }
});
test('停止只调用自有ComfyUI进程管理器，借用的ffmpeg执行器留给共用本地服务关闭', () => {
  let stops = 0; const s = setup({ comfyProcess: { ensure: async () => {}, stop: () => { stops++; } } });
  s.media.stop(); assert.equal(stops, 1); assert.deepEqual(s.calls, []);
});

test('未确认ComfyUI停止的gpuUnsafe标记及用户动作保留，原文和free失败仅记日志', async () => {
  const logs = [];
  const s = setup({ fake: false, logError: (tag, error) => logs.push([tag, error.message]), comfyProcess: { ensure: async () => {}, stop: () => {} },
    clientFactory: () => ({ check: async () => {}, upload: async () => 'input.mp4', submit: async () => 'prompt',
      wait: async () => { throw Object.assign(Error('轮询断连原话\n无法确认 ComfyUI 已停止'), { gpuUnsafe: true }); },
      free: async () => { throw Error('free断连原话'); } }) });
  await assert.rejects(s.media.mesh(s.job), error => {
    assert.equal(error.gpuUnsafe, true); assert.match(error.message, /无法确认 ComfyUI 已停止.*队列已暂停.*重启小服务/);
    assert.doesNotMatch(error.message, /轮询断连原话|free断连原话/); assert.match(error.message, /花费 0/); return true;
  });
  assert.ok(logs.some(([, raw]) => raw.includes('轮询断连原话')));
  assert.ok(logs.some(([, raw]) => raw.includes('free断连原话')));
  assert.equal(s.works.list().length, 0);
});

test('连不上和释放显存失败不重复上卡，只有一句原因和操作建议，技术原文都在日志', async () => {
  const logs = [];
  const s = setup({ fake: false, logError: (tag, error) => logs.push([tag, error.message]),
    comfyProcess: { ensure: async () => { throw Error('连不上 ComfyUI，先打开它或在 .env.local 填 COMFYUI_DIR，再点一次\n连不上 ComfyUI：fetch failed'); }, stop: () => {} },
    clientFactory: () => ({ free: async () => { throw Error('连不上 ComfyUI：fetch failed'); } }) });
  await assert.rejects(s.media.mesh(s.job), error => {
    assert.equal(error.message, '本地处理失败，没有自动重跑，花费 0。\n连不上 ComfyUI，请先打开它，或在 .env.local 填好 COMFYUI_DIR，再重试。');
    return true;
  });
  assert.equal(logs.length, 2); assert.ok(logs.every(([, raw]) => raw.includes('fetch failed')));
});

test('真实ffmpeg：声音比画面长的视频，假白模按画面时长出片并成功入库', async () => {
  const executor = createExecutor();
  const input = join(tempDir(), 'audio-longer.mp4');
  try {
    await executor.run('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=480x854:rate=24:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', input]);
    const s = setup({ executor });
    const source = { type: 'upload', id: s.uploads.save(readFileSync(input)).id };
    const work = await s.media.mesh({ id: newId(), source });
    assert.equal(parseMp4(readFileSync(s.works.path(work.id))).duration, 1);
  } finally { executor.stop(); }
});

// 10-31 用户定：长视频分段算再拼（372 帧整条要 20 多分钟，分 3 段约 7 分钟）。
test('真实ffmpeg：200 帧切两段各交一次 ComfyUI，段间释放显存，拼回 200 帧、8 秒', async () => {
  const executor = createExecutor(), input = join(tempDir(), 'eight.mp4'), calls = [];
  try {
    await executor.run('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=480x854:rate=25:duration=8',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', input]);
    const uploads = new Map();
    const s = setup({ executor, fake: false, comfyProcess: { ensure: async () => {}, stop: () => {} },
      clientFactory: () => ({ check: async () => {}, free: async () => calls.push('free'),
        upload: async (bytes, name) => { uploads.set(name, bytes); calls.push(['upload', name, Math.round(parseMp4(bytes).duration * 25)]); return name; },
        submit: async (workflow, id) => { calls.push(['submit', workflow['21s'].inputs.filename_prefix]); return workflow['1'].inputs.file; },
        wait: async name => name, download: async name => uploads.get(name) }) });
    const source = { type: 'upload', id: s.uploads.save(readFileSync(input)).id }, id = newId();
    const work = await s.media.mesh({ id, source });
    const parsed = parseMp4(readFileSync(s.works.path(work.id)));
    assert.equal(parsed.duration, 8); assert.equal(parsed.fps, 25); assert.equal(parsed.width, 480);
    assert.deepEqual(calls, [['upload', `mesh-${id}-1.mp4`, 108], ['submit', `video/mesh-${id}-1`], 'free',
      ['upload', `mesh-${id}-2.mp4`, 108], ['submit', `video/mesh-${id}-2`], 'free']);
  } finally { executor.stop(); }
});

test('白模算到一半停止：不再交下一段，照样释放显存、清本单文件，报已停止、作品不落盘', async () => {
  const executor = createExecutor(), input = join(tempDir(), 'eight.mp4'), calls = [], controller = new AbortController();
  try {
    await executor.run('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=480x854:rate=25:duration=8',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', input]);
    const s = setup({ executor, fake: false, comfyProcess: { ensure: async () => {}, stop: () => {} },
      clientFactory: () => ({ check: async () => {}, free: async () => calls.push('free'),
        upload: async (_bytes, name) => { calls.push('upload'); return name; }, submit: async () => 'prompt',
        wait: async (_id, { signal }) => { calls.push('wait'); controller.abort(); assert.equal(signal.aborted, true);
          throw Object.assign(Error('已停止'), { canceled: true }); }, download: async () => assert.fail('不该取回') }) });
    const source = { type: 'upload', id: s.uploads.save(readFileSync(input)).id };
    await assert.rejects(s.media.mesh({ id: newId(), source }, { signal: controller.signal }), error => error.canceled === true);
    assert.deepEqual(calls, ['upload', 'wait', 'free']); assert.equal(s.works.list().length, 0);
    assert.deepEqual(readdirSync(join(s.dataRoot, 'processing')), []);
  } finally { executor.stop(); }
});
