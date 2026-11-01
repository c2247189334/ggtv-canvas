import { describe, expect, it } from "vitest";
import { shortcutAction, SHORTCUT_GROUPS } from "./shortcuts";
import * as shortcuts from "./shortcuts";

describe("Esc只处理一层", () => {
  it.each(["比例张数", "@素材", "右键", "左＋", "右＋", "双击", "拖线松手", "快捷键", "大图", "确认框", "作品选择", "设置"])("%s打开时只关弹层", id => {
    expect(shortcuts.escapeAction({ key: "Escape" }, [{ id, priority: 1000 }])).toEqual({ type: "close", id });
  });
  it("按视觉层级关最上面，同层后打开的先关，不改变原列表", () => {
    const layers = [{ id: "确认", priority: 1250 }, { id: "菜单", priority: 1000 }];
    expect(shortcuts.escapeAction({ key: "Escape" }, layers)).toEqual({ type: "close", id: "确认" });
    expect(layers.map(l => l.id)).toEqual(["确认", "菜单"]);
    expect(shortcuts.escapeAction({ key: "Escape" }, [{ id: "旧", priority: 1000 }, { id: "新", priority: 1000 }])).toEqual({ type: "close", id: "新" });
  });
  it("没有弹层才取消选择", () => {
    expect(shortcuts.escapeAction({ key: "Escape" }, [])).toEqual({ type: "deselect" });
  });
  it("长按不连关多层，已处理或输入法中的按键不处理", () => {
    for (const event of [{ key: "Enter" }, { key: "Escape", repeat: true }, { key: "Escape", defaultPrevented: true }, { key: "Escape", isComposing: true }])
      expect(shortcuts.escapeAction(event, [{ id: "菜单", priority: 1000 }])).toEqual({ type: "ignore" });
  });
});

describe("shortcuts", () => {
  it.each([
    ["z", false, "undo"], ["Z", false, "undo"], ["z", true, "redo"], ["Z", true, "redo"],
    ["c", false, "copy"], ["v", false, "paste"], ["d", false, "duplicate"], ["l", false, "link"], ["L", false, "link"],
    ["=", false, "zoomIn"], ["+", true, "zoomIn"], ["-", false, "zoomOut"], ["0", false, "fit"]
  ])("Ctrl %s shift=%s → %s", (key, shiftKey, action) => {
    expect(shortcutAction({ key, ctrlKey: true, shiftKey }, { editable: false })).toBe(action);
    expect(shortcutAction({ key, ctrlKey: true, shiftKey }, { editable: true })).toBeNull();
  });
  it.each(["Delete", "Backspace", "Escape"])("%s 无需节点焦点", key => {
    expect(shortcutAction({ key }, { editable: false })).toBe(key === "Escape" ? "escape" : "delete");
    expect(shortcutAction({ key }, { editable: true })).toBeNull();
  });
  it("CtrlEnter只在提示词框响应，其他输入/空白不发", () => {
    expect(shortcutAction({ key: "Enter", ctrlKey: true }, { editable: true, prompt: true })).toBe("send");
    expect(shortcutAction({ key: "Enter", ctrlKey: true }, { editable: true })).toBeNull();
    expect(shortcutAction({ key: "Enter", ctrlKey: true }, { editable: false })).toBeNull();
  });
  it.each(["a", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "v", "h"])("%s不新增快捷操作", key => {
    expect(shortcutAction({ key }, { editable: false })).toBeNull();
  });
  it("不抢Alt/Meta和输入法组合键", () => {
    for (const patch of [{ altKey: true }, { metaKey: true }, { isComposing: true }])
      expect(shortcutAction({ key: "z", ctrlKey: true, ...patch }, { editable: false })).toBeNull();
  });
  it("Ctrl+Shift+L不连线，提示词框里的Ctrl+L交给浏览器", () => {
    expect(shortcutAction({ key: "L", ctrlKey: true, shiftKey: true }, { editable: false })).toBeNull();
    expect(shortcutAction({ key: "l", ctrlKey: true }, { editable: true, prompt: true })).toBeNull();
  });
  it("说明面板只有四组和已实现操作", () => {
    expect(SHORTCUT_GROUPS.map(g => g.title)).toEqual(["创作", "缩放", "移动画布", "其他"]);
    expect(SHORTCUT_GROUPS.flatMap(g => g.items).map(i => i[0])).toEqual([
      "复制", "粘贴", "复制节点和连线", "连线", "节点复制", "创建副本", "生成", "删除", "放大", "缩小", "适应画布", "缩放画布",
      "临时移动", "移动", "上下移动", "左右移动", "撤销", "重做", "取消选择"
    ]);
    expect(SHORTCUT_GROUPS[0].items).toEqual([
      ["复制", "Ctrl+C"], ["粘贴", "Ctrl+V"], ["复制节点和连线", "Ctrl+D"], ["连线", "Ctrl+L"],
      ["节点复制", "Alt+拖动"], ["创建副本", "Ctrl+Alt+拖动"], ["生成", "Ctrl+Enter"], ["删除", "Delete / Backspace"]
    ]);
  });
});
