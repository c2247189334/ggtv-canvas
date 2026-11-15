// 11-09 用户定：背景帧不再固定看第 0 秒（开头常被黑屏、滑动黑板、手挡镜头这类转场弄脏），
// 拆解那一次顺便让 AI 给每个场景挑一帧最适合当背景的、答有没有人；代码只兜底：越界 / 没写取段中，太黑取段中并按有人算。

/** 视频里纯黑的最亮像素约 16（11-09 婚礼开头实测 16~23，渐亮第一帧就到 67），低于 40 算黑屏。 */
export const DARK_PEAK = 40;

export const SCENES_QUESTION = '⑤scenes：按背景分段，地方换了算新的一段；地方没变、但背后或脚下占画面一大块的大布景或大道具整体换成了另一种，也算新的一段；按时间先后各一项。'
  + 'desc先写地点或布景的通用名称，逗号后写外观和光线，不写人；from、to写这段的起止秒数，从第一次看到新背景的那一帧算起。'
  + '同一个地方换机位、分屏的两半、手或东西挡住镜头、黑屏转场、人换衣服都不算新的一段。全片背景不变就只写一项。'
  + 'frame写这段里最适合当背景参考的一帧的秒数：人最少最小、没有手或东西挡住镜头、不在黑屏和转场里、背景露得最多。'
  + 'empty：frame那一帧里一个人都没有（手、胳膊这些身体局部也算有人）写true，否则写false。';

const middleOf = (from, to) => Math.min(to, Math.max(from, Math.round((from + to) * 50) / 100));

/**
 * 背景帧兜底（花不了钱，量不出亮度就照用）：挑的帧太黑改用段中、按有人算（宁可多铺一张去人卡，生成要用户自己点）；
 * 一个场景都没回就当全片一段、取正中、按有人算。places 是 scenePlaces 整理好的场景。
 */
export async function checkSceneFrames(places, duration, peak) {
  const list = places.length ? places : [{ id: 'S1', kind: '场景', desc: '全片', from: 0, to: duration, frame: middleOf(0, duration), empty: false }];
  const dark = async second => {
    try { const value = await peak?.(second); return Number.isFinite(value) && value < DARK_PEAK; } catch { return false; }
  };
  const checked = [];
  for (const place of list) {
    const middle = middleOf(place.from, place.to);
    checked.push(place.frame !== middle && await dark(place.frame) ? { ...place, frame: middle, empty: false } : place);
  }
  return checked;
}

/** 回给页面：每个场景一项，顺序和页面 sceneItems 一样（按开始秒排）；只有一个场景时就是唯一那张背景。 */
export const backgroundFrames = places => places.map(({ frame, empty }) => ({ second: frame, empty }));
