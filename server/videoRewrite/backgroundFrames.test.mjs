import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundFrames, checkSceneFrames, DARK_PEAK, SCENES_QUESTION } from './backgroundFrames.mjs';

const place = (id, from, to, frame, empty = false) => ({ id, kind: '场景', desc: `${id}，白色`, from, to, frame, empty });

test('11-09 用户定问法：按背景分段，大布景 / 大道具整体换了也算；人换衣服、手挡镜头、黑屏转场不算；每段挑最适合当背景的一帧并答有没有人', () => {
  for (const word of ['按背景分段', '大布景或大道具整体换成了另一种', '人换衣服', '手或东西挡住镜头', '黑屏转场', '不算新的一段',
    'frame写这段里最适合当背景参考的一帧', '人最少最小', '没有手或东西挡住镜头', '不在黑屏和转场里', '背景露得最多', 'empty', '写true', '写false', '全片背景不变就只写一项']) {
    assert.ok(SCENES_QUESTION.includes(word), word);
  }
  assert.doesNotMatch(SCENES_QUESTION, /第0秒|开头帧|opening/);
});

test('挑的帧不黑：照用，有没有人照 AI 答的', async () => {
  const checked = await checkSceneFrames([place('S1', 0, 4, 1.8, true), place('S2', 4, 10, 9)], 10, async () => 220);
  assert.deepEqual(checked.map(({ frame, empty }) => [frame, empty]), [[1.8, true], [9, false]]);
});

test('挑的帧太黑（最亮像素低于 40）：改用段中，按有人算（宁可多铺一张去人卡）', async () => {
  const peeks = [];
  const checked = await checkSceneFrames([place('S1', 0, 4, 0.1, true)], 4, async second => { peeks.push(second); return second === 0.1 ? 16 : 200; });
  assert.equal(DARK_PEAK, 40);
  assert.deepEqual(peeks, [0.1]);
  assert.deepEqual(checked.map(({ frame, empty }) => [frame, empty]), [[2, false]]);
});

test('挑的就是段中：黑也不再换（没有更好的兜底）', async () => {
  const checked = await checkSceneFrames([place('S1', 0, 4, 2, true)], 4, async () => 16);
  assert.deepEqual(checked.map(({ frame, empty }) => [frame, empty]), [[2, true]]);
});

test('量不出亮度（没有 ffmpeg、读不到、报错）：照用挑的帧，不让拆解白花钱', async () => {
  for (const peak of [async () => null, async () => { throw Error('ffmpeg 退出码 1'); }, undefined]) {
    const checked = await checkSceneFrames([place('S1', 0, 4, 0.1)], 4, peak);
    assert.equal(checked[0].frame, 0.1);
  }
});

test('一个场景都没回：当全片一段，取全片正中、按有人算', async () => {
  const checked = await checkSceneFrames([], 12.3, async () => 200);
  assert.deepEqual(checked.map(({ from, to, frame, empty }) => [from, to, frame, empty]), [[0, 12.3, 6.15, false]]);
});

test('回给页面：每个场景一项秒数和有没有人，顺序和场景一样', () => {
  assert.deepEqual(backgroundFrames([place('S1', 0, 4, 1.8, true), place('S2', 4, 10, 9)]), [{ second: 1.8, empty: true }, { second: 9, empty: false }]);
});
