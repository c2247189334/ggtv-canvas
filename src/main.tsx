import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles/index.css";
import { App } from "@/App";
import { ErrorBoundary } from "@/common/ErrorBoundary";

const root = document.getElementById("root");
if (!root) throw new Error("找不到 #root。");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
