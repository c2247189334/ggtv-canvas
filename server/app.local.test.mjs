import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createApp } from './app.mjs';
import { createFakeSeedance } from './fakeSeedance.mjs';
import { wav } from './fixtures/wav.mjs';
import { createRewrite } from './rewrite.mjs';
import { call, listen, tempDir, waitFor } from './testKit.mjs';

const video=readFileSync(new URL('./fixtures/audio-video.mp4',import.meta.url));
const silent=readFileSync(new URL('./fixtures/fake-video.mp4',import.meta.url));
const depthVideo=readFileSync(new URL('./fixtures/depth-video.mp4',import.meta.url));
const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0,16]);
const post=(s,path,body)=>call(s.port,{method:'POST',path,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const upload=(s,buffer)=>call(s.port,{method:'POST',path:'/api/uploads',headers:{'Content-Type':'video/mp4'},body:buffer});
async function boot(options={}) {
  const calls=[];
  const executor={run:async(cmd,args)=>{calls.push([cmd,args]);writeFileSync(args.at(-1),args.at(-1).endsWith('.wav')?wav():args.at(-1).endsWith('.jpg')?jpeg:depthVideo);},stop:()=>{}};
  const app=createApp({dataRoot:tempDir(),distDir:tempDir(),port:5290,fake:true,readEnv:()=>({}),
    videoClient:createFakeSeedance({delayMs:1}),videoPollMs:1,logError:()=>{},log:()=>{},executor,...options});
  return {app,calls,...await listen(app.handler)};
}
async function done(s,id) {
  let view;await waitFor(async()=>{view=(await call(s.port,{path:`/api/jobs?ids=${id}`})).json[0];return ['failed','succeeded'].includes(view.status);});return view;
}
test('假模式全链路：有声上传→抽原声→声音作品/Range/下载→视频参考成功→删除后引用报已删除',async()=>{
  const s=await boot();
  try {
    const canvas=(await post(s,'/api/canvases',{name:'c'})).json;
    const up=await upload(s,video);assert.equal(up.json.hasAudio,true);
    const extraction=await post(s,'/api/audio-extractions',{source:{type:'upload',id:up.json.id},canvasId:canvas.id});
    assert.equal(extraction.status,200);const work=extraction.json;assert.equal(work.kind,'audio');assert.equal(work.duration,2);
    assert.equal(s.calls[0][0],'ffmpeg');const args=s.calls[0][1];
    assert.equal(args[args.indexOf('-c:a')+1],'pcm_s16le');assert.ok(!args.includes('-ar'));assert.ok(!args.includes('-ac'));
    const listed=(await call(s.port,{path:'/api/works'})).json;assert.equal(listed[0].id,work.id);
    const range=await call(s.port,{path:`/api/works/file?id=${work.id}`,headers:{Range:'bytes=0-43'}});
    assert.equal(range.status,206);assert.equal(range.headers['content-type'],'audio/wav');assert.deepEqual(range.buffer,wav().subarray(0,44));
    const download=await call(s.port,{path:`/api/works/file?id=${work.id}&download=1`});assert.match(download.headers['content-disposition'],/\.wav/);
    const body={canvasId:canvas.id,cardId:'v',prompt:'按照@音频1运动',model:'doubao-seedance-2-5-260628',
      mode:'reference',ratio:'16:9',resolution:'480p',duration:5,audio:true,refs:[{type:'work',id:work.id,duration:999}]};
    const submitted=await post(s,'/api/video-jobs',body);assert.equal(submitted.status,200);
    assert.equal((await done(s,submitted.json.id)).status,'succeeded');
    assert.equal((await call(s.port,{method:'DELETE',path:`/api/works?id=${work.id}`})).status,200);
    assert.equal((await call(s.port,{path:`/api/works/file?id=${work.id}`})).status,404);
    const deleted=await post(s,'/api/video-jobs',body);assert.equal(deleted.status,400);assert.match(deleted.json.error,/删/);
  } finally {s.app.depthQueue?.stop();await s.close();}
});
test('深度接口排队落盘、查询视频作品元数据；无声抽取和超30秒拒绝不调用执行器',async()=>{
  const s=await boot();
  try {
    const up=(await upload(s,video)).json;
    const submitted=await post(s,'/api/depth-jobs',{source:{type:'upload',id:up.id},resolution:'480p'});
    assert.equal(submitted.status,200);const view=await done(s,submitted.json.id);
    assert.equal(view.kind,'depth');assert.equal(view.status,'succeeded');assert.equal(view.workMeta[0].hasAudio,false);
    assert.equal(view.workMeta[0].width,864);assert.equal(view.workMeta[0].height,480);assert.equal(view.workMeta[0].fps,30);
    const work=(await call(s.port,{path:'/api/works'})).json[0];assert.equal(work.depth,true);assert.equal(work.yuan,0);assert.equal(work.resolution,'480p');
    const noAudio=(await upload(s,silent)).json;const count=s.calls.length;
    const rejected=await post(s,'/api/audio-extractions',{source:{type:'upload',id:noAudio.id}});
    assert.equal(rejected.status,400);assert.equal(rejected.json.error,'这段视频没有声音');assert.equal(s.calls.length,count);
    const long=Buffer.from(video),start=long.indexOf(Buffer.from('mvhd'))+4;
    long.writeUInt32BE(31000,start+16);long.writeUInt32BE(1000,start+12);
    const longUp=(await upload(s,long)).json;
    const tooLong=await post(s,'/api/depth-jobs',{source:{type:'upload',id:longUp.id},resolution:'480p'});
    assert.equal(tooLong.status,400);assert.match(tooLong.json.error,/原片超过 30 秒/);assert.equal(s.calls.length,count);
  } finally {s.app.depthQueue?.stop();await s.close();}
});

test('改写接口假模式可辨认/假失败；真模式注入豆包按token记入今天花费且不重试',async()=>{
  const fake=await boot();
  try {
    const result=await post(fake,'/api/rewrite',{prompt:'一只猫',kind:'image'});
    assert.equal(result.status,200);assert.equal(result.json.text,'（假改写）一只猫');assert.equal(result.json.yuan,0);
    const rejected=await post(fake,'/api/rewrite',{prompt:'假失败',kind:'video'});
    assert.equal(rejected.status,502);assert.match(rejected.json.error,/假改写/);
    assert.equal((await call(fake.port,{path:'/api/health'})).json.todayYuan,0);
  } finally {fake.app.depthQueue.stop();await fake.close();}
  const env={ARK_API_KEY:'test-only'};let calls=0;
  const real=await boot({fake:false,readEnv:()=>env,rewrite:createRewrite({env,fetch:async()=>{
    calls++;return new Response(JSON.stringify({choices:[{message:{content:'一只猫。'}}],usage:{prompt_tokens:1000,completion_tokens:500}}));
  }})});
  try {
    const result=await post(real,'/api/rewrite',{prompt:'一只猫',kind:'image'});
    assert.equal(result.status,200);assert.equal(result.json.yuan,0.021);assert.equal(calls,1);
    const originalFetch = globalThis.fetch, probes = [];
    globalThis.fetch = async (url, options) => {
      probes.push({ url: String(url), redirect: options.redirect, signal: options.signal });
      return new Response('{}', { status: 503 });
    };
    try {
      const health = (await call(real.port,{path:'/api/health'})).json;
      assert.equal(health.todayYuan,0.02);
      assert.equal(health.mesh.ready, false);
      assert.deepEqual(probes.map(probe => probe.url), ['http://127.0.0.1:8188/system_stats']);
      assert.equal(probes[0].redirect, 'error');
      assert.ok(probes[0].signal instanceof AbortSignal);
    } finally { globalThis.fetch = originalFetch; }
  } finally {real.app.depthQueue.stop();await real.close();}
});
test('截帧接口：读真实来源，秒数不对 400 不调 ffmpeg，成功回上传图编号且能读出图',async()=>{
  const s=await boot();
  try {
    const up=(await upload(s,video)).json;
    const bad=await post(s,'/api/frame-extractions',{source:{type:'upload',id:up.id},second:5});
    assert.equal(bad.status,400);assert.match(bad.json.error,/截帧秒数/);assert.equal(s.calls.length,0);
    const ok=await post(s,'/api/frame-extractions',{source:{type:'upload',id:up.id},second:1});
    assert.equal(ok.status,200);assert.equal(ok.json.kind,'image');assert.equal(s.calls[0][0],'ffmpeg');
    assert.equal((await call(s.port,{path:`/api/uploads/file?id=${ok.json.id}`})).status,200);
  } finally {s.app.depthQueue?.stop();await s.close();}
});
