import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// 平时用一键启动：先 vite build，再由小服务（5290）直接给页面。
// 开发时 npm run dev：页面在 5280，/api 转给 5290 的小服务（小服务要另外开着）。
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // 页面打包进来的开源库（React、React Flow 等）的许可声明，随整合包一起发。
  build: { license: { fileName: "THIRD_PARTY_LICENSES.md" } },
  server: {
    host: "127.0.0.1",
    port: 5280,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:5290" }
  }
});
