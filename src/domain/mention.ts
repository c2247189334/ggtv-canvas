/** 仅在本次编辑插入一个 @ 时打开引用列表，返回这个 @ 的字符位置。 */
export function mentionTrigger(previous: string, text: string, caret: number, selection?: { start: number; end: number }): number | null {
  const at = caret - 1;
  if (at < 0 || text[at] !== "@") return null;
  const start = selection?.start ?? at;
  const end = selection?.end ?? at;
  if (start !== at || start < 0 || end < start || end > previous.length) return null;
  return previous.slice(0, start) + "@" + previous.slice(end) === text ? at : null;
}

/** 替换触发列表的 @，不改后面的文字；光标紧跟引用及末尾空格。 */
export type RefMedia = "image" | "video" | "audio";
export function insertMention(text: string, at: number, number: number, media: RefMedia = "image"): { text: string; caret: number } | null {
  if (at < 0 || text[at] !== "@" || !Number.isInteger(number) || number < 1) return null;
  const token = `@${media === "video" ? "视频" : media === "audio" ? "音频" : "图片"}${number} `;
  return { text: text.slice(0, at) + token + text.slice(at + 1), caret: at + token.length };
}

/** 保持连线顺序；图片、视频、音频分别从 1 开始编号。 */
export function numberMediaRefs(refs: readonly { media?: RefMedia }[]): Array<{ media: RefMedia; number: number }> {
  const counts = { image: 0, video: 0, audio: 0 };
  return refs.map(ref => {
    const media = ref.media === "video" || ref.media === "audio" ? ref.media : "image";
    return { media, number: ++counts[media] };
  });
}
