// 11-19 第二期：人物带声音样本（设计 docs/specs/2026-11-19-口播改写-design.md 第 8 节）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { characterSetup } from './characterTestKit.mjs';
import { wav } from '../fixtures/wav.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function withCharacter() {
  const s = characterSetup();
  const works = s.app.stores.works;
  const image = works.add(png, {});
  const created = await s.call('POST', '/api/characters', { name: '阿青', description: '', images: [{ type: 'work', id: image.id }] });
  assert.equal(created.status, 200);
  return { ...s, works, id: created.json.id };
}

test('存声音：带上秒数回给页面，嗓音描述去掉首尾空格；再存一段就换掉', async () => {
  const s = await withCharacter();
  const first = s.works.addAudio(wav(6)), second = s.works.addAudio(wav(8));
  const saved = await s.call('PATCH', '/api/characters', { id: s.id, voice: { workId: first.id, desc: '  清亮的年轻男声 ' } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.voice, { ref: { type: 'work', id: first.id }, desc: '清亮的年轻男声', seconds: 6 });
  const swapped = await s.call('PATCH', '/api/characters', { id: s.id, voice: { workId: second.id, desc: '低一点的男声' } });
  assert.equal(swapped.json.voice.ref.id, second.id);
  const list = await s.call('GET', '/api/characters');
  assert.equal(list.json[0].voice.seconds, 8);
  assert.equal(list.json[0].name, '阿青', '改声音不动名字');
});

test('删声音：voice 传 null 就没了，人物照样能读', async () => {
  const s = await withCharacter();
  const audio = s.works.addAudio(wav(5));
  await s.call('PATCH', '/api/characters', { id: s.id, voice: { workId: audio.id, desc: '男声' } });
  const removed = await s.call('PATCH', '/api/characters', { id: s.id, voice: null });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.voice, undefined);
  const list = await s.call('GET', '/api/characters');
  assert.equal(list.json.length, 1); assert.equal(list.json[0].voice, undefined);
});

test('拒收：不是声音作品、太短太长、没写嗓音、嗓音里有花括号', async () => {
  const s = await withCharacter();
  const image = s.works.add(png, {});
  const short = s.works.addAudio(wav(1)), long = s.works.addAudio(wav(16)), ok = s.works.addAudio(wav(6));
  const cases = [
    [{ workId: image.id, desc: '男声' }, /不是声音作品/],
    [{ workId: short.id, desc: '男声' }, /2 到 15 秒/],
    [{ workId: long.id, desc: '男声' }, /2 到 15 秒/],
    [{ workId: ok.id, desc: '  ' }, /嗓音描述/],
    [{ workId: ok.id, desc: '男声{你好}' }, /\{ \}/],
    [{ workId: 'bad', desc: '男声' }, /编号不对/]
  ];
  for (const [voice, message] of cases) {
    const result = await s.call('PATCH', '/api/characters', { id: s.id, voice });
    assert.equal(result.status, 400, JSON.stringify(voice));
    assert.match(result.json.error, message);
  }
  const list = await s.call('GET', '/api/characters');
  assert.equal(list.json[0].voice, undefined, '拒收时什么都没存');
});

test('声音作品删了：人物不再显示声音，存档不坏', async () => {
  const s = await withCharacter();
  const audio = s.works.addAudio(wav(6));
  await s.call('PATCH', '/api/characters', { id: s.id, voice: { workId: audio.id, desc: '男声' } });
  s.works.remove(audio.id);
  const list = await s.call('GET', '/api/characters');
  assert.equal(list.json.length, 1); assert.equal(list.json[0].voice, undefined);
});
