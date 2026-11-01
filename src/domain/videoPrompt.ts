/** 依据火山官方示例转换 @图像N / @视频N；尚未真出视频验证。 */
export function toVideoPrompt(text: string, images: number, videos: number, audios = 0, requireAll = false): string {
  const body = text.trim();
  if (!body) throw new Error("先写一句你想要什么。");
  const used = { image: new Set<number>(), video: new Set<number>(), audio: new Set<number>() };
  for (const match of body.matchAll(/@(图片|图像|视频|音频)(\d+)/g)) {
    const video = match[1] === "视频";
    const audio = match[1] === "音频";
    const count = audio ? audios : video ? videos : images;
    const number = Number(match[2]);
    used[audio ? 'audio' : video ? 'video' : 'image'].add(number);
    if (number < 1 || number > count) {
      const description = audio ? "参考音频" : video ? "参考视频" : "参考图";
      throw new Error(`提示词里写了 ${match[0]}，但${count ? `只连了 ${count} ${video || audio ? "段" : "张"}${description}` : `还没连${description}`}。`);
    }
  }
  if (requireAll) {
    for (const [kind, count, label] of [['image', images, '图片'], ['video', videos, '视频'], ['audio', audios, '音频']] as const) {
      for (let number = 1; number <= count; number++) if (!used[kind].has(number)) throw new Error(`连进来的 @${label}${number} 没在提示词里说明用途，请补上或断开它再发。`);
    }
  }
  return body.replace(/@图片(\d+)/g, "@图像$1");
}
