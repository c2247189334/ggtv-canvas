import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalMedia, depthGeometry, SMALL_SHA256 } from './local.mjs';
import { createDepthQueue } from './queue.mjs';
import { createWorkStore } from '../store/works.mjs';
import { createJobStore } from '../store/jobs.mjs';
import { createUploadStore } from '../store/uploads.mjs';
import { createQueue } from '../queue.mjs';
import { pruneUploads } from '../cleanup.mjs';
import { tempDir, waitFor } from '../testKit.mjs';
import { wav } from '../fixtures/wav.mjs';
import { createExecutor } from './executor.mjs';
import { parseMp4 } from '../mp4.mjs';
import { imageSize } from '../imageSize.mjs';

const video = readFileSync(new URL('../fixtures/audio-video.mp4', import.meta.url));
const silent = readFileSync(new URL('../fixtures/fake-video.mp4', import.meta.url));
const depthVideo = readFileSync(new URL('../fixtures/depth-video.mp4', import.meta.url));
function setup(extra = {}) {
  const dataRoot = tempDir();
  const stores = { uploads: createUploadStore(dataRoot), works: createWorkStore(dataRoot), jobs: createJobStore(dataRoot) };
  const source = { type: 'upload', id: stores.uploads.save(video).id };
  const calls = [];
  const executor = { run: async (cmd, args) => {
    calls.push([cmd, args]); const output=Buffer.from(depthVideo);
    if(args.includes('720p')) {
      // 注入的执行器只伪造媒体元数据，真实ffmpeg另做人工全链路验证。
      const tkhd=output.indexOf(Buffer.from('tkhd'))+4;
      output.writeUInt32BE(1296*65536,tkhd+76);output.writeUInt32BE(720*65536,tkhd+80);
    }
    writeFileSync(args.at(-1), output);
  }, stop: () => calls.push('stop') };
  const media = createLocalMedia({ dataRoot, ...stores, fake: true, executor, readEnv: () => ({}), ...extra });
  return { ...stores, dataRoot, source, calls, executor, media };
}
test('深度输出短边、总像素、帧率和不支持比例；超30秒原话拒收', () => {
  for (const [w, h, resolution, fps, wanted] of [[1920,1080,'480p',30,[854,480,30]], [1000,1000,'480p',12,[640,640,24]],
    [1000,1000,'720p',90,[720,720,60]], [1080,1920,'720p',29.97,[720,1280,29.97]]]) {
    assert.deepEqual(depthGeometry({ width:w, height:h, fps }, resolution), { width:wanted[0],height:wanted[1],fps:wanted[2] });
  }
  const s = setup();
  const long=Buffer.from(video); const mvhd=long.indexOf(Buffer.from('mvhd'))+4;
  long.writeUInt32BE(31*long.readUInt32BE(mvhd+12),mvhd+16);
  assert.throws(() => s.media.checkSource({type:'upload',id:s.uploads.save(long).id}, {maxSeconds:30}), /原片超过 30 秒/);
  assert.throws(() => depthGeometry({width:100,height:1000,fps:30},'480p'), /宽高比/);
});
test('假深度只调ffmpeg灰度缩放/H264/帧率/时长，不调用python，输出是真视频作品', async () => {
  const s = setup(); const work = await s.media.depth({ source:s.source, resolution:'480p' });
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0][0], 'ffmpeg');
  const args = s.calls[0][1];
  assert.ok(args.includes('format=gray,scale=864:480,fps=30,setsar=1'));
  assert.ok(args.includes('libx264')); assert.ok(args.includes('-an'));
  assert.equal(args[args.indexOf('-t')+1], '2');
  assert.equal(work.kind,'video'); assert.equal(work.depth,true); assert.equal(work.yuan,0);
  assert.deepEqual(work.source,s.source); assert.ok(work.elapsedSeconds>=0);
});
test('缺配置逐项说明；错误权重拒绝且不执行python；可选包不填允许', async () => {
  for (const [env, missing] of [[{},'DEPTH_PYTHON'],[{ DEPTH_PYTHON:'python' },'DEPTH_MODEL_DIR']]) {
    const s=setup({fake:false,readEnv:()=>env});
    await assert.rejects(s.media.depth({source:s.source,resolution:'720p'}), new RegExp(missing));
    assert.equal(s.calls.length,0);
  }
  const model = tempDir(); mkdirSync(join(model,'video_depth_anything'));
  mkdirSync(join(model,'checkpoints')); writeFileSync(join(model,'checkpoints','video_depth_anything_vits.pth'),'wrong');
  const env={DEPTH_PYTHON:process.execPath,DEPTH_MODEL_DIR:model};
  const s=setup({fake:false,readEnv:()=>env});
  await assert.rejects(s.media.depth({source:s.source,resolution:'480p'}), /SHA256.*Small/);
  assert.equal(s.calls.length,0); assert.equal(SMALL_SHA256,'13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609');
});
test('真深度python参数包含配置/输入输出/分辨率，可选额外包在最前；失败卡上只留人话，英文原文只进日志', async () => {
  const env={DEPTH_PYTHON:process.execPath,DEPTH_MODEL_DIR:'model',DEPTH_EXTRA_PACKAGES:'extras'};
  const s=setup({fake:false,readEnv:()=>env, verifyModel:async()=>{}});
  const work=await s.media.depth({source:s.source,resolution:'720p'});
  assert.equal(work.depth,true); assert.equal(s.calls[0][0],process.execPath);
  const a=s.calls[0][1];
  for(const value of ['--input','--output','--resolution','720p','--model-dir','model','--extra-packages','extras']) assert.ok(a.includes(value));
  // 10-31 开源前检查：原来把 Python / ffmpeg 的英文原文直接贴在卡上。
  for (const [raw, shown] of [
    ['python 退出码 1\nTraceback (most recent call last):\n  File "C:\\x\\depth_video.py"\ntorch.OutOfMemoryError: CUDA out of memory', /显存不够/],
    ['python 退出码 1\nTraceback (most recent call last):\nModuleNotFoundError: No module named cv2', /Python 环境缺少依赖包.*DEPTH_EXTRA_PACKAGES/],
    ['python 退出码 1\nTraceback (most recent call last):\nValueError: 原片超过 30 秒，火山参考视频最长 30 秒，请先截短。', /\n原片超过 30 秒，火山参考视频最长 30 秒，请先截短。$/],
    ['ffmpeg 退出码 1\n[in#0 @ 000001] Error opening input: Invalid data found', /详情见小服务日志/]]) {
    const logged=[];
    const failed=setup({executor:{run:async()=>{throw Error(raw);},stop:()=>{}},logError:(label,error)=>logged.push([label,error.message])});
    const error=await failed.media.depth({source:failed.source,resolution:'480p'}).catch(e=>e);
    assert.match(error.message, shown);
    assert.doesNotMatch(error.message, /退出码|Traceback|Error|File "|[A-Za-z]:\\/);
    assert.equal(logged.length,1); assert.ok(logged[0][1].includes(raw));
  }
});
test('无音轨直接拒绝，不调用ffmpeg', async () => {
  const s=setup(); const source={type:'upload',id:s.uploads.save(silent).id};
  await assert.rejects(s.media.extract({source}), /这段视频没有声音/); assert.equal(s.calls.length,0);
});
test('深度先落盘、同时只跑一条、失败不重跑、重启运行单标失败、退出调用stop', async () => {
  const s=setup(); const releases=[]; let active=0, peak=0, calls=0, stops=0;
  const media={depth:async input=>{calls++;active++;peak=Math.max(peak,active);
    await new Promise(resolve=>releases.push(resolve)); active--; if(input.resolution==='bad')throw Error('没 CUDA\nNO_CUDA');
    return s.works.addVideo(silent,{depth:true,source:s.source});},stop:()=>{stops++;}};
  const queue=createDepthQueue({...s,media});
  const a=queue.submit({source:s.source,resolution:'bad'}), b=queue.submit({source:s.source,resolution:'480p'});
  assert.equal(s.jobs.read(a.id).status,'running'); assert.equal(s.jobs.read(b.id).status,'queued');
  await waitFor(()=>calls===1); assert.equal(calls,1); releases.shift()(); await waitFor(()=>calls===2); releases.shift()();
  await waitFor(()=>s.jobs.read(b.id).status==='succeeded');
  assert.equal(peak,1); assert.equal(calls,2); assert.match(s.jobs.read(a.id).error,/没 CUDA/);
  const interrupted=s.jobs.create({kind:'depth',source:s.source});s.jobs.patch(interrupted.id,{status:'running'});
  assert.equal(queue.recover(),1);assert.match(s.jobs.read(interrupted.id).error,/小服务中途关了，没算完，可以再点一次/);
  const imageQueue=createQueue({...s});assert.equal(imageQueue.recover(),0);
  const queued=s.jobs.create({kind:'depth',source:s.source});imageQueue.pump();assert.equal(s.jobs.read(queued.id).status,'queued');
  queue.stop();assert.equal(stops,1);
});
test('启动清理保留本地队列源视频', () => {
  const s=setup(); s.jobs.create({kind:'depth',source:s.source});
  const result=pruneUploads({...s,canvases:{docs:()=>[]}});
  assert.equal(result.removed,0);assert.ok(s.uploads.path(s.source.id));
});
test('只有声音作品引用、没有画布和队列时也保留源视频',()=>{
  const s=setup();s.works.addAudio(wav(),{source:s.source});
  assert.equal(s.jobs.list().length,0);
  const result=pruneUploads({...s,canvases:{docs:()=>[]}});
  assert.equal(result.removed,0);assert.ok(s.uploads.path(s.source.id));
});
test('执行器产物尺寸不对时不入作品库，明确报失败',async()=>{
  const s=setup({executor:{run:async(_cmd,args)=>writeFileSync(args.at(-1),silent),stop:()=>{}}});
  await assert.rejects(s.media.depth({source:s.source,resolution:'480p'}),/输出视频.*尺寸/);
  assert.equal(s.works.list().length,0);
});

test('真实ffmpeg：720×1280竖屏假深度成功，显示宽高正好480×854', async () => {
  const executor = createExecutor();
  const folder = tempDir(), input = join(folder, 'portrait.mp4');
  try {
    await executor.run('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24',
      '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', input]);
    const s = setup({ executor });
    const source = { type: 'upload', id: s.uploads.save(readFileSync(input)).id };
    const work = await s.media.depth({ source, resolution: '480p' });
    assert.equal(work.depth, true); assert.equal(work.yuan, 0);
    assert.equal(work.width, 480); assert.equal(work.height, 854);
    const parsed = parseMp4(readFileSync(s.works.path(work.id)));
    assert.equal(parsed.width, 480); assert.equal(parsed.height, 854);
    assert.equal(parsed.fps, 24); assert.equal(parsed.duration, 1);
  } finally { executor.stop(); }
});
test('截背景帧：时长外直接拒绝不调ffmpeg；真实ffmpeg截出JPG存进上传，末尾秒数也截得到', async () => {
  const s = setup();
  for (const second of [-1, 2, 9, Number.NaN, '1']) await assert.rejects(s.media.frame({ source: s.source, second }), /截帧秒数/);
  assert.equal(s.calls.length, 0);
  const executor = createExecutor();
  try {
    const real = setup({ executor });
    for (const second of [0, 1, 1.99]) {
      const saved = await real.media.frame({ source: real.source, second });
      assert.equal(saved.kind, 'image');
      assert.deepEqual([...readFileSync(real.uploads.path(saved.id)).subarray(0, 3)], [0xff, 0xd8, 0xff]);
    }
  } finally { executor.stop(); }
});

// 10-31 开源前检查：手机竖拍只写旋转标记（存 1280×720、显示 720×1280），原来深度出横片还变形；非方形像素截帧也变形。
test('真实ffmpeg：带旋转标记的竖拍出竖的深度片和竖的第一帧；非方形像素第一帧按显示比例', async () => {
  const executor = createExecutor();
  const folder = tempDir(), plain = join(folder, 'plain.mp4'), turned = join(folder, 'turned.mp4'), wide = join(folder, 'sar2.mp4');
  try {
    await executor.run('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=1',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', plain]);
    await executor.run('ffmpeg', ['-v', 'error', '-n', '-display_rotation', '90', '-i', plain, '-c', 'copy', turned]);
    await executor.run('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=192x320:rate=24:duration=1',
      '-vf', 'setsar=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', wide]);
    const s = setup({ executor });
    const source = { type: 'upload', id: s.uploads.save(readFileSync(turned)).id };
    assert.deepEqual([s.uploads.metadata(source.id).width, s.uploads.metadata(source.id).height], [720, 1280]);
    const work = await s.media.depth({ source, resolution: '480p' });
    assert.deepEqual([work.width, work.height], [480, 854]);
    const frameSize = async src => imageSize(readFileSync(s.uploads.path((await s.media.frame({ source: src, second: 0.5 })).id)));
    assert.deepEqual(await frameSize(source), { width: 720, height: 1280 });
    assert.deepEqual(await frameSize({ type: 'upload', id: s.uploads.save(readFileSync(wide)).id }), { width: 384, height: 320 });
  } finally { executor.stop(); }
});

// 10-31 用户实拍：画面 14.866 秒、声音 14.977 秒，整个文件时长按声音算，深度按画面出片被误判「时长不对」。
test('真实ffmpeg：声音比画面长的视频，假深度按画面时长出片并成功入库', async () => {
  const executor = createExecutor();
  const folder = tempDir(), input = join(folder, 'audio-longer.mp4');
  try {
    await executor.run('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=480x854:rate=24:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', input]);
    const s = setup({ executor });
    const source = { type: 'upload', id: s.uploads.save(readFileSync(input)).id };
    const meta = s.uploads.metadata(source.id);
    assert.ok(meta.duration > 1.4); assert.equal(meta.videoDuration, 1);
    const work = await s.media.depth({ source, resolution: '480p' });
    assert.equal(parseMp4(readFileSync(s.works.path(work.id))).duration, 1);
  } finally { executor.stop(); }
});

test('深度停止：信号交给执行器，结果带已停止标记、不存作品', async () => {
  const controller = new AbortController();
  const s = setup({ executor: { run: async (_cmd, _args, { signal }) => { controller.abort(); assert.equal(signal.aborted, true);
    throw Object.assign(Error('已停止'), { canceled: true }); }, stop: () => {} } });
  await assert.rejects(s.media.depth({ source: s.source, resolution: '480p' }, { signal: controller.signal }), error => error.canceled === true);
  assert.equal(s.works.list().length, 0);
});
