import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GenOptions, GenOptionChoices } from "./GenOptions";
import { ModelMenu } from "./ModelPicker";
import { FLASH_MODEL, LITE_MODEL } from "@/domain/pricing";
import type { GenSettings } from "@/types";

describe("GenOptions", () => {
  const gen: GenSettings = { model: FLASH_MODEL, resolution: "2K", sizeFrom: 0, aspect: "16:9", count: 1 };
  const render = (settings = gen, refCount = 0) => renderToStaticMarkup(
    <GenOptions gen={settings} refCount={refCount} sending={false} onChange={() => {}} onSend={() => {}} />
  );
  it("比例、分辨率与张数合成按钮，模型用带图标的菜单按钮", () => {
    const html = render();
    expect(html).toContain("16:9 · 2K · 1张");
    expect(html).not.toContain("<select");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('class="model-icon"');
    expect(html).toContain("Seedream 5.0 Flash");
    expect(html).toContain("约 ¥0.12");
  });
  it("旧存档3张照常显示，跟图尺寸显示实际引用编号", () => {
    expect(render({ ...gen, aspect: "1:1", count: 3 })).toContain("1:1 · 2K · 3张");
    expect(render({ ...gen, sizeFrom: 2 }, 2)).toContain("跟图片2 · 2K · 1张");
  });
  it("2 张估价翻倍，发送中锁住发送按钮", () => {
    const html = renderToStaticMarkup(<GenOptions gen={{ ...gen, count: 2 }} refCount={0} sending onChange={() => {}} onSend={() => {}} />);
    expect(html).toContain("约 ¥0.24");
    expect(html).toMatch(/class="gen__send" disabled=""/);
    expect(html).toContain("发送中…");
  });
  it("模型菜单带图标、提示块，当前行选中", () => {
    const html = renderToStaticMarkup(<ModelMenu gen={gen} onChange={() => {}} onClose={() => {}} />);
    expect(html).toContain('role="menu"');
    expect(html.match(/class="model-icon"/g)).toHaveLength(2);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('class="model-menu__hint">¥0.12');
    expect(html).toContain('class="model-menu__hint">¥0.22');
    expect(html).not.toContain('20s');
    expect(html).toContain("Seedream 5.0 Lite");
  });
  it("点 Lite 行纠正不支持的档位和比例，通知变更并关闭菜单", () => {
    let changed: GenSettings | undefined;
    let closed = false;
    const menu = ModelMenu({ gen: { ...gen, resolution: "1K", aspect: "21:9" }, onChange: (next) => { changed = next; }, onClose: () => { closed = true; } });
    menu.props.children[1].props.onClick();
    expect(changed).toEqual({ ...gen, model: LITE_MODEL, resolution: "2K", aspect: "16:9" });
    expect(closed).toBe(true);
  });
  it("选项按分辨率、比例、生成数量排序，跟图片选项在比例最前", () => {
    const html = renderToStaticMarkup(<GenOptionChoices gen={gen} refCount={2} onChange={() => {}} />);
    expect(html.indexOf("分辨率")).toBeLessThan(html.indexOf("比例"));
    expect(html.indexOf("比例")).toBeLessThan(html.indexOf("生成数量"));
    expect(html.indexOf("跟图片2")).toBeLessThan(html.indexOf("1:1"));
    expect(html).toContain(">1K</button>");
    expect(html).toContain(">2K</button>");
    expect(html).not.toContain(">3K</button>");
    expect(html).toContain(">21:9</button>");
    for (const count of [1, 2, 4]) expect(html).toContain(`>${count}张</button>`);
    expect(html).not.toContain(">3张</button>");
    expect(html).not.toMatch(/画质|背景/);
  });
  it("Lite 仅有 2K、3K 和七种比例，选项点击保留其他设置", () => {
    let changed = gen;
    const settings: GenSettings = { ...gen, model: LITE_MODEL };
    const choices = GenOptionChoices({ gen: settings, refCount: 2, onChange: (next) => { changed = next; } });
    const html = renderToStaticMarkup(choices);
    expect(html).toContain(">3K</button>");
    expect(html).not.toContain(">1K</button>");
    expect(html).not.toContain(">21:9</button>");
    choices.props.children[1].props.children[1].props.onClick();
    expect(changed).toEqual({ ...settings, resolution: "3K" });
    choices.props.children[3].props.children[0][1].props.onClick();
    expect(changed).toEqual({ ...settings, sizeFrom: 2 });
  });
});
