import { describe, expect, it } from "vitest";
import { contextMenuItems, addMenuItems, offersConnectionMenu } from "./menus";
const action = () => {};
const commands = { upload: action, undo: action, redo: action, paste: action, copy: action, duplicate: action, delete: action };

describe("menus", () => {
  it("空白右键：上传/撤销/重做/粘贴含禁用和Windows提示", () => {
    expect(contextMenuItems(false, commands, { undo: false, redo: true, paste: false })).toEqual([
      { label: "上传", onSelect: action },
      { label: "撤销", shortcut: "Ctrl+Z", disabled: true, onSelect: action },
      { label: "重做", shortcut: "Ctrl+Shift+Z", disabled: false, onSelect: action },
      { label: "粘贴", shortcut: "Ctrl+V", disabled: true, onSelect: action }
    ]);
  });
  it("卡片右键：复制/创建副本/粘贴/删除含提示", () => {
    const items = contextMenuItems(true, commands, { undo: false, redo: false, paste: true });
    expect(items.map(i => typeof i === "object" && "label" in i ? [i.label, i.shortcut] : null)).toEqual([
      ["复制", "Ctrl+C"], ["创建副本", "Ctrl+D"], ["粘贴", "Ctrl+V"], ["删除", "Delete"]
    ]);
  });
  it.each([
    ["blank", ["添加节点", "图片", "视频", "添加资源", "上传", "从作品库选"]],
    ["reference", ["添加上下文", "图片", "视频", "添加资源", "上传", "从作品库选"]],
    ["downstream", ["引用该节点生成", "图片", "视频"]]
  ] as const)("%s菜单分组和字", (kind, labels) => {
    const items = addMenuItems(kind, { image: action, video: action, upload: action, work: action });
    expect(items.map(i => typeof i === "object" ? "group" in i ? i.group : i.label : i)).toEqual(labels);
    expect(items[2]).toMatchObject(kind === "reference" ? { label: "视频", disabled: true } : { label: "视频", onSelect: action });
    if (kind !== "reference") expect(items[2]).not.toHaveProperty("disabled", true);
    expect(items[1]).toMatchObject({ onSelect: action });
  });
  it("仅从右接出点松到空白时留线弹菜单；左接入/已处理/卡上取消", () => {
    expect(offersConnectionMenu(false, "source", true, true)).toBe(true);
    expect(offersConnectionMenu(false, "target", true, true)).toBe(false);
    expect(offersConnectionMenu(true, "source", true, true)).toBe(false);
    expect(offersConnectionMenu(false, "source", false, true)).toBe(false);
    expect(offersConnectionMenu(false, "source", true, false)).toBe(false);
  });
});
