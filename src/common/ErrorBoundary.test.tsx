import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CrashScreen, ErrorBoundary } from "./ErrorBoundary";

// 11-14 体检：以前页面里任何一处渲染出错都是整页空白，用户不知道发生了什么、也没东西可以反馈。
it("页面渲染出错时不留白屏：说人话、带原始报错和刷新按钮", () => {
  const html = renderToStaticMarkup(<CrashScreen error={new Error("Cannot read properties of undefined (reading 'status')")} />);
  expect(html).toContain('role="alert"');
  expect(html).toContain("页面出错了");
  expect(html).toContain("Cannot read properties of undefined (reading &#x27;status&#x27;)");
  expect(html).toMatch(/<button[^>]*>刷新页面<\/button>/);
});

it("接住渲染异常记成状态（抛的不是 Error 也接得住）；没出错时原样显示里面的内容", () => {
  expect(ErrorBoundary.getDerivedStateFromError(new Error("炸了")).error?.message).toBe("炸了");
  expect(ErrorBoundary.getDerivedStateFromError("字符串错").error?.message).toBe("字符串错");
  expect(renderToStaticMarkup(<ErrorBoundary><p>正常内容</p></ErrorBoundary>)).toBe("<p>正常内容</p>");
});
