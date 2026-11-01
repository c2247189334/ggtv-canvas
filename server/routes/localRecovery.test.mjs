import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDir } from '../testKit.mjs';
import { createRouter } from '../http.mjs';
import { jobRoutes } from './jobs.mjs';
import { createJobStore } from '../store/jobs.mjs';
const canvasId = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
test('按画布和卡找回最新本地单，不能串到其他画布／卡／付费单', async () => {
  let tick = 0; const jobs = createJobStore(tempDir('local-recovery-'), { now: () => new Date(++tick * 1000) });
  jobs.create({ canvasId, cardId: 'child', kind: 'depth' });
  const latest = jobs.create({ canvasId, cardId: 'child', kind: 'depth' });
  jobs.patch(latest.id, { status: 'running' });
  jobs.create({ canvasId: other, cardId: 'child', kind: 'mesh' });
  jobs.create({ canvasId, cardId: 'not-requested', kind: 'depth' });
  jobs.create({ canvasId, cardId: 'child', kind: 'video' });
  const router = createRouter(); jobRoutes(router, { jobs, works: { metadata: () => null } });
  const handler = router.find('GET', '/api/local-jobs'); assert.equal(typeof handler, 'function');
  let payload;
  await handler({ query: new URLSearchParams({ canvasId, cardIds: 'child,missing' }), res: {
    writeHead: status => assert.equal(status, 200), end: text => { payload = JSON.parse(text); }
  } });
  assert.deepEqual(payload.map(view => [view.id, view.cardId, view.kind, view.status]), [[latest.id, 'child', 'depth', 'running']]);
});
