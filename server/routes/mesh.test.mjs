import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { localMediaRoutes } from './localMedia.mjs';
import { jobView } from './jobs.mjs';

test('白模接口与深度同样校验来源和卡编号，固定480p不接受resolution', async () => {
  const routes = new Map(), calls = [];
  localMediaRoutes({ add: (method, path, fn) => routes.set(`${method} ${path}`, fn) }, {
    media: { checkSource: source => {
      if (!source || source.type !== 'upload') throw Error('视频来源不对。');
      return { width: 1920, height: 1080, fps: 30, duration: 6 };
    } }, depthQueue: { submit: job => { calls.push(job); return { id: 'mesh-id' }; } }
  });
  const handler = routes.get('POST /api/mesh-jobs'); assert.equal(typeof handler, 'function');
  const invoke = body => handler({ req: Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    headers: { 'content-type': 'application/json' }
  }), res: {
    writeHead: code => assert.equal(code, 200), end: value => assert.deepEqual(JSON.parse(value), { id: 'mesh-id' })
  } });
  await assert.rejects(invoke({}), /视频来源/);
  await assert.rejects(invoke({ cardId: '../bad' }), /卡片编号/);
  await assert.rejects(invoke({ source: { type: 'upload', id: 'id' }, resolution: '720p' }), /白模.*480/);
  await invoke({ source: { type: 'upload', id: 'id' }, cardId: 'card-1' });
  assert.deepEqual(calls, [{ source: { type: 'upload', id: 'id' }, cardId: 'card-1', kind: 'mesh', resolution: '480p' }]);
});

test('查白模单带来源、错误码和真实视频workMeta', () => {
  const source = { type: 'upload', id: 'source' };
  const view = jobView({ id: 'job', kind: 'mesh', source, works: ['video', 'deleted'], errorCode: 'MESH_FAILED' }, {
    metadata: id => id === 'video' ? { kind: 'video', duration: 6, width: 854, height: 480, hasAudio: false, fps: 30 } : null
  });
  assert.equal(view.kind, 'mesh'); assert.deepEqual(view.source, source); assert.equal(view.errorCode, 'MESH_FAILED');
  assert.deepEqual(view.workMeta, [{ id: 'video', duration: 6, width: 854, height: 480, hasAudio: false, fps: 30 }]);
});

test('共享显卡队列暂停后，深度和白模交单接口保留原话返回503', async () => {
  const routes = new Map();
  localMediaRoutes({ add: (method, path, fn) => routes.set(`${method} ${path}`, fn) }, {
    media: { checkSource: () => ({ width: 864, height: 480, fps: 30 }) },
    depthQueue: { submit: () => { throw Error('无法确认ComfyUI已停止，请先确认停止并重启小服务'); } }
  });
  for (const [path, extra] of [['/api/depth-jobs', { resolution: '480p' }], ['/api/mesh-jobs', {}]]) {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ source: { type: 'upload', id: 'source' }, ...extra }))]), {
      headers: { 'content-type': 'application/json' }
    });
    await assert.rejects(routes.get(`POST ${path}`)({ req, res: {} }), error => {
      assert.equal(error.status, 503); assert.match(error.message, /无法确认ComfyUI已停止，请先确认停止并重启小服务/); return true;
    });
  }
});
