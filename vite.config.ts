// Cloud build — output goes to public/ for [assets] directory binding.
// The Worker drops public/index.html post-build so it can render the root
// itself; everything else (assets/app.js, assets/app.css) is served verbatim.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  define: {
    WORKSPACE_RUNTIME: '"cloud"',
  },
  build: {
    outDir: "../../public",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        assetFileNames: (info) => {
          if (info.name?.endsWith(".css")) return "assets/app.css";
          return "assets/[name][extname]";
        },
      },
    },
  },
});
