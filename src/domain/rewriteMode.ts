/**
 * 11-19 用户定：工具条只留「视频改写」，点开先三选一，叫法用用户起的。
 * 露不露脸是两套做法的分界：露脸的原片火山不收、要转深度；不露脸的原片直接当参考视频（拆解无人物那套）。
 */
export type RewriteMode = 'face' | 'talking' | 'faceless';
export const REWRITE_MODES: ReadonlyArray<{ id: RewriteMode; label: string; hint: string; tip: string }> = [
  { id: 'face', label: '露脸 · 声音按原视频', hint: '跳舞、走秀', tip: '出片后配回原片的声音' },
  { id: 'talking', label: '露脸 · AI 自己配音', hint: '口播、讲解', tip: '读出原片台词，让 AI 重新说一遍、对上口型' },
  { id: 'faceless', label: '不露脸 · 声音按原视频', hint: '只拍商品和手脚', tip: '原片直接当参考，不能换人；背影、戴口罩但想换人的，选露脸' }
];
export const TALKING_NO_AUDIO = '原片没有声音';
