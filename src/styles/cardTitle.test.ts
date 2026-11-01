import { expect, it, vi } from "vitest";

const { readFileSync } = await vi.importActual<{
  readFileSync: (path: URL, encoding: "utf8") => string;
}>("node:fs");

it("固定宽卡片的长标题单行省略，不把卡片撑宽", () => {
  const css = readFileSync(new URL("./card.css", import.meta.url), "utf8");
  const title = css.match(/\.card__title\s*\{([^}]+)\}/)?.[1];
  expect(css).toMatch(/\.card\s*\{[^}]*width:\s*280px/);
  expect(title).toMatch(/white-space:\s*nowrap/);
  expect(title).toMatch(/overflow:\s*hidden/);
  expect(title).toMatch(/text-overflow:\s*ellipsis/);
});
