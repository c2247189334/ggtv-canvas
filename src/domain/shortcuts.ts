type Key = { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; isComposing?: boolean };
export type EscapeLayer = { id: string; priority: number };
type EscapeAction = { type: "close"; id: string } | { type: "deselect" | "ignore" };

/** 高层优先，同层后开的优先；一次按键只返回一个动作。 */
export function escapeAction(event: Key & { repeat?: boolean; defaultPrevented?: boolean }, layers: readonly EscapeLayer[]): EscapeAction {
  if (event.key !== "Escape" || event.repeat || event.defaultPrevented || event.isComposing) return { type: "ignore" };
  const top = layers.reduce<EscapeLayer | undefined>((top, layer) => !top || layer.priority >= top.priority ? layer : top, undefined);
  return top ? { type: "close", id: top.id } : { type: "deselect" };
}

export type ShortcutAction = "undo" | "redo" | "copy" | "paste" | "duplicate" | "link" | "delete" | "escape" | "zoomIn" | "zoomOut" | "fit" | "send";

export function shortcutAction(event: Key, context: { editable: boolean; prompt?: boolean }): ShortcutAction | null {
  if (event.isComposing || event.altKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (event.ctrlKey && key === "enter" && context.prompt) return "send";
  if (context.editable) return null;
  if (!event.ctrlKey) {
    if (key === "escape") return "escape";
    if (key === "delete" || key === "backspace") return "delete";
    return null;
  }
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "=" || key === "+") return "zoomIn";
  if (event.shiftKey) return null;
  const actions: Record<string, ShortcutAction> = { c: "copy", v: "paste", d: "duplicate", l: "link", "-": "zoomOut", "0": "fit" };
  return actions[key] ?? null;
}

export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  { title: "创作", items: [["复制", "Ctrl+C"], ["粘贴", "Ctrl+V"], ["复制节点和连线", "Ctrl+D"], ["连线", "Ctrl+L"], ["节点复制", "Alt+拖动"], ["创建副本", "Ctrl+Alt+拖动"], ["生成", "Ctrl+Enter"], ["删除", "Delete / Backspace"]] },
  { title: "缩放", items: [["放大", "Ctrl+="], ["缩小", "Ctrl+-"], ["适应画布", "Ctrl+0"], ["缩放画布", "Ctrl+滚轮"]] },
  { title: "移动画布", items: [["临时移动", "空格+拖动"], ["移动", "中键拖动"], ["上下移动", "滚轮"], ["左右移动", "Shift+滚轮"]] },
  { title: "其他", items: [["撤销", "Ctrl+Z"], ["重做", "Ctrl+Shift+Z"], ["取消选择", "Esc"]] }
];
