import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterPrompt, characterVideo, characterImageJob, FLASH_MODEL } from './characterPolicy.mjs';
import { priceOf } from './pricing.mjs';

const now = Date.parse('2026-11-03T12:00:00Z');
const work = { model: 'doubao-seedream-5-0-flash-260915', refs: [], createdAt: new Date(now).toISOString() };

test('设定图提示词逐字固定，交单为Flash2K16:9纯文字单张并沿用单价', () => {
  assert.equal(characterPrompt('黑发成年女性'), '黑发成年女性。人物设定图：同一个人，左边依次是正面、侧面、背面三个全身像，右边是一张脸部正面特写；纯白背景，柔和均匀的光，写实照片质感，画面里只有这一个人，不要任何文字和标注。');
  assert.deepEqual(characterImageJob('character-id', '描述'), {
    canvasId: null, cardId: null, characterId: 'character-id', model: FLASH_MODEL,
    prompt: characterPrompt('描述'), size: '2736x1536', count: 1, refs: [], priceYuan: priceOf(FLASH_MODEL)
  });
});

test('视频状态素材编号优先，上传图提示photo，图生图及其他模型为edited', () => {
  assert.deepEqual(characterVideo({ ref: { type: 'upload' }, assetId: 'person-01' }, null, now), { status: 'asset' });
  assert.deepEqual(characterVideo({ ref: { type: 'upload' } }, null, now), { status: 'photo' });
  for (const meta of [{ ...work, refs: [{ type: 'upload', id: 'ref' }] }, { ...work, model: 'other' }]) {
    assert.deepEqual(characterVideo({ ref: { type: 'work' } }, meta, now), { status: 'edited' });
  }
});

test('Flash和Lite纯文字作品可信30天，剩余天数向上取整，30天边界过期', () => {
  for (const model of [work.model, 'doubao-seedream-5-0-lite-260128']) {
    const image = { ref: { type: 'work' } }, meta = { ...work, model };
    assert.deepEqual(characterVideo(image, meta, now), { status: 'trusted', days: 30 });
    assert.deepEqual(characterVideo(image, meta, now + 86400000 + 1), { status: 'trusted', days: 29 });
    assert.deepEqual(characterVideo(image, meta, now + 30 * 86400000 - 1), { status: 'trusted', days: 1 });
    assert.deepEqual(characterVideo(image, meta, now + 30 * 86400000), { status: 'expired' });
  }
  assert.deepEqual(characterVideo({ ref: { type: 'work' } }, { ...work, createdAt: 'broken' }, now), { status: 'expired' });
});
