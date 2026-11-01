import type { MenuItem } from "@/common/PopMenu";
import type { CardData } from "@/types";

type Command = () => void;
type ContextCommands = Record<"upload" | "undo" | "redo" | "paste" | "copy" | "duplicate" | "delete", Command>;
export function contextMenuItems(card: boolean, commands: ContextCommands, enabled: { undo: boolean; redo: boolean; paste: boolean }): MenuItem[] {
  const paste = { label: "粘贴", shortcut: "Ctrl+V", disabled: !enabled.paste, onSelect: commands.paste };
  return card ? [
    { label: "复制", shortcut: "Ctrl+C", onSelect: commands.copy },
    { label: "创建副本", shortcut: "Ctrl+D", onSelect: commands.duplicate }, paste,
    { label: "删除", shortcut: "Delete", onSelect: commands.delete }
  ] : [
    { label: "上传", onSelect: commands.upload },
    { label: "撤销", shortcut: "Ctrl+Z", disabled: !enabled.undo, onSelect: commands.undo },
    { label: "重做", shortcut: "Ctrl+Shift+Z", disabled: !enabled.redo, onSelect: commands.redo }, paste
  ];
}

export function addMenuItems(kind: "blank" | "reference" | "downstream", commands: { image: Command; video: Command; upload: Command; work: Command }, cardKind?: CardData["kind"]): MenuItem[] {
  const titles = { blank: "添加节点", reference: "添加上下文", downstream: "引用该节点生成" };
  return [
    { group: titles[kind] }, { label: "图片", ...(kind === "downstream" && (cardKind === "video" || cardKind === "audio") ? { disabled: true } : {}), onSelect: commands.image },
    { label: "视频", ...(kind !== "reference" || cardKind === "video" ? { onSelect: commands.video } : { disabled: true }) },
    ...(kind === "downstream" ? [] : [{ group: "添加资源" }, { label: "上传", onSelect: commands.upload }, { label: "从作品库选", onSelect: commands.work }])
  ];
}

export function offersConnectionMenu(handled: boolean, handleType: string | undefined, hasSource: boolean, blank: boolean): boolean {
  return !handled && handleType === "source" && hasSource && blank;
}

export function assetMenuItems(card: CardData | undefined, edit: Command, clear: Command): MenuItem[] {
  if (!card || card.kind !== "image" || card.source === "generate") return [];
  return card.assetId ? [{ label: "改真人素材编号…", onSelect: edit }, { label: "清除真人素材编号", onSelect: clear }]
    : [{ label: "填真人素材编号…", onSelect: edit }];
}
