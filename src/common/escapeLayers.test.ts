import { describe, expect, it } from "vitest";
import * as layers from "./escapeLayers";

function escape(target: EventTarget, repeat = false) {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperties(event, { key: { value: "Escape" }, repeat: { value: repeat } });
  target.dispatchEvent(event);
  return event;
}

describe("弹层的真实事件订阅", () => {
  it("一键只关最上层，挡住画布；下一次才取消选择", () => {
    const target = new EventTarget();
    const closed: string[] = [];
    let selected = true;
    const removeMenu = layers.registerEscapeLayer(target, () => { closed.push("菜单"); removeMenu(); }, 1000);
    const removeConfirm = layers.registerEscapeLayer(target, () => { closed.push("确认"); removeConfirm(); }, 1250);
    target.addEventListener("keydown", event => { if (!event.defaultPrevented) selected = false; });
    expect(escape(target).defaultPrevented).toBe(true);
    expect(closed).toEqual(["确认"]);
    expect(selected).toBe(true);
    escape(target);
    expect(closed).toEqual(["确认", "菜单"]);
    expect(selected).toBe(true);
    escape(target);
    expect(selected).toBe(false);
  });
  it("卸载移除订阅，同层后打开的先关，长按不连续关闭", () => {
    const target = new EventTarget();
    const closed: string[] = [];
    const first = layers.registerEscapeLayer(target, () => closed.push("旧"), 1000);
    const second = layers.registerEscapeLayer(target, () => closed.push("新"), 1000);
    escape(target, true);
    expect(closed).toEqual([]);
    escape(target);
    expect(closed).toEqual(["新"]);
    second();
    escape(target);
    expect(closed).toEqual(["新", "旧"]);
    first();
    expect(escape(target).defaultPrevented).toBe(false);
  });
});
