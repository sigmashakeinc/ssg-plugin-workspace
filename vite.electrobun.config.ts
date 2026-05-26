// Electrobun build — single-file bundle written into the electrobun bundle
// so its `views://workspace/app.js` protocol resolves a self-contained ESM
// module. inlineDynamicImports is required: the views:// protocol cannot
// resolve dynamic chunk URLs.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  define: {
    WORKSPACE_RUNTIME: '"electrobun"',
  },
  build: {
    outDir: "../../../sigmashake-electrobun/binaries/workspace",
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
