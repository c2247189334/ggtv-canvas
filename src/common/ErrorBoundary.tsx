import { Component, type ErrorInfo, type ReactNode } from "react";

type State = { error: Error | null };

/** 页面渲染出错时的兜底：不留一整页空白，告诉用户怎么办，并把原始报错亮出来方便反馈。 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("页面渲染出错", error, info.componentStack);
  }

  render() {
    return this.state.error ? <CrashScreen error={this.state.error} /> : this.props.children;
  }
}

export function CrashScreen({ error }: { error: Error }) {
  return (
    <div className="crash" role="alert">
      <h1>页面出错了</h1>
      <p>先刷新一下页面；画布平时会自动保存，已经存好的内容不会丢。</p>
      <p>刷新后还这样，就关掉黑窗口重新启动一次。要反馈问题的话，请把下面这段原始报错一起带上：</p>
      <pre>{error.message}</pre>
      <button type="button" onClick={() => window.location.reload()}>刷新页面</button>
    </div>
  );
}
