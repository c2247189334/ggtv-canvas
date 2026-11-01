/**
 * 发给火山的提示词。框里写什么就发什么（旧项目 2026-09-20 用户拍板「中间没有任何人替他加话」），只做两件事：
 *   1. 连了参考图时，最前面加一行编号说明（旧项目 freeEditPrompt.ts 那一行，真出图验过）；
 *   2. 框里的 `@图片N` 换成「图N」，和那行说明对上号。
 * ⚠ 换成「图N」是照旧项目的叫法定的；火山认不认原样的「@图片1」没试过，所以换掉保险。
 */
export function refToken(n: number): string {
  return `@图片${n}`;
}

function imageLine(count: number): string {
  if (count === 1) return "只有 1 张图，就是图1。";
  const names = Array.from({ length: count }, (_, i) => `图${i + 1}`).join("、");
  return `一共 ${count} 张图，按顺序是${names}。`;
}

/** 拼出真正发出去的那段话。空的、引用了没连的图，直接抛人话。 */
export function toSendPrompt(text: string, refCount: number): string {
  const body = (text ?? "").trim();
  if (!body) throw new Error("先写一句你想要什么。");
  const bad = [...body.matchAll(/@图片(\d+)/g)].map((m) => Number(m[1])).find((n) => n < 1 || n > refCount);
  if (bad !== undefined) {
    throw new Error(refCount ? `提示词里写了 @图片${bad}，但只连了 ${refCount} 张参考图。` : `提示词里写了 @图片${bad}，但还没连参考图。`);
  }
  const replaced = body.replace(/@图片(\d+)/g, "图$1");
  return refCount > 0 ? `${imageLine(refCount)}\n\n${replaced}` : replaced;
}

/** 点参考缩略图：把 @图片N 接到提示词末尾，前后补空格。 */
export function appendToken(text: string, token: string): string {
  const needsSpace = text.length > 0 && !/\s$/.test(text);
  return `${text}${needsSpace ? " " : ""}${token} `;
}
