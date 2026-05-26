// VS Code webview build — single-file bundle written into vscode/webview-dist/
// so the extension host (vscode/src/extension.ts) can ship it inside the
// .vsix and load it with webview.asWebviewUri(). inlineDynamicImports is
// required: the webview's CSP forbids loading dynamic chunk URLs.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  define: {
    WORKSPACE_RUNTIME: '"vscode"',
  },
  build: {
    outDir: "../../vscode/webview-dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "app.js",
        assetFileNames: (info) => {
          if (info.name?.endsWith(".css")) return "app.css";
          return "[name][extname]";
        },
      },
    },
  },
});
