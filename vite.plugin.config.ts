// Plugin build — single-file bundle mounted at /plugins/workspace/ inside the
// SSG daemon plugin shell. base:'./' ensures all emitted asset URLs are relative
// so they resolve correctly under the plugin sub-path. inlineDynamicImports
// avoids dynamic chunk URL issues (same reason local/electrobun/vscode use this).

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  base: "./",
  plugins: [react()],
  define: {
    WORKSPACE_RUNTIME: '"plugin"',
  },
  build: {
    outDir: "../../dist-plugin",
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
