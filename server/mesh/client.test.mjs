import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createComfyClient, comfyUrl, MODEL_FILES, historyVideo } from './client.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
test('只接受本机 HTTP 地址；默认端口与 IPv6 合法；危险地址不发任何请求', () => {
  assert.equal(comfyUrl().href, 'http://127.0.0.1:8188/');
  for (const url of ['http://localhost:8199', 'http://[::1]:8188']) assert.ok(comfyUrl(url));
  for (const url of ['http://example.com', 'http://127.0.0.2', 'http://localhost.evil', 'file:///tmp/a', 'https://x@127.0.0.1', 'bad']) {
    assert.throws(() => createComfyClient({ url, fetch: () => assert.fail('不得联网') }), /只允许.*本机/);
  }
});
test('上传使用multipart，交工作流带client_id，轮询每2秒到完成再下载并free', async () => {
  const calls = [], waits = []; let history = 0;
  const client = createComfyClient({ fetch: async (url, options) => {
    const path = new URL(url).pathname; calls.push([path, options]);
    if (path === '/upload/image') return json({ name: 'job.mp4', subfolder: 'in', type: 'input' });
    if (path === '/prompt') return json({ prompt_id: 'prompt-a' });
    if (path.startsWith('/history/')) return json(++history === 1 ? {} : { 'prompt-a': { status: { completed: true, status_str: 'success' },
      outputs: { '21s': { videos: [{ filename: 'out.mp4', subfolder: 'video', type: 'output' }] } } } });
    if (path === '/view') return new Response(Buffer.from('video'));
    return json({});
  }, sleep: async ms => waits.push(ms) });
  assert.equal(await client.upload(Buffer.from('input'), 'job.mp4'), 'in/job.mp4');
  assert.equal(calls[0][1].body.get('image').name, 'job.mp4');
  assert.equal(calls[0][1].body.get('overwrite'), 'true');
  assert.equal(calls[0][1].body.get('type'), 'input');
  const prompt = { 1: { class_type: 'LoadVideo' } };
  const id = await client.submit(prompt, 'job-id');
  assert.deepEqual(JSON.parse(calls[1][1].body), { prompt, client_id: 'job-id' });
  const output = await client.wait(id);
  assert.deepEqual(waits, [2000]);
  assert.equal((await client.download(output)).toString(), 'video');
  await client.free();
  assert.deepEqual(calls.map(c => c[0]), ['/upload/image', '/prompt', '/history/prompt-a', '/history/prompt-a', '/view', '/free']);
  assert.deepEqual(JSON.parse(calls.at(-1)[1].body), { unload_models: true, free_memory: true });
  assert.ok(calls.every(([, options]) => options.redirect === 'error'));
});
test('缺节点、缺模型逐项说出；预检全部通过才允许下一步', async () => {
  let client = createComfyClient({ fetch: async () => json({}) });
  await assert.rejects(client.check(), /这个地址上的 ComfyUI 没有白模节点/);
  client = createComfyClient({ fetch: async url => new URL(url).pathname.includes('object_info')
    ? json({ SAM3DBody_Render: {} }) : json([]) });
  await assert.rejects(client.check(), /checkpoints\/sam3.1_multiplex_fp16.safetensors/);
  const requests = [];
  client = createComfyClient({ fetch: async url => { const path = new URL(url).pathname; requests.push(path);
    return json(path.includes('object_info') ? { SAM3DBody_Render: {} } : MODEL_FILES.filter(([folder]) => path.endsWith(folder)).map(([, name]) => name));
  } });
  await client.check();
  assert.equal(requests.length, 5);
});
test('node_errors、history异常、连接失败保留中文上下文和原话且不自动重交', async () => {
  let calls = 0;
  const failed = createComfyClient({ fetch: async () => { calls++; return json({ node_errors: { 21: { errors: [{ message: 'bad mesh input' }] } } }, 400); } });
  await assert.rejects(failed.submit({}, 'job'), /ComfyUI.*工作流.*bad mesh input/);
  assert.equal(calls, 1);
  const history = createComfyClient({ fetch: async () => json({ a: { status: { status_str: 'error',
    messages: [['execution_error', { exception_message: 'CUDA kernel failed' }]] } } }) });
  await assert.rejects(history.wait('a'), /ComfyUI.*执行失败.*CUDA kernel failed/);
  const offline = createComfyClient({ fetch: async () => { throw Error('ECONNREFUSED'); } });
  await assert.rejects(offline.submit({}, 'job'), /连不上 ComfyUI.*ECONNREFUSED/);
});
test('总等待有上限，超时中断当前工作流，不自动重交', async () => {
  let time = 0, histories = 0; const paths = [];
  const client = createComfyClient({ now: () => time, timeoutMs: 4000, sleep: async ms => { time += ms; },
    fetch: async url => { const path = new URL(url).pathname; paths.push(path);
      return json(path.startsWith('/history/') && ++histories >= 3 ? { slow: { status: { status_str: 'error' } } } : {}); } });
  await assert.rejects(client.wait('slow'), /白模计算等待超时/);
  assert.deepEqual(paths, ['/history/slow', '/history/slow', '/interrupt', '/history/slow']);
});
test('SaveVideo回包容错解析 videos、images、gifs及嵌套字段，只取视频文件，拒绝无视频的成功回包', () => {
  for (const field of ['videos', 'images', 'gifs', 'animated']) {
    assert.equal(historyVideo({ '21s': { [field]: [{ filename: 'out.mp4', subfolder: 'video', type: 'output' }] } }).filename, 'out.mp4');
  }
  assert.equal(historyVideo({ '21s': { video: { filename: 'out.webm' } } }).filename, 'out.webm');
  assert.throws(() => historyVideo({ '21s': { images: [{ filename: 'preview.png' }] } }), /没有找到.*视频/);
});

test('最后一次history请求跨过截止时间也按超时处理，中断后确认终态才放行', async () => {
  let time = 0, count = 0; const paths = [];
  const client = createComfyClient({ timeoutMs: 4000, now: () => time, fetch: async url => {
    const path = new URL(url).pathname; paths.push(path);
    if (path.startsWith('/history/') && ++count === 1) { time = 4000; throw Error('request aborted at deadline'); }
    return json(path.startsWith('/history/') ? { slow: { status: { status_str: 'error' } } } : {});
  } });
  await assert.rejects(client.wait('slow'), error => {
    assert.match(error.message, /白模计算等待超时/); assert.match(error.message, /request aborted at deadline/);
    assert.notEqual(error.gpuUnsafe, true); return true;
  });
  assert.deepEqual(paths, ['/history/slow', '/interrupt', '/history/slow']);
});
test('轮询断连后中断且确认；中断失败和终态未确认不覆盖原话，并标记GPU不安全', async () => {
  for (const interruptFails of [false, true]) {
    let time = 0; const paths = [];
    const client = createComfyClient({ cancelTimeoutMs: 4000, now: () => time, sleep: async ms => { time += ms; },
      fetch: async url => { const path = new URL(url).pathname; paths.push(path);
        if (paths.length === 1) throw Error('history disconnected');
        if (path === '/interrupt' && interruptFails) throw Error('interrupt disconnected');
        return json({});
      } });
    await assert.rejects(client.wait('unknown'), error => {
      assert.match(error.message, /history disconnected/); assert.match(error.message, /无法确认.*停止/);
      if (interruptFails) assert.match(error.message, /interrupt disconnected/);
      assert.equal(error.gpuUnsafe, true); return true;
    });
    assert.equal(paths.filter(path => path === '/interrupt').length, 1);
    assert.equal(paths.filter(path => path.startsWith('/prompt')).length, 0);
  }
});
test('已确认的history执行失败不再中断；缺节点404也给指定中文原话', async () => {
  const paths = [];
  const client = createComfyClient({ fetch: async url => { paths.push(new URL(url).pathname);
    return json({ a: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'node failed' }]] } } });
  } });
  await assert.rejects(client.wait('a'), /node failed/); assert.deepEqual(paths, ['/history/a']);
  const missing = createComfyClient({ fetch: async () => json({}, 404) });
  await assert.rejects(missing.check(), /这个地址上的 ComfyUI 没有白模节点/);
});

test('交单响应丢失、成功坏JSON或无prompt_id都标记GPU不安全，不重交或全局中断；400明确拒收不暂停', async () => {
  for (const [response, raw] of [
    [async () => { throw Error('prompt response lost'); }, 'prompt response lost'],
    [async () => new Response('broken accepted reply'), 'broken accepted reply'],
    [async () => json({ accepted: true }), '没有返回单号'],
  ]) {
    const paths = [], client = createComfyClient({ fetch: async url => { paths.push(new URL(url).pathname); return response(); } });
    await assert.rejects(client.submit({}, 'job'), error => {
      assert.equal(error.gpuUnsafe, true); assert.ok(error.message.includes(raw));
      assert.match(error.message, /无法确认.*接单.*队列已暂停/); return true;
    });
    assert.deepEqual(paths, ['/prompt']);
  }
  const refused = createComfyClient({ fetch: async () => json({ node_errors: { 21: { errors: ['invalid mesh'] } } }, 400) });
  await assert.rejects(refused.submit({}, 'job'), error => {
    assert.match(error.message, /invalid mesh/); assert.notEqual(error.gpuUnsafe, true); return true;
  });
});

test('等结果时收到停止信号：中断 ComfyUI、确认停下后报已停止，不再查下去', async () => {
  let time = 0, interrupted = false; const paths = [], controller = new AbortController();
  const client = createComfyClient({ now: () => time, sleep: async ms => { time += ms; if (paths.length === 2) controller.abort(); },
    fetch: async url => { const path = new URL(url).pathname; paths.push(path);
      if (path === '/interrupt') { interrupted = true; return json({}); }
      return json(interrupted ? { run: { status: { messages: [['execution_interrupted', {}]] } } } : {}); } });
  await assert.rejects(client.wait('run', { signal: controller.signal }), error => error.canceled === true && !error.gpuUnsafe);
  assert.deepEqual(paths, ['/history/run', '/history/run', '/interrupt', '/history/run']);
});
