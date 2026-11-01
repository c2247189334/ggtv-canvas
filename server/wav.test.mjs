import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWav } from './wav.mjs';
import { createWorkStore } from './store/works.mjs';
import { tempDir } from './testKit.mjs';
import { wav } from './fixtures/wav.mjs';
test('纯JS读wav真实时长、声道、采样率和16位PCM，拒截断与伪头', () => {
  assert.deepEqual(parseWav(wav()), { kind: 'audio', contentType: 'audio/wav', duration: 2, channels: 2,
    sampleRate: 48000, bitsPerSample: 16, bytes: 384044 });
  assert.equal(parseWav(wav().subarray(0, 100)), null);
  assert.equal(parseWav(Buffer.from('RIFFnotwave')), null);
  const bad = wav(); bad.writeUInt32LE(1, 28);
  assert.equal(parseWav(bad), null);
});
test('声音作品可持久化列出读取删除，元数据来自wav头', () => {
  const root = tempDir(); const store = createWorkStore(root);
  const source = { type: 'upload', id: 'source' };
  const work = store.addAudio(wav(), { source, duration: 999, format: 'wav' });
  assert.equal(work.kind, 'audio'); assert.equal(work.duration, 2);
  assert.deepEqual(work.source, source); assert.equal(work.format, 'wav');
  assert.equal(createWorkStore(root).list()[0].id, work.id);
  assert.equal(store.metadata(work.id).bytes, 384044);
  assert.deepEqual(store.read(work.id).buffer, wav());
  assert.equal(store.remove(work.id), true); assert.equal(store.metadata(work.id), null);
  assert.deepEqual(store.list(), []);
});
